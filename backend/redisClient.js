const { createClient } = require('redis');
const config = require('./config');
const os = require('os');

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this.consumerName = `${os.hostname()}-${process.pid}`;
    this.groupName = 'orderbook_consumers';
    this.processedMessageIds = new Set();
    this.maxProcessedIds = 10000;
    this.isConsumerGroupReady = false;
    this.lastPendingCheck = 0;
    this.pendingCheckInterval = 60000;
  }

  async connect() {
    try {
      this.client = createClient({ url: config.redisUrl });
      
      this.client.on('error', (err) => {
        console.error('[Redis] Client Error:', err.message);
        this.connected = false;
        this.isConsumerGroupReady = false;
      });

      this.client.on('connect', () => {
        console.log('[Redis] Client Connected');
        this.connected = true;
      });

      this.client.on('ready', async () => {
        console.log('[Redis] Client Ready');
        await this.ensureConsumerGroup();
      });

      await this.client.connect();
      return true;
    } catch (err) {
      console.error('[Redis] Failed to connect:', err.message);
      console.log('[Redis] Running without Redis - historical data will not be stored');
      return false;
    }
  }

  async ensureConsumerGroup() {
    if (!this.connected) return false;

    try {
      const streamInfo = await this.client.xInfoStream(config.streamName).catch(() => null);
      
      if (!streamInfo) {
        console.log('[Redis] Stream does not exist, will be created on first message');
        await this.createConsumerGroup('0');
        return true;
      }

      const groups = await this.client.xInfoGroups(config.streamName).catch(() => []);
      const groupExists = groups.some(g => g.name === this.groupName);

      if (!groupExists) {
        console.log('[Redis] Consumer group does not exist, creating...');
        await this.createConsumerGroup('0');
      } else {
        console.log('[Redis] Consumer group already exists');
        this.isConsumerGroupReady = true;
      }

      await this.checkAndProcessPending();
      return true;
    } catch (err) {
      console.error('[Redis] Error ensuring consumer group:', err.message);
      return false;
    }
  }

  async createConsumerGroup(startId = '0') {
    try {
      await this.client.xGroupCreate(
        config.streamName,
        this.groupName,
        startId,
        { MKSTREAM: true }
      );
      console.log(`[Redis] Consumer group '${this.groupName}' created`);
      this.isConsumerGroupReady = true;
      return true;
    } catch (err) {
      if (err.message.includes('BUSYGROUP')) {
        console.log('[Redis] Consumer group already exists');
        this.isConsumerGroupReady = true;
        return true;
      }
      console.error('[Redis] Error creating consumer group:', err.message);
      return false;
    }
  }

  async addSnapshot(data) {
    if (!this.connected) return null;
    
    try {
      const id = await this.client.xAdd(config.streamName, '*', {
        data: JSON.stringify(data),
        producer: this.consumerName,
        timestamp: Date.now().toString()
      });

      const length = await this.client.xLen(config.streamName);
      if (length > config.maxSnapshots) {
        await this.client.xTrim(config.streamName, 'MAXLEN', config.maxSnapshots);
      }

      await this.autoAck(id);
      
      return id;
    } catch (err) {
      console.error('[Redis] Error adding snapshot:', err.message);
      return null;
    }
  }

  async autoAck(messageId) {
    if (!this.isConsumerGroupReady) return false;

    try {
      await this.client.xAck(
        config.streamName,
        this.groupName,
        messageId
      );
      return true;
    } catch (err) {
      console.error('[Redis] Error auto-acknowledging message:', err.message);
      return false;
    }
  }

  async readNextMessages(count = 10, block = 0) {
    if (!this.connected || !this.isConsumerGroupReady) return [];

    try {
      const response = await this.client.xReadGroup(
        this.groupName,
        this.consumerName,
        { key: config.streamName, id: '>' },
        { COUNT: count, BLOCK: block }
      );

      if (!response || response.length === 0) return [];

      const messages = response[0].messages.map(msg => ({
        id: msg.id,
        timestamp: this.idToTimestamp(msg.id),
        ...JSON.parse(msg.message.data || '{}')
      }));

      const newMessages = messages.filter(msg => {
        if (this.processedMessageIds.has(msg.id)) {
          console.log(`[Redis] Duplicate message detected: ${msg.id}, skipping`);
          this.autoAck(msg.id);
          return false;
        }
        return true;
      });

      for (const msg of newMessages) {
        this.addProcessedId(msg.id);
      }

      return newMessages;
    } catch (err) {
      console.error('[Redis] Error reading messages:', err.message);
      return [];
    }
  }

  async checkAndProcessPending() {
    if (!this.connected || !this.isConsumerGroupReady) return [];

    const now = Date.now();
    if (now - this.lastPendingCheck < this.pendingCheckInterval) return [];
    this.lastPendingCheck = now;

    try {
      const pending = await this.client.xPending(
        config.streamName,
        this.groupName
      );

      if (!pending || pending.count === 0 || pending.count === undefined) {
        console.log('[Redis] No pending messages');
        return [];
      }

      const pendingCount = typeof pending.count === 'number' ? pending.count : parseInt(pending.count, 10);
      
      if (isNaN(pendingCount) || pendingCount <= 0) {
        console.log('[Redis] No pending messages');
        return [];
      }

      console.log(`[Redis] Found ${pendingCount} pending messages, processing...`);

      const pendingMessages = await this.client.xPendingRange(
        config.streamName,
        this.groupName,
        '-',
        '+',
        pendingCount
      );

      const recoveredMessages = [];

      for (const pMsg of pendingMessages) {
        if (!pMsg || !pMsg.id) continue;
        
        if (pMsg.consumer === this.consumerName) {
          if (this.processedMessageIds.has(pMsg.id)) {
            console.log(`[Redis] Pending message already processed: ${pMsg.id}, acknowledging`);
            await this.autoAck(pMsg.id);
            continue;
          }

          const idleTime = pMsg.millisecondsSinceLastDelivery || 0;
          
          if (idleTime > 30000) {
            console.log(`[Redis] Recovering stale pending message: ${pMsg.id}, idle: ${idleTime}ms`);
            
            await this.client.xClaim(
              config.streamName,
              this.groupName,
              this.consumerName,
              10000,
              pMsg.id
            );

            const msgData = await this.client.xRange(
              config.streamName,
              pMsg.id,
              pMsg.id
            );

            if (msgData && msgData.length > 0 && msgData[0]) {
              const msg = {
                id: msgData[0].id,
                timestamp: this.idToTimestamp(msgData[0].id),
                ...JSON.parse(msgData[0].message.data || '{}')
              };
              
              if (!this.processedMessageIds.has(msg.id)) {
                this.addProcessedId(msg.id);
                recoveredMessages.push(msg);
              }
              
              await this.autoAck(pMsg.id);
            }
          }
        }
      }

      console.log(`[Redis] Recovered ${recoveredMessages.length} pending messages`);
      return recoveredMessages;
    } catch (err) {
      console.error('[Redis] Error checking pending messages:', err.message);
      return [];
    }
  }

  async ackMessage(messageId) {
    if (!this.isConsumerGroupReady) return false;

    try {
      await this.client.xAck(
        config.streamName,
        this.groupName,
        messageId
      );
      return true;
    } catch (err) {
      console.error('[Redis] Error acknowledging message:', err.message);
      return false;
    }
  }

  addProcessedId(id) {
    this.processedMessageIds.add(id);
    if (this.processedMessageIds.size > this.maxProcessedIds) {
      const idsArray = Array.from(this.processedMessageIds);
      const toRemove = idsArray.slice(0, Math.floor(this.maxProcessedIds / 2));
      for (const oldId of toRemove) {
        this.processedMessageIds.delete(oldId);
      }
    }
  }

  async getSnapshots(count = 100, start = '-', end = '+') {
    if (!this.connected) return [];
    
    try {
      const entries = await this.client.xRevRange(config.streamName, end, start, {
        COUNT: count
      });
      
      return entries.map(entry => ({
        id: entry.id,
        timestamp: this.idToTimestamp(entry.id),
        ...JSON.parse(entry.message.data)
      })).reverse();
    } catch (err) {
      console.error('[Redis] Error getting snapshots:', err.message);
      return [];
    }
  }

  async getSnapshotsByTimeRange(startTime, endTime) {
    if (!this.connected) return [];
    
    try {
      const startId = `${startTime}-0`;
      const endId = `${endTime}-0`;
      
      const entries = await this.client.xRange(config.streamName, startId, endId);
      
      return entries.map(entry => ({
        id: entry.id,
        timestamp: this.idToTimestamp(entry.id),
        ...JSON.parse(entry.message.data)
      }));
    } catch (err) {
      console.error('[Redis] Error getting snapshots by time range:', err.message);
      return [];
    }
  }

  async getLatestSnapshot() {
    if (!this.connected) return null;
    
    try {
      const entries = await this.client.xRevRange(config.streamName, '+', '-', { COUNT: 1 });
      
      if (entries.length === 0) return null;
      
      return {
        id: entries[0].id,
        timestamp: this.idToTimestamp(entries[0].id),
        ...JSON.parse(entries[0].message.data)
      };
    } catch (err) {
      console.error('[Redis] Error getting latest snapshot:', err.message);
      return null;
    }
  }

  async getConsumerGroupInfo() {
    if (!this.connected) return null;

    try {
      const groups = await this.client.xInfoGroups(config.streamName).catch(() => []);
      const consumers = await this.client.xInfoConsumers(
        config.streamName,
        this.groupName
      ).catch(() => []);
      const pending = await this.client.xPending(
        config.streamName,
        this.groupName
      ).catch(() => null);

      const pendingCount = pending && pending.count !== undefined 
        ? (typeof pending.count === 'number' ? pending.count : parseInt(pending.count, 10) || 0)
        : 0;

      return {
        groupName: this.groupName,
        consumerName: this.consumerName,
        isGroupReady: this.isConsumerGroupReady,
        groups: groups || [],
        consumers: consumers || [],
        pending: {
          ...pending,
          count: isNaN(pendingCount) ? 0 : pendingCount
        },
        processedCount: this.processedMessageIds.size
      };
    } catch (err) {
      console.error('[Redis] Error getting consumer group info:', err.message);
      return null;
    }
  }

  idToTimestamp(id) {
    return parseInt(id.split('-')[0], 10);
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
      this.isConsumerGroupReady = false;
    }
  }
}

module.exports = new RedisClient();

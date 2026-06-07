const { createClient } = require('redis');
const config = require('./config');

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    try {
      this.client = createClient({ url: config.redisUrl });
      
      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err.message);
        this.connected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis Client Connected');
        this.connected = true;
      });

      await this.client.connect();
      return true;
    } catch (err) {
      console.error('Failed to connect to Redis:', err.message);
      console.log('Running without Redis - historical data will not be stored');
      return false;
    }
  }

  async addSnapshot(data) {
    if (!this.connected) return null;
    
    try {
      const id = await this.client.xAdd(config.streamName, '*', {
        data: JSON.stringify(data)
      });

      const length = await this.client.xLen(config.streamName);
      if (length > config.maxSnapshots) {
        await this.client.xTrim(config.streamName, 'MAXLEN', config.maxSnapshots);
      }
      
      return id;
    } catch (err) {
      console.error('Error adding snapshot:', err.message);
      return null;
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
      console.error('Error getting snapshots:', err.message);
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
      console.error('Error getting snapshots by time range:', err.message);
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
      console.error('Error getting latest snapshot:', err.message);
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
    }
  }
}

module.exports = new RedisClient();

const WebSocket = require('ws');
const axios = require('axios');
const config = require('../config');
const seqIdManager = require('../seqIdManager');

class OKXClient {
  constructor(symbol = config.symbol, depth = config.depth) {
    this.symbol = symbol.toUpperCase().replace('USDT', '-USDT');
    this.depth = depth;
    this.ws = null;
    this.onDataCallback = null;
    this.onSnapshotCallback = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.isConnecting = false;
    this.buffer = [];
    this.snapshotFetched = false;
    this.lastSeqId = -1;
    this.checksum = null;
    this.shouldReconnect = true;
  }

  async connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    seqIdManager.init('okx');
    this.buffer = [];
    this.snapshotFetched = false;
    this.lastSeqId = -1;

    const url = config.okxWsUrl;

    console.log(`[OKX] Connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[OKX] WebSocket connected');
      this.reconnectAttempts = 0;
      this.isConnecting = false;
      this.subscribe();
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        this.handleDepthUpdate(parsed);
      } catch (err) {
        console.error('[OKX] Error parsing message:', err.message);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[OKX] WebSocket error:', err.message);
      this.isConnecting = false;
    });

    this.ws.on('close', () => {
      console.log('[OKX] WebSocket closed');
      this.isConnecting = false;
      seqIdManager.setReady('okx', false);
      this.attemptReconnect();
    });
  }

  subscribe() {
    const msg = {
      op: 'subscribe',
      args: [
        {
          channel: `books${this.depth}`,
          instId: this.symbol
        }
      ]
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      console.log(`[OKX] Subscribed to ${this.symbol} orderbook`);
    }
  }

  async fetchSnapshot() {
    try {
      console.log('[OKX] Fetching full depth snapshot...');
      
      const restUrl = `https://www.okx.com/api/v5/market/books?instId=${this.symbol}&sz=${this.depth}`;
      const response = await axios.get(restUrl, { timeout: 10000 });
      
      const result = response.data;
      
      if (!result || result.code !== '0' || !result.data || result.data.length === 0) {
        throw new Error('Invalid snapshot data');
      }

      const snapshot = result.data[0];
      
      if (!snapshot.bids || !snapshot.asks) {
        throw new Error('Missing bids/asks in snapshot');
      }

      const seqId = parseInt(snapshot.seqId, 10);

      const formattedSnapshot = {
        exchange: 'okx',
        symbol: this.symbol.replace('-', ''),
        timestamp: parseInt(snapshot.ts, 10) || Date.now(),
        lastUpdateId: seqId,
        seqId: seqId,
        bids: snapshot.bids.slice(0, this.depth).map(bid => [
          parseFloat(bid[0]),
          parseFloat(bid[1])
        ]),
        asks: snapshot.asks.slice(0, this.depth).map(ask => [
          parseFloat(ask[0]),
          parseFloat(ask[1])
        ]),
        isSnapshot: true
      };

      seqIdManager.setSnapshot('okx', formattedSnapshot);
      this.lastSeqId = seqId;
      this.snapshotFetched = true;

      console.log(`[OKX] Snapshot fetched, seqId: ${seqId}`);

      if (this.onSnapshotCallback) {
        this.onSnapshotCallback('okx', formattedSnapshot);
      }

      if (this.onDataCallback) {
        this.onDataCallback('okx', formattedSnapshot);
      }

      this.processBuffer();

    } catch (err) {
      console.error('[OKX] Failed to fetch snapshot:', err.message);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log('[OKX] Retrying snapshot in 3s...');
        setTimeout(() => this.fetchSnapshot(), 3000);
      }
    }
  }

  handleDepthUpdate(raw) {
    if (raw.arg?.channel !== `books${this.depth}` || !raw.data) {
      return;
    }

    const data = raw.data[0];
    if (!data) return;

    const seqId = parseInt(data.seqId, 10);

    if (!this.snapshotFetched) {
      if (data.action === 'snapshot') {
        const formatted = this.formatSnapshotData(data, seqId, true);
        seqIdManager.setSnapshot('okx', formatted);
        this.lastSeqId = seqId;
        this.snapshotFetched = true;
        
        console.log(`[OKX] Initial snapshot from WebSocket, seqId: ${seqId}`);
        
        if (this.onSnapshotCallback) {
          this.onSnapshotCallback('okx', formatted);
        }
        
        if (this.onDataCallback) {
          this.onDataCallback('okx', formatted);
        }
        
        this.processBuffer();
      } else {
        this.buffer.push(data);
        
        if (this.buffer.length > 1000) {
          console.log('[OKX] Buffer overflow, clearing old messages');
          this.buffer = this.buffer.slice(-500);
        }
        
        if (this.buffer.length === 1) {
          console.log('[OKX] Waiting for snapshot, fetching via REST API...');
          this.fetchSnapshot();
        }
      }
      return;
    }

    if (seqId <= this.lastSeqId) {
      console.log(`[OKX] Stale update: seqId=${seqId} <= lastSeqId=${this.lastSeqId}, skipping`);
      return;
    }

    if (seqId > this.lastSeqId + 1) {
      console.warn(`[OKX] Gap detected: seqId=${seqId} > lastSeqId+1=${this.lastSeqId + 1}, refetching snapshot`);
      this.snapshotFetched = false;
      this.buffer = [data];
      seqIdManager.setReady('okx', false);
      this.fetchSnapshot();
      return;
    }

    if (!seqIdManager.validate('okx', seqId)) {
      return;
    }

    const formatted = this.formatSnapshotData(data, seqId, false);

    seqIdManager.generate('okx', seqId);
    this.lastSeqId = seqId;

    if (this.onDataCallback) {
      this.onDataCallback('okx', formatted);
    }
  }

  formatSnapshotData(data, seqId, isSnapshot) {
    return {
      exchange: 'okx',
      symbol: this.symbol.replace('-', ''),
      timestamp: parseInt(data.ts, 10) || Date.now(),
      lastUpdateId: seqId,
      seqId: seqId,
      bids: data.bids.slice(0, this.depth).map(bid => [
        parseFloat(bid[0]),
        parseFloat(bid[1])
      ]),
      asks: data.asks.slice(0, this.depth).map(ask => [
        parseFloat(ask[0]),
        parseFloat(ask[1])
      ]),
      isSnapshot: isSnapshot
    };
  }

  processBuffer() {
    if (!this.snapshotFetched || this.buffer.length === 0) return;

    console.log(`[OKX] Processing ${this.buffer.length} buffered messages`);

    const bufferCopy = [...this.buffer];
    this.buffer = [];

    for (const msg of bufferCopy) {
      this.handleDepthUpdate({
        arg: { channel: `books${this.depth}` },
        data: [msg]
      });
    }
  }

  attemptReconnect() {
    if (!this.shouldReconnect) {
      console.log('[OKX] Reconnect disabled, stopping');
      return;
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[OKX] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[OKX] Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, this.reconnectDelay);
  }

  onData(callback) {
    this.onDataCallback = callback;
  }

  onSnapshot(callback) {
    this.onSnapshotCallback = callback;
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnecting = false;
    this.snapshotFetched = false;
    this.buffer = [];
    console.log('[OKX] Disconnected and reconnect disabled');
  }
}

module.exports = OKXClient;

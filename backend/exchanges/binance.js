const WebSocket = require('ws');
const axios = require('axios');
const config = require('../config');
const seqIdManager = require('../seqIdManager');

class BinanceClient {
  constructor(symbol = config.symbol, depth = config.depth) {
    this.symbol = symbol.toLowerCase();
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
    this.lastFinalUpdateId = -1;
    this.shouldReconnect = true;
  }

  async connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    seqIdManager.init('binance');
    this.buffer = [];
    this.snapshotFetched = false;
    this.lastFinalUpdateId = -1;

    const streamName = `${this.symbol}@depth${this.depth}@100ms`;
    const url = `${config.binanceWsUrl}/${streamName}`;

    console.log(`[Binance] Connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[Binance] WebSocket connected');
      this.reconnectAttempts = 0;
      this.isConnecting = false;
      this.fetchSnapshot();
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        this.handleDepthUpdate(parsed);
      } catch (err) {
        console.error('[Binance] Error parsing message:', err.message);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[Binance] WebSocket error:', err.message);
      this.isConnecting = false;
    });

    this.ws.on('close', () => {
      console.log('[Binance] WebSocket closed');
      this.isConnecting = false;
      seqIdManager.setReady('binance', false);
      this.attemptReconnect();
    });
  }

  async fetchSnapshot() {
    try {
      console.log('[Binance] Fetching full depth snapshot...');
      
      const restUrl = `https://api.binance.com/api/v3/depth?symbol=${this.symbol.toUpperCase()}&limit=${this.depth}`;
      const response = await axios.get(restUrl, { timeout: 10000 });
      
      const snapshot = response.data;
      
      if (!snapshot || !snapshot.bids || !snapshot.asks) {
        throw new Error('Invalid snapshot data');
      }

      const formattedSnapshot = {
        exchange: 'binance',
        symbol: this.symbol.toUpperCase(),
        timestamp: Date.now(),
        lastUpdateId: snapshot.lastUpdateId,
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

      seqIdManager.setSnapshot('binance', formattedSnapshot);
      this.lastFinalUpdateId = snapshot.lastUpdateId;
      this.snapshotFetched = true;

      console.log(`[Binance] Snapshot fetched, lastUpdateId: ${snapshot.lastUpdateId}`);

      if (this.onSnapshotCallback) {
        this.onSnapshotCallback('binance', formattedSnapshot);
      }

      if (this.onDataCallback) {
        this.onDataCallback('binance', formattedSnapshot);
      }

      this.processBuffer();

    } catch (err) {
      console.error('[Binance] Failed to fetch snapshot:', err.message);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log('[Binance] Retrying snapshot in 3s...');
        setTimeout(() => this.fetchSnapshot(), 3000);
      }
    }
  }

  handleDepthUpdate(raw) {
    if (!raw || raw.e !== 'depthUpdate') return;

    const { U, u, b, a } = raw;

    if (!this.snapshotFetched) {
      this.buffer.push({ U, u, b, a });
      
      if (this.buffer.length > 1000) {
        console.log('[Binance] Buffer overflow, clearing old messages');
        this.buffer = this.buffer.slice(-500);
      }
      return;
    }

    if (u <= this.lastFinalUpdateId) {
      console.log(`[Binance] Stale update: u=${u} <= lastFinalUpdateId=${this.lastFinalUpdateId}, skipping`);
      return;
    }

    if (U > this.lastFinalUpdateId + 1) {
      console.warn(`[Binance] Gap detected: U=${U} > lastFinalUpdateId+1=${this.lastFinalUpdateId + 1}, refetching snapshot`);
      this.snapshotFetched = false;
      this.buffer = [{ U, u, b, a }];
      seqIdManager.setReady('binance', false);
      this.fetchSnapshot();
      return;
    }

    if (!seqIdManager.validate('binance', u)) {
      return;
    }

    const formatted = {
      exchange: 'binance',
      symbol: this.symbol.toUpperCase(),
      timestamp: Date.now(),
      lastUpdateId: u,
      firstUpdateId: U,
      bids: b.slice(0, this.depth).map(bid => [
        parseFloat(bid[0]),
        parseFloat(bid[1])
      ]),
      asks: a.slice(0, this.depth).map(ask => [
        parseFloat(ask[0]),
        parseFloat(ask[1])
      ]),
      isSnapshot: false
    };

    seqIdManager.generate('binance', u);
    this.lastFinalUpdateId = u;

    if (this.onDataCallback) {
      this.onDataCallback('binance', formatted);
    }
  }

  processBuffer() {
    if (!this.snapshotFetched || this.buffer.length === 0) return;

    console.log(`[Binance] Processing ${this.buffer.length} buffered messages`);

    const bufferCopy = [...this.buffer];
    this.buffer = [];

    for (const msg of bufferCopy) {
      this.handleDepthUpdate({
        e: 'depthUpdate',
        U: msg.U,
        u: msg.u,
        b: msg.b,
        a: msg.a
      });
    }
  }

  attemptReconnect() {
    if (!this.shouldReconnect) {
      console.log('[Binance] Reconnect disabled, stopping');
      return;
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Binance] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Binance] Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${this.reconnectAttempts})`);

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
    console.log('[Binance] Disconnected and reconnect disabled');
  }
}

module.exports = BinanceClient;

const WebSocket = require('ws');
const config = require('../config');

class BinanceClient {
  constructor(symbol = config.symbol, depth = config.depth) {
    this.symbol = symbol.toLowerCase();
    this.depth = depth;
    this.ws = null;
    this.onDataCallback = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
  }

  connect() {
    const streamName = `${this.symbol}@depth${this.depth}@100ms`;
    const url = `${config.binanceWsUrl}/${streamName}`;

    console.log(`[Binance] Connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[Binance] WebSocket connected');
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const formatted = this.formatData(parsed);
        if (this.onDataCallback && formatted) {
          this.onDataCallback('binance', formatted);
        }
      } catch (err) {
        console.error('[Binance] Error parsing message:', err.message);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[Binance] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      console.log('[Binance] WebSocket closed');
      this.attemptReconnect();
    });
  }

  formatData(raw) {
    if (!raw || !raw.bids || !raw.asks) return null;

    return {
      exchange: 'binance',
      symbol: this.symbol.toUpperCase(),
      timestamp: Date.now(),
      bids: raw.bids.slice(0, this.depth).map(bid => [
        parseFloat(bid[0]),
        parseFloat(bid[1])
      ]),
      asks: raw.asks.slice(0, this.depth).map(ask => [
        parseFloat(ask[0]),
        parseFloat(ask[1])
      ])
    };
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Binance] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Binance] Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  onData(callback) {
    this.onDataCallback = callback;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = BinanceClient;

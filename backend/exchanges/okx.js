const WebSocket = require('ws');
const config = require('../config');

class OKXClient {
  constructor(symbol = config.symbol, depth = config.depth) {
    this.symbol = symbol.toUpperCase().replace('USDT', '-USDT');
    this.depth = depth;
    this.ws = null;
    this.onDataCallback = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
  }

  connect() {
    const url = config.okxWsUrl;

    console.log(`[OKX] Connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[OKX] WebSocket connected');
      this.reconnectAttempts = 0;
      this.subscribe();
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        const formatted = this.formatData(parsed);
        if (this.onDataCallback && formatted) {
          this.onDataCallback('okx', formatted);
        }
      } catch (err) {
        console.error('[OKX] Error parsing message:', err.message);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[OKX] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      console.log('[OKX] WebSocket closed');
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

  formatData(raw) {
    if (!raw || raw.arg?.channel !== `books${this.depth}` || !raw.data) {
      return null;
    }

    const data = raw.data[0];
    if (!data || !data.bids || !data.asks) return null;

    return {
      exchange: 'okx',
      symbol: this.symbol.replace('-', ''),
      timestamp: parseInt(data.ts, 10) || Date.now(),
      bids: data.bids.slice(0, this.depth).map(bid => [
        parseFloat(bid[0]),
        parseFloat(bid[1])
      ]),
      asks: data.asks.slice(0, this.depth).map(ask => [
        parseFloat(ask[0]),
        parseFloat(ask[1])
      ])
    };
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[OKX] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[OKX] Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${this.reconnectAttempts})`);

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

module.exports = OKXClient;

class WebSocketClient {
  constructor(url = 'ws://localhost:3000') {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 3000;
    this.onOrderbookCallback = null;
    this.onAnomaliesCallback = null;
    this.onConfigCallback = null;
    this.onConnectionChangeCallback = null;
    this.isConnected = false;
  }

  connect() {
    console.log('[WS] Connecting to', this.url);
    
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyConnectionChange(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error('[WS] Error parsing message:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error.message);
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.isConnected = false;
        this.notifyConnectionChange(false);
        this.attemptReconnect();
      };
    } catch (err) {
      console.error('[WS] Connection error:', err);
      this.attemptReconnect();
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'config':
        if (this.onConfigCallback) {
          this.onConfigCallback(message.data);
        }
        break;
      case 'orderbook':
        if (this.onOrderbookCallback) {
          this.onOrderbookCallback(message.data);
        }
        break;
      case 'anomalies':
        if (this.onAnomaliesCallback) {
          this.onAnomaliesCallback(message.data);
        }
        break;
      default:
        console.log('[WS] Unknown message type:', message.type);
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
    
    console.log(`[WS] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  onOrderbook(callback) {
    this.onOrderbookCallback = callback;
  }

  onAnomalies(callback) {
    this.onAnomaliesCallback = callback;
  }

  onConfig(callback) {
    this.onConfigCallback = callback;
  }

  onConnectionChange(callback) {
    this.onConnectionChangeCallback = callback;
  }

  notifyConnectionChange(connected) {
    if (this.onConnectionChangeCallback) {
      this.onConnectionChangeCallback(connected);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default WebSocketClient;

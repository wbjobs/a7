const config = require('../config');

let sharedBasePrice = 65000 + Math.random() * 5000;
let lastPriceUpdate = Date.now();

class MockExchangeClient {
  constructor(name = 'mock', symbol = config.symbol, depth = config.depth) {
    this.name = name;
    this.symbol = symbol.toUpperCase();
    this.depth = depth;
    this.onDataCallback = null;
    this.intervalId = null;
    this.priceVolatility = 50;
    this.quantityMean = 0.5;
    this.quantityStd = 0.3;
    this.anomalyChance = 0.05;
    this.largeOrderChance = 0.02;
    this.priceOffset = name === 'binance' ? -Math.random() * 2 : Math.random() * 2;
  }

  connect() {
    console.log(`[${this.name}] Mock exchange connected`);
    
    this.intervalId = setInterval(() => {
      const data = this.generateOrderbook();
      if (this.onDataCallback) {
        this.onDataCallback(this.name, data);
      }
    }, 100);

    setTimeout(() => {
      console.log(`[${this.name}] Mock exchange sending data`);
    }, 500);
  }

  generateOrderbook() {
    const now = Date.now();
    if (now - lastPriceUpdate > 100) {
      sharedBasePrice += (Math.random() - 0.5) * this.priceVolatility * 0.1;
      lastPriceUpdate = now;
    }
    
    const effectiveBasePrice = sharedBasePrice + this.priceOffset;
    
    const bids = [];
    const asks = [];

    for (let i = 0; i < this.depth; i++) {
      const bidPrice = effectiveBasePrice - (i + 1) * (5 + Math.random() * 10);
      const askPrice = effectiveBasePrice + (i + 1) * (5 + Math.random() * 10);
      
      let bidQty = this.generateQuantity();
      let askQty = this.generateQuantity();

      if (Math.random() < this.largeOrderChance) {
        bidQty *= 10 + Math.random() * 20;
      }
      if (Math.random() < this.largeOrderChance) {
        askQty *= 10 + Math.random() * 20;
      }

      bids.push([Number(bidPrice.toFixed(2)), Number(bidQty.toFixed(4))]);
      asks.push([Number(askPrice.toFixed(2)), Number(askQty.toFixed(4))]);
    }

    bids.sort((a, b) => b[0] - a[0]);
    asks.sort((a, b) => a[0] - b[0]);

    return {
      exchange: this.name,
      symbol: this.symbol,
      timestamp: Date.now(),
      bids: bids.slice(0, this.depth),
      asks: asks.slice(0, this.depth)
    };
  }

  generateQuantity() {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0.01, this.quantityMean + z * this.quantityStd);
  }

  onData(callback) {
    this.onDataCallback = callback;
  }

  disconnect() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log(`[${this.name}] Mock exchange disconnected`);
  }
}

module.exports = MockExchangeClient;

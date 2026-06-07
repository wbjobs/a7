const config = require('../config');
const seqIdManager = require('../seqIdManager');

let sharedBasePrice = 65000 + Math.random() * 5000;
let lastPriceUpdate = Date.now();
const seqIdCounters = { binance: 0, okx: 0 };
let lastOrderbookData = { binance: null, okx: null };

class MockExchangeClient {
  constructor(name = 'mock', symbol = config.symbol, depth = config.depth) {
    this.name = name;
    this.symbol = symbol.toUpperCase();
    this.depth = depth;
    this.onDataCallback = null;
    this.onSnapshotCallback = null;
    this.intervalId = null;
    this.priceVolatility = 50;
    this.quantityMean = 0.5;
    this.quantityStd = 0.3;
    this.anomalyChance = 0.05;
    this.largeOrderChance = 0.02;
    this.priceOffset = name === 'binance' ? -Math.random() * 2 : Math.random() * 2;
    this.snapshotSent = false;
    this.lastSeqId = 0;
  }

  connect() {
    console.log(`[${this.name}] Mock exchange connected`);
    
    seqIdManager.init(this.name);
    this.snapshotSent = false;
    this.lastSeqId = 0;
    seqIdCounters[this.name] = 0;

    setTimeout(() => {
      this.sendSnapshot();
    }, 100);

    this.intervalId = setInterval(() => {
      if (!this.snapshotSent) return;
      
      const data = this.generateOrderbook();
      if (data && this.onDataCallback) {
        this.onDataCallback(this.name, data);
      }
    }, 100);

    setTimeout(() => {
      console.log(`[${this.name}] Mock exchange sending data`);
    }, 500);
  }

  sendSnapshot() {
    const data = this.generateOrderbook(true);
    if (data) {
      seqIdManager.setSnapshot(this.name, data);
      this.snapshotSent = true;
      this.lastSeqId = data.lastUpdateId;
      
      console.log(`[${this.name}] Mock snapshot sent, seqId: ${data.lastUpdateId}`);
      
      if (this.onSnapshotCallback) {
        this.onSnapshotCallback(this.name, data);
      }
      
      if (this.onDataCallback) {
        this.onDataCallback(this.name, data);
      }
    }
  }

  generateOrderbook(isSnapshot = false) {
    const now = Date.now();
    if (now - lastPriceUpdate > 100) {
      sharedBasePrice += (Math.random() - 0.5) * this.priceVolatility * 0.1;
      lastPriceUpdate = now;
    }
    
    const effectiveBasePrice = sharedBasePrice + this.priceOffset;
    
    const bids = [];
    const asks = [];

    const lastData = lastOrderbookData[this.name];

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

      if (!isSnapshot && lastData && Math.random() < 0.03) {
        const priceKey = Number(bidPrice.toFixed(2));
        const lastBid = lastData.bids.find(b => Math.abs(b[0] - priceKey) < 1);
        if (lastBid && lastBid[1] > 0.5) {
          bidQty = lastBid[1] * (0.1 + Math.random() * 0.3);
        }
      }
      if (!isSnapshot && lastData && Math.random() < 0.03) {
        const priceKey = Number(askPrice.toFixed(2));
        const lastAsk = lastData.asks.find(a => Math.abs(a[0] - priceKey) < 1);
        if (lastAsk && lastAsk[1] > 0.5) {
          askQty = lastAsk[1] * (0.1 + Math.random() * 0.3);
        }
      }

      bids.push([Number(bidPrice.toFixed(2)), Number(bidQty.toFixed(4))]);
      asks.push([Number(askPrice.toFixed(2)), Number(askQty.toFixed(4))]);
    }

    bids.sort((a, b) => b[0] - a[0]);
    asks.sort((a, b) => a[0] - b[0]);

    if (!isSnapshot) {
      lastOrderbookData[this.name] = { bids, asks };
    }

    seqIdCounters[this.name]++;
    const seqId = seqIdCounters[this.name];

    if (!isSnapshot && !seqIdManager.validate(this.name, seqId)) {
      return null;
    }

    if (!isSnapshot) {
      seqIdManager.generate(this.name, seqId);
    }

    return {
      exchange: this.name,
      symbol: this.symbol,
      timestamp: Date.now(),
      lastUpdateId: seqId,
      seqId: seqId,
      isSnapshot: isSnapshot,
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

  onSnapshot(callback) {
    this.onSnapshotCallback = callback;
  }

  disconnect() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.snapshotSent = false;
    seqIdManager.setReady(this.name, false);
    console.log(`[${this.name}] Mock exchange disconnected`);
  }
}

module.exports = MockExchangeClient;

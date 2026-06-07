const BinanceClient = require('./exchanges/binance');
const OKXClient = require('./exchanges/okx');
const MockExchangeClient = require('./exchanges/mockExchange');
const AnomalyDetector = require('./anomalyDetector');
const config = require('./config');

class OrderbookAggregator {
  constructor() {
    this.exchanges = new Map();
    this.orderbooks = {
      binance: { bids: [], asks: [] },
      okx: { bids: [], asks: [] }
    };
    this.aggregatedOrderbook = { bids: [], asks: [] };
    this.anomalyDetector = new AnomalyDetector(config.zScoreThreshold);
    this.onSnapshotCallback = null;
    this.onAnomalyCallback = null;
    this.lastSnapshotTime = 0;
    this.snapshotTimer = null;
    this.fallbackTimeout = null;
    this.usingMockData = false;
  }

  async init() {
    const binance = new BinanceClient();
    const okx = new OKXClient();
    
    this.exchanges.set('binance', binance);
    this.exchanges.set('okx', okx);

    let dataReceived = false;

    for (const [name, client] of this.exchanges) {
      client.onData((exchange, data) => {
        dataReceived = true;
        this.handleData(exchange, data);
      });
      client.connect();
    }

    this.fallbackTimeout = setTimeout(() => {
      if (!dataReceived && !this.usingMockData) {
        console.log('[Aggregator] No data received from real exchanges, falling back to mock data');
        this.useMockData();
      }
    }, 15000);

    this.startSnapshotTimer();
    console.log('[Aggregator] Initialized with exchanges:', Array.from(this.exchanges.keys()));
    console.log('[Aggregator] Will fall back to mock data if no real data in 15s');
  }

  useMockData() {
    this.usingMockData = true;
    
    for (const client of this.exchanges.values()) {
      client.disconnect();
    }
    this.exchanges.clear();

    const mockBinance = new MockExchangeClient('binance');
    const mockOkx = new MockExchangeClient('okx');
    
    this.exchanges.set('binance', mockBinance);
    this.exchanges.set('okx', mockOkx);

    for (const [name, client] of this.exchanges) {
      client.onData((exchange, data) => this.handleData(exchange, data));
      client.connect();
    }

    console.log('[Aggregator] Now using mock data for demonstration');
  }

  handleData(exchange, data) {
    this.orderbooks[exchange] = data;
    this.aggregate();
    this.detectAnomalies();
  }

  aggregate() {
    const priceMap = new Map();

    for (const exchange of ['binance', 'okx']) {
      const ob = this.orderbooks[exchange];
      
      for (const [price, qty] of ob.bids) {
        const key = `b_${price}`;
        const existing = priceMap.get(key) || { price, qty: 0, side: 'bid', exchanges: new Set() };
        existing.qty += qty;
        existing.exchanges.add(exchange);
        priceMap.set(key, existing);
      }

      for (const [price, qty] of ob.asks) {
        const key = `a_${price}`;
        const existing = priceMap.get(key) || { price, qty: 0, side: 'ask', exchanges: new Set() };
        existing.qty += qty;
        existing.exchanges.add(exchange);
        priceMap.set(key, existing);
      }
    }

    const allBids = [];
    const allAsks = [];

    for (const entry of priceMap.values()) {
      if (entry.side === 'bid') {
        allBids.push([entry.price, entry.qty, Array.from(entry.exchanges)]);
      } else {
        allAsks.push([entry.price, entry.qty, Array.from(entry.exchanges)]);
      }
    }

    allBids.sort((a, b) => b[0] - a[0]);
    allAsks.sort((a, b) => a[0] - b[0]);

    const midPrice = this.calculateMidPrice(allBids, allAsks);

    this.aggregatedOrderbook = {
      bids: allBids.slice(0, config.depth),
      asks: allAsks.slice(0, config.depth),
      midPrice,
      spread: allAsks.length > 0 && allBids.length > 0 
        ? allAsks[0][0] - allBids[0][0] 
        : 0,
      timestamp: Date.now(),
      exchangeData: { ...this.orderbooks }
    };

    const allQuantities = [
      ...allBids.slice(0, config.depth).map(b => b[1]),
      ...allAsks.slice(0, config.depth).map(a => a[1])
    ];
    this.anomalyDetector.update(allQuantities);
  }

  calculateMidPrice(bids, asks) {
    if (bids.length === 0 || asks.length === 0) return 0;
    
    const bestBid = bids[0][0];
    const bestAsk = asks[0][0];
    return (bestBid + bestAsk) / 2;
  }

  detectAnomalies() {
    const bidAnomalies = this.anomalyDetector.detectOrders(
      this.aggregatedOrderbook.bids.map(b => [b[0], b[1]]),
      'bid'
    );
    
    const askAnomalies = this.anomalyDetector.detectOrders(
      this.aggregatedOrderbook.asks.map(a => [a[0], a[1]]),
      'ask'
    );

    const allAnomalies = [...bidAnomalies, ...askAnomalies];

    if (allAnomalies.length > 0 && this.onAnomalyCallback) {
      this.onAnomalyCallback(allAnomalies);
    }

    return allAnomalies;
  }

  startSnapshotTimer() {
    this.snapshotTimer = setInterval(() => {
      this.createSnapshot();
    }, config.snapshotInterval);
  }

  createSnapshot() {
    const snapshot = {
      ...this.aggregatedOrderbook,
      anomalyStats: this.anomalyDetector.getStats()
    };

    if (this.onSnapshotCallback) {
      this.onSnapshotCallback(snapshot);
    }

    return snapshot;
  }

  getLatestOrderbook() {
    return this.aggregatedOrderbook;
  }

  getAnomalyStats() {
    return this.anomalyDetector.getStats();
  }

  onSnapshot(callback) {
    this.onSnapshotCallback = callback;
  }

  onAnomaly(callback) {
    this.onAnomalyCallback = callback;
  }

  disconnect() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
    }

    for (const client of this.exchanges.values()) {
      client.disconnect();
    }

    console.log('[Aggregator] Disconnected');
  }
}

module.exports = OrderbookAggregator;

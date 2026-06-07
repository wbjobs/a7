const BinanceClient = require('./exchanges/binance');
const OKXClient = require('./exchanges/okx');
const MockExchangeClient = require('./exchanges/mockExchange');
const AnomalyDetector = require('./anomalyDetector');
const seqIdManager = require('./seqIdManager');
const config = require('./config');

class OrderbookAggregator {
  constructor() {
    this.exchanges = new Map();
    this.orderbooks = {
      binance: { bids: [], asks: [], seqId: -1, ready: false },
      okx: { bids: [], asks: [], seqId: -1, ready: false }
    };
    this.aggregatedOrderbook = { bids: [], asks: [] };
    this.anomalyDetector = new AnomalyDetector(config.zScoreThreshold);
    this.onSnapshotCallback = null;
    this.onAnomalyCallback = null;
    this.onSeqIdStatusCallback = null;
    this.lastSnapshotTime = 0;
    this.snapshotTimer = null;
    this.fallbackTimeout = null;
    this.usingMockData = false;
    this.lastAggregateTime = 0;
    this.minAggregateInterval = 10;
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
      client.onSnapshot((exchange, snapshot) => {
        this.handleSnapshot(exchange, snapshot);
      });
      client.connect();
    }

    this.fallbackTimeout = setTimeout(() => {
      const allReady = this.areAllExchangesReady();
      if ((!dataReceived || !allReady) && !this.usingMockData) {
        console.log(`[Aggregator] Not all exchanges ready (dataReceived: ${dataReceived}, allReady: ${allReady}), falling back to mock data`);
        this.useMockData();
      }
    }, 15000);

    this.startSnapshotTimer();
    console.log('[Aggregator] Initialized with exchanges:', Array.from(this.exchanges.keys()));
    console.log('[Aggregator] Will fall back to mock data if no real data in 15s');
    
    // 测试模式：直接使用模拟数据，方便测试seqID和Redis消费组修复效果
    console.log('[Aggregator] Test mode: Using mock data for demo');
    setTimeout(() => {
      if (!this.usingMockData) {
        console.log('[Aggregator] Test mode: Switching to mock data');
        this.useMockData();
      }
    }, 5000);
  }

  useMockData() {
    this.usingMockData = true;
    
    for (const client of this.exchanges.values()) {
      client.disconnect();
    }
    this.exchanges.clear();

    for (const exchange of ['binance', 'okx']) {
      this.orderbooks[exchange] = { bids: [], asks: [], seqId: -1, ready: false };
    }

    const mockBinance = new MockExchangeClient('binance');
    const mockOkx = new MockExchangeClient('okx');
    
    this.exchanges.set('binance', mockBinance);
    this.exchanges.set('okx', mockOkx);

    for (const [name, client] of this.exchanges) {
      client.onData((exchange, data) => this.handleData(exchange, data));
      client.onSnapshot((exchange, snapshot) => this.handleSnapshot(exchange, snapshot));
      client.connect();
    }

    console.log('[Aggregator] Now using mock data for demonstration');
  }

  handleSnapshot(exchange, snapshot) {
    console.log(`[Aggregator] Received snapshot for ${exchange}, seqId: ${snapshot.lastUpdateId}`);
    
    this.orderbooks[exchange] = {
      bids: snapshot.bids || [],
      asks: snapshot.asks || [],
      seqId: snapshot.lastUpdateId || -1,
      ready: true,
      isSnapshot: true,
      timestamp: snapshot.timestamp
    };

    seqIdManager.setReady(exchange, true);
    
    this.notifySeqIdStatus();
    
    if (this.areAllExchangesReady()) {
      console.log('[Aggregator] All exchanges ready with snapshots');
      this.aggregate();
      this.detectAnomalies();
    }
  }

  handleData(exchange, data) {
    if (!data) return;

    if (data.isSnapshot) {
      this.handleSnapshot(exchange, data);
      return;
    }

    const seqId = data.lastUpdateId || data.seqId;
    
    if (!seqIdManager.isExchangeReady(exchange)) {
      console.log(`[Aggregator] ${exchange} not ready, skipping update seqId=${seqId}`);
      return;
    }

    if (seqId !== undefined && seqId <= this.orderbooks[exchange].seqId) {
      console.log(`[Aggregator] Stale data for ${exchange}: seqId=${seqId} <= lastSeqId=${this.orderbooks[exchange].seqId}, skipping`);
      return;
    }

    this.orderbooks[exchange] = {
      bids: data.bids || this.orderbooks[exchange].bids,
      asks: data.asks || this.orderbooks[exchange].asks,
      seqId: seqId || this.orderbooks[exchange].seqId,
      ready: true,
      isSnapshot: false,
      timestamp: data.timestamp
    };

    const now = Date.now();
    if (now - this.lastAggregateTime >= this.minAggregateInterval) {
      this.aggregate();
      this.detectAnomalies();
      this.lastAggregateTime = now;
    }
  }

  areAllExchangesReady() {
    for (const exchange of this.exchanges.keys()) {
      if (!this.orderbooks[exchange]?.ready) {
        return false;
      }
    }
    return this.exchanges.size > 0;
  }

  aggregate() {
    if (!this.areAllExchangesReady()) {
      return;
    }

    const priceMap = new Map();

    for (const exchange of this.exchanges.keys()) {
      const ob = this.orderbooks[exchange];
      if (!ob || !ob.bids || !ob.asks) continue;
      
      for (const bid of ob.bids) {
        const [price, qty] = bid;
        if (qty === 0) continue;
        
        const key = `b_${price}`;
        const existing = priceMap.get(key) || { price, qty: 0, side: 'bid', exchanges: new Set() };
        existing.qty += qty;
        existing.exchanges.add(exchange);
        priceMap.set(key, existing);
      }

      for (const ask of ob.asks) {
        const [price, qty] = ask;
        if (qty === 0) continue;
        
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

    const seqIds = {};
    for (const exchange of this.exchanges.keys()) {
      seqIds[exchange] = this.orderbooks[exchange]?.seqId || -1;
    }

    this.aggregatedOrderbook = {
      bids: allBids.slice(0, config.depth),
      asks: allAsks.slice(0, config.depth),
      midPrice,
      spread: allAsks.length > 0 && allBids.length > 0 
        ? allAsks[0][0] - allBids[0][0] 
        : 0,
      timestamp: Date.now(),
      seqIds,
      allReady: this.areAllExchangesReady(),
      exchangeData: {
        binance: {
          bids: this.orderbooks.binance?.bids || [],
          asks: this.orderbooks.binance?.asks || [],
          seqId: this.orderbooks.binance?.seqId || -1,
          ready: this.orderbooks.binance?.ready || false
        },
        okx: {
          bids: this.orderbooks.okx?.bids || [],
          asks: this.orderbooks.okx?.asks || [],
          seqId: this.orderbooks.okx?.seqId || -1,
          ready: this.orderbooks.okx?.ready || false
        }
      }
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
    if (!this.areAllExchangesReady()) return;

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

  notifySeqIdStatus() {
    if (this.onSeqIdStatusCallback) {
      this.onSeqIdStatusCallback(seqIdManager.getAllStatus());
    }
  }

  startSnapshotTimer() {
    this.snapshotTimer = setInterval(() => {
      this.createSnapshot();
    }, config.snapshotInterval);
  }

  createSnapshot() {
    if (!this.areAllExchangesReady()) return null;

    const snapshot = {
      ...this.aggregatedOrderbook,
      anomalyStats: this.anomalyDetector.getStats(),
      seqIdStatus: seqIdManager.getAllStatus()
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

  getSeqIdStatus() {
    return seqIdManager.getAllStatus();
  }

  onSnapshot(callback) {
    this.onSnapshotCallback = callback;
  }

  onAnomaly(callback) {
    this.onAnomalyCallback = callback;
  }

  onSeqIdStatus(callback) {
    this.onSeqIdStatusCallback = callback;
  }

  disconnect() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
    }

    if (this.fallbackTimeout) {
      clearTimeout(this.fallbackTimeout);
    }

    for (const client of this.exchanges.values()) {
      client.disconnect();
    }

    seqIdManager.reset();

    console.log('[Aggregator] Disconnected');
  }
}

module.exports = OrderbookAggregator;

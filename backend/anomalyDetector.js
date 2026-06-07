class AnomalyDetector {
  constructor(threshold = 3.0, windowSize = 50, largeOrderThreshold = 2.0) {
    this.threshold = threshold;
    this.windowSize = windowSize;
    this.largeOrderThreshold = largeOrderThreshold;
    this.quantityHistory = [];
    this.mean = 0;
    this.stdDev = 0;
    this.lastOrderbook = null;
    this.largeOrderEvents = [];
  }

  update(quantities) {
    for (const qty of quantities) {
      this.quantityHistory.push(qty);
      if (this.quantityHistory.length > this.windowSize) {
        this.quantityHistory.shift();
      }
    }
    this.calculateStats();
  }

  calculateStats() {
    if (this.quantityHistory.length < 2) {
      this.mean = 0;
      this.stdDev = 0;
      return;
    }

    const n = this.quantityHistory.length;
    const sum = this.quantityHistory.reduce((a, b) => a + b, 0);
    this.mean = sum / n;

    const squaredDiffs = this.quantityHistory.map(q => Math.pow(q - this.mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
    this.stdDev = Math.sqrt(avgSquaredDiff);
  }

  detect(quantity) {
    if (this.stdDev === 0) return { isAnomaly: false, zScore: 0 };
    
    const zScore = (quantity - this.mean) / this.stdDev;
    const isAnomaly = Math.abs(zScore) >= this.threshold;
    
    return {
      isAnomaly,
      zScore,
      severity: Math.abs(zScore) >= this.threshold * 2 ? 'critical' : 'warning'
    };
  }

  detectOrders(orders, side) {
    const anomalies = [];
    for (const order of orders) {
      const result = this.detect(order[1]);
      if (result.isAnomaly) {
        anomalies.push({
          price: order[0],
          quantity: order[1],
          side,
          zScore: result.zScore,
          severity: result.severity,
          timestamp: Date.now()
        });
      }
    }
    return anomalies;
  }

  getStats() {
    return {
      mean: this.mean,
      stdDev: this.stdDev,
      threshold: this.threshold,
      windowSize: this.windowSize,
      historyLength: this.quantityHistory.length
    };
  }

  detectLargeMarketOrders(currentOrderbook) {
    if (!this.lastOrderbook || !currentOrderbook) {
      this.lastOrderbook = currentOrderbook;
      return [];
    }

    const largeOrders = [];
    const now = Date.now();

    const lastBidMap = new Map();
    for (const bid of this.lastOrderbook.bids || []) {
      lastBidMap.set(bid[0], bid[1]);
    }

    for (const bid of currentOrderbook.bids || []) {
      const [price, qty] = bid;
      const lastQty = lastBidMap.get(price) || 0;
      const qtyChange = qty - lastQty;
      const changeRatio = lastQty > 0 ? Math.abs(qtyChange) / lastQty : Math.abs(qtyChange);

      if (qtyChange < 0 && Math.abs(qtyChange) >= this.mean * this.largeOrderThreshold) {
        const event = {
          type: 'large_market_buy',
          side: 'bid',
          price,
          quantity: Math.abs(qtyChange),
          totalValue: price * Math.abs(qtyChange),
          impact: changeRatio,
          timestamp: now,
          severity: changeRatio > 0.5 ? 'critical' : 'warning'
        };
        largeOrders.push(event);
        this.largeOrderEvents.push(event);
      }
    }

    const lastAskMap = new Map();
    for (const ask of this.lastOrderbook.asks || []) {
      lastAskMap.set(ask[0], ask[1]);
    }

    for (const ask of currentOrderbook.asks || []) {
      const [price, qty] = ask;
      const lastQty = lastAskMap.get(price) || 0;
      const qtyChange = qty - lastQty;
      const changeRatio = lastQty > 0 ? Math.abs(qtyChange) / lastQty : Math.abs(qtyChange);

      if (qtyChange < 0 && Math.abs(qtyChange) >= this.mean * this.largeOrderThreshold) {
        const event = {
          type: 'large_market_sell',
          side: 'ask',
          price,
          quantity: Math.abs(qtyChange),
          totalValue: price * Math.abs(qtyChange),
          impact: changeRatio,
          timestamp: now,
          severity: changeRatio > 0.5 ? 'critical' : 'warning'
        };
        largeOrders.push(event);
        this.largeOrderEvents.push(event);
      }
    }

    if (this.largeOrderEvents.length > 100) {
      this.largeOrderEvents = this.largeOrderEvents.slice(-100);
    }

    this.lastOrderbook = currentOrderbook;
    return largeOrders;
  }

  getLargeOrderHistory(count = 20) {
    return this.largeOrderEvents.slice(-count);
  }
}

module.exports = AnomalyDetector;

class AnomalyDetector {
  constructor(threshold = 3.0, windowSize = 50) {
    this.threshold = threshold;
    this.windowSize = windowSize;
    this.quantityHistory = [];
    this.mean = 0;
    this.stdDev = 0;
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
}

module.exports = AnomalyDetector;

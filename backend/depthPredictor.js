class DepthPredictor {
  constructor(predictionWindow = 3000, historySize = 30) {
    this.predictionWindow = predictionWindow;
    this.historySize = historySize;
    this.priceHistory = new Map();
    this.timestamps = [];
  }

  update(orderbook) {
    const { bids, asks, timestamp } = orderbook;
    const now = timestamp || Date.now();

    this.timestamps.push(now);
    if (this.timestamps.length > this.historySize) {
      this.timestamps.shift();
    }

    for (const bid of bids) {
      const [price, qty] = bid;
      const key = `b_${price}`;
      if (!this.priceHistory.has(key)) {
        this.priceHistory.set(key, []);
      }
      const history = this.priceHistory.get(key);
      history.push({ t: now, qty });
      if (history.length > this.historySize) {
        history.shift();
      }
    }

    for (const ask of asks) {
      const [price, qty] = ask;
      const key = `a_${price}`;
      if (!this.priceHistory.has(key)) {
        this.priceHistory.set(key, []);
      }
      const history = this.priceHistory.get(key);
      history.push({ t: now, qty });
      if (history.length > this.historySize) {
        history.shift();
      }
    }

    for (const [key, history] of this.priceHistory) {
      if (history.length > 0 && now - history[history.length - 1].t > 10000) {
        this.priceHistory.delete(key);
      }
    }
  }

  linearRegression(xs, ys) {
    const n = xs.length;
    if (n < 2) return { slope: 0, intercept: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += xs[i];
      sumY += ys[i];
      sumXY += xs[i] * ys[i];
      sumXX += xs[i] * xs[i];
    }

    const denominator = n * sumXX - sumX * sumX;
    if (Math.abs(denominator) < 0.000001) {
      return { slope: 0, intercept: ys[n - 1] };
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  predict(orderbook) {
    const { bids, asks, midPrice } = orderbook;
    const now = Date.now();
    const futureTime = now + this.predictionWindow;

    const predictedBids = [];
    const predictedAsks = [];

    for (const bid of bids) {
      const [price, currentQty] = bid;
      const key = `b_${price}`;
      const history = this.priceHistory.get(key);

      if (!history || history.length < 3) {
        predictedBids.push([price, currentQty * 0.95]);
        continue;
      }

      const xs = history.map(h => h.t);
      const ys = history.map(h => h.qty);
      const { slope, intercept } = this.linearRegression(xs, ys);

      let predictedQty = slope * futureTime + intercept;
      predictedQty = Math.max(0, Math.min(predictedQty, currentQty * 2));

      predictedBids.push([price, predictedQty, Math.abs(slope)]);
    }

    for (const ask of asks) {
      const [price, currentQty] = ask;
      const key = `a_${price}`;
      const history = this.priceHistory.get(key);

      if (!history || history.length < 3) {
        predictedAsks.push([price, currentQty * 0.95]);
        continue;
      }

      const xs = history.map(h => h.t);
      const ys = history.map(h => h.qty);
      const { slope, intercept } = this.linearRegression(xs, ys);

      let predictedQty = slope * futureTime + intercept;
      predictedQty = Math.max(0, Math.min(predictedQty, currentQty * 2));

      predictedAsks.push([price, predictedQty, Math.abs(slope)]);
    }

    return {
      bids: predictedBids,
      asks: predictedAsks,
      midPrice,
      predictionWindow: this.predictionWindow,
      timestamp: now,
      predictedAt: now
    };
  }

  predictAggregatedDepth(orderbook) {
    if (!orderbook || !orderbook.bids || !orderbook.asks) {
      return null;
    }

    this.update(orderbook);
    return this.predict(orderbook);
  }

  clear() {
    this.priceHistory.clear();
    this.timestamps = [];
  }
}

module.exports = DepthPredictor;

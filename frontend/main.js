import OrderbookVisualizer from './js/OrderbookVisualizer.js';
import WebSocketClient from './js/WebSocketClient.js';
import TimelinePlayer from './js/TimelinePlayer.js';

class App {
  constructor() {
    this.visualizer = null;
    this.wsClient = null;
    this.timelinePlayer = null;
    this.currentAnomalies = [];
    this.currentLargeOrders = [];
    this.maxAnomaliesDisplay = 20;
    this.maxLargeOrdersDisplay = 20;
    this.exchangeStatus = { binance: false, okx: false };
    
    this.init();
  }

  init() {
    const canvas = document.getElementById('threeCanvas');
    this.visualizer = new OrderbookVisualizer(canvas);
    
    this.wsClient = new WebSocketClient('ws://localhost:3000');
    this.timelinePlayer = new TimelinePlayer();
    
    this.setupWebSocketHandlers();
    this.setupTimelineHandlers();
    this.setupUIHandlers();
    
    this.wsClient.connect();
    
    console.log('[App] Initialized');
  }

  setupWebSocketHandlers() {
    this.wsClient.onConfig((config) => {
      document.getElementById('symbol').textContent = config.symbol;
      console.log('[App] Config received:', config);
    });

    this.wsClient.onOrderbook((orderbook) => {
      if (this.timelinePlayer.isLive) {
        this.timelinePlayer.addSnapshot(orderbook);
        this.updateOrderbook(orderbook);
      }
      
      this.updateExchangeStatus(orderbook);
    });

    this.wsClient.onAnomalies((anomalies) => {
      this.currentAnomalies = [...this.currentAnomalies, ...anomalies].slice(-this.maxAnomaliesDisplay * 2);
      this.updateAnomalyList(anomalies);
      this.visualizer.updateAnomalies(this.currentAnomalies.slice(-this.maxAnomaliesDisplay));
      this.updateAnomalyCount();
    });

    this.wsClient.onLargeOrders((largeOrders) => {
      this.currentLargeOrders = [...this.currentLargeOrders, ...largeOrders].slice(-this.maxLargeOrdersDisplay * 2);
      this.updateLargeOrderList(largeOrders);
      this.visualizer.triggerLargeOrderParticles(largeOrders);
      this.updateLargeOrderCount();
    });

    this.wsClient.onPrediction((prediction) => {
      this.visualizer.updatePrediction(prediction);
    });

    this.wsClient.onConnectionChange((connected) => {
      const statusEl = document.getElementById('connectionStatus');
      if (connected) {
        statusEl.textContent = '已连接';
        statusEl.className = 'value status-connected';
        this.timelinePlayer.loadSnapshots(300);
      } else {
        statusEl.textContent = '未连接';
        statusEl.className = 'value status-disconnected';
        this.exchangeStatus.binance = false;
        this.exchangeStatus.okx = false;
        this.updateExchangeStatusUI();
      }
    });
  }

  setupTimelineHandlers() {
    this.timelinePlayer.onSnapshot((snapshot) => {
      this.updateOrderbook(snapshot);
    });

    this.timelinePlayer.onTimeUpdate((info) => {
      this.updateTimelineUI(info);
    });

    this.timelinePlayer.onModeChange((info) => {
      this.updatePlaybackControls(info);
    });
  }

  setupUIHandlers() {
    document.getElementById('playBtn').addEventListener('click', () => {
      this.timelinePlayer.play();
    });

    document.getElementById('pauseBtn').addEventListener('click', () => {
      this.timelinePlayer.pause();
    });

    document.getElementById('liveBtn').addEventListener('click', () => {
      this.timelinePlayer.goLive();
    });

    document.getElementById('timelineSlider').addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      const snapshots = this.timelinePlayer.getSnapshots();
      if (snapshots.length > 0) {
        const index = Math.floor((value / 100) * (snapshots.length - 1));
        this.timelinePlayer.seekTo(index);
      }
    });

    document.getElementById('speedSelect').addEventListener('change', (e) => {
      this.timelinePlayer.setSpeed(parseFloat(e.target.value));
    });

    document.getElementById('showAnomalies').addEventListener('change', (e) => {
      this.visualizer.setShowAnomalies(e.target.checked);
    });

    document.getElementById('showAxes').addEventListener('change', (e) => {
      this.visualizer.setShowAxes(e.target.checked);
    });

    document.getElementById('autoRotate').addEventListener('change', (e) => {
      this.visualizer.setAutoRotate(e.target.checked);
    });

    document.getElementById('thresholdSlider').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('thresholdValue').textContent = value.toFixed(1);
    });

    document.getElementById('resetCameraBtn').addEventListener('click', () => {
      this.visualizer.resetCamera();
    });

    document.getElementById('showPrediction').addEventListener('change', (e) => {
      this.visualizer.setShowPrediction(e.target.checked);
    });
  }

  updateOrderbook(orderbook) {
    this.visualizer.updateOrderbook(orderbook);
    this.updateStats(orderbook);
  }

  updateStats(orderbook) {
    const { bids, asks, midPrice, spread, anomalyStats } = orderbook;

    if (midPrice) {
      document.getElementById('midPrice').textContent = `$${midPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (spread !== undefined) {
      document.getElementById('spread').textContent = `$${spread.toFixed(2)}`;
    }

    if (bids.length > 0) {
      document.getElementById('bestBid').textContent = `$${bids[0][0].toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const totalBidQty = bids.reduce((sum, b) => sum + b[1], 0);
      document.getElementById('totalBidQty').textContent = `${totalBidQty.toFixed(4)}`;
    }

    if (asks.length > 0) {
      document.getElementById('bestAsk').textContent = `$${asks[0][0].toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const totalAskQty = asks.reduce((sum, a) => sum + a[1], 0);
      document.getElementById('totalAskQty').textContent = `${totalAskQty.toFixed(4)}`;
    }

    if (anomalyStats) {
      document.getElementById('zMean').textContent = anomalyStats.mean.toFixed(4);
      document.getElementById('zStd').textContent = anomalyStats.stdDev.toFixed(4);
    }
  }

  updateExchangeStatus(orderbook) {
    if (orderbook.exchangeData) {
      if (orderbook.exchangeData.binance?.bids?.length > 0) {
        this.exchangeStatus.binance = true;
      }
      if (orderbook.exchangeData.okx?.bids?.length > 0) {
        this.exchangeStatus.okx = true;
      }
      this.updateExchangeStatusUI();
    }
  }

  updateExchangeStatusUI() {
    const binanceEl = document.getElementById('binanceStatus');
    const okxEl = document.getElementById('okxStatus');

    if (this.exchangeStatus.binance) {
      binanceEl.className = 'exchange-status-indicator status-connected pulse';
    } else {
      binanceEl.className = 'exchange-status-indicator status-disconnected';
    }

    if (this.exchangeStatus.okx) {
      okxEl.className = 'exchange-status-indicator status-connected pulse';
    } else {
      okxEl.className = 'exchange-status-indicator status-disconnected';
    }
  }

  updateAnomalyList(newAnomalies) {
    const listEl = document.getElementById('anomalyList');
    
    if (newAnomalies.length === 0 && listEl.querySelector('.empty-state')) {
      return;
    }

    if (listEl.querySelector('.empty-state')) {
      listEl.innerHTML = '';
    }

    for (const anomaly of newAnomalies.slice().reverse()) {
      const itemEl = this.createAnomalyItem(anomaly);
      listEl.insertBefore(itemEl, listEl.firstChild);
    }

    const items = listEl.querySelectorAll('.anomaly-item');
    if (items.length > this.maxAnomaliesDisplay) {
      for (let i = this.maxAnomaliesDisplay; i < items.length; i++) {
        items[i].remove();
      }
    }
  }

  createAnomalyItem(anomaly) {
    const div = document.createElement('div');
    div.className = `anomaly-item ${anomaly.severity}`;
    
    const sideText = anomaly.side === 'bid' ? '买单' : '卖单';
    const sideClass = anomaly.side;
    const zscoreClass = anomaly.severity;
    
    const time = new Date(anomaly.timestamp).toLocaleTimeString();
    
    div.innerHTML = `
      <div class="anomaly-header">
        <span class="anomaly-side ${sideClass}">${sideText}</span>
        <span class="anomaly-zscore ${zscoreClass}">Z: ${anomaly.zScore.toFixed(2)}</span>
      </div>
      <div class="anomaly-details">
        价格: $${anomaly.price.toLocaleString()} | 数量: ${anomaly.quantity.toFixed(4)} | ${time}
      </div>
    `;
    
    return div;
  }

  updateAnomalyCount() {
    document.getElementById('anomalyCount').textContent = this.currentAnomalies.length;
  }

  updateLargeOrderList(newLargeOrders) {
    const listEl = document.getElementById('largeOrderList');
    
    if (newLargeOrders.length === 0 && listEl.querySelector('.empty-state')) {
      return;
    }

    if (listEl.querySelector('.empty-state')) {
      listEl.innerHTML = '';
    }

    for (const largeOrder of newLargeOrders.slice().reverse()) {
      const itemEl = this.createLargeOrderItem(largeOrder);
      listEl.insertBefore(itemEl, listEl.firstChild);
    }

    const items = listEl.querySelectorAll('.large-order-item');
    if (items.length > this.maxLargeOrdersDisplay) {
      for (let i = this.maxLargeOrdersDisplay; i < items.length; i++) {
        items[i].remove();
      }
    }
  }

  createLargeOrderItem(largeOrder) {
    const div = document.createElement('div');
    div.className = `large-order-item ${largeOrder.severity}`;
    
    const typeText = largeOrder.type === 'large_market_buy' ? '大额买单' : '大额卖单';
    const typeClass = largeOrder.type === 'large_market_buy' ? 'bid' : 'ask';
    const severityClass = largeOrder.severity;
    
    const time = new Date(largeOrder.timestamp).toLocaleTimeString();
    
    div.innerHTML = `
      <div class="large-order-header">
        <span class="large-order-type ${typeClass}">${typeText}</span>
        <span class="large-order-impact ${severityClass}">冲击: ${(largeOrder.impact * 100).toFixed(1)}%</span>
      </div>
      <div class="large-order-details">
        价格: $${largeOrder.price.toLocaleString()} | 数量: ${largeOrder.quantity.toFixed(4)} | ${time}
      </div>
    `;
    
    return div;
  }

  updateLargeOrderCount() {
    document.getElementById('largeOrderCount').textContent = this.currentLargeOrders.length;
  }

  updateTimelineUI(info) {
    const slider = document.getElementById('timelineSlider');
    if (info.total > 1) {
      const percent = (info.currentIndex / (info.total - 1)) * 100;
      slider.value = percent;
    }

    document.getElementById('startTime').textContent = this.formatTime(info.startTime);
    document.getElementById('currentTime').textContent = this.timelinePlayer.isLive ? '实时' : this.formatTime(info.timestamp);
    document.getElementById('endTime').textContent = this.formatTime(info.endTime);
  }

  updatePlaybackControls(info) {
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const liveBtn = document.getElementById('liveBtn');

    playBtn.disabled = info.isPlaying || info.total < 2;
    pauseBtn.disabled = !info.isPlaying;
    liveBtn.classList.toggle('btn-primary', info.isLive);
    
    if (info.isLive) {
      document.getElementById('currentTime').textContent = '实时';
    }
  }

  formatTime(timestamp) {
    if (!timestamp) return '--';
    return new Date(timestamp).toLocaleTimeString();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});

require('dotenv').config({ path: '../.env' });

module.exports = {
  port: process.env.PORT || 3000,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  binanceWsUrl: process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws',
  okxWsUrl: process.env.OKX_WS_URL || 'wss://ws.okx.com:8443/ws/v5/public',
  symbol: process.env.SYMBOL || 'BTCUSDT',
  depth: parseInt(process.env.DEPTH || '20', 10),
  snapshotInterval: parseInt(process.env.SNAPSHOT_INTERVAL || '1000', 10),
  zScoreThreshold: parseFloat(process.env.Z_SCORE_THRESHOLD || '3.0'),
  streamName: 'orderbook_snapshots',
  maxSnapshots: 3600
};

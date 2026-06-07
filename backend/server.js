const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const OrderbookAggregator = require('./orderbookAggregator');
const redisClient = require('./redisClient');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const aggregator = new OrderbookAggregator();
let connectedClients = new Set();
let recentAnomalies = [];
const MAX_ANOMALIES_HISTORY = 100;

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    redisConnected: redisClient.connected,
    clientsConnected: connectedClients.size
  });
});

app.get('/api/orderbook', (req, res) => {
  const orderbook = aggregator.getLatestOrderbook();
  res.json(orderbook);
});

app.get('/api/anomalies', (req, res) => {
  const count = parseInt(req.query.count || '50', 10);
  res.json(recentAnomalies.slice(-count));
});

app.get('/api/anomaly-stats', (req, res) => {
  const stats = aggregator.getAnomalyStats();
  res.json(stats);
});

app.get('/api/snapshots', async (req, res) => {
  const count = parseInt(req.query.count || '100', 10);
  const snapshots = await redisClient.getSnapshots(count);
  res.json(snapshots);
});

app.get('/api/snapshots/range', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end timestamps required' });
  }
  const snapshots = await redisClient.getSnapshotsByTimeRange(
    parseInt(start, 10),
    parseInt(end, 10)
  );
  res.json(snapshots);
});

app.get('/api/snapshots/latest', async (req, res) => {
  const snapshot = await redisClient.getLatestSnapshot();
  res.json(snapshot || {});
});

app.get('/api/config', (req, res) => {
  res.json({
    symbol: config.symbol,
    depth: config.depth,
    zScoreThreshold: config.zScoreThreshold,
    exchanges: ['binance', 'okx']
  });
});

wss.on('connection', (ws) => {
  console.log('[Server] New WebSocket client connected');
  connectedClients.add(ws);

  ws.send(JSON.stringify({
    type: 'config',
    data: {
      symbol: config.symbol,
      depth: config.depth,
      zScoreThreshold: config.zScoreThreshold,
      exchanges: ['binance', 'okx']
    }
  }));

  const latestOrderbook = aggregator.getLatestOrderbook();
  if (latestOrderbook.bids.length > 0) {
    ws.send(JSON.stringify({
      type: 'orderbook',
      data: latestOrderbook
    }));
  }

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      console.log('[Server] Received message:', parsed.type);
    } catch (err) {
      console.error('[Server] Error parsing client message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[Server] WebSocket client disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err.message);
    connectedClients.delete(ws);
  });
});

function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('Crypto Orderbook Visualization Server');
  console.log('========================================');

  const redisConnected = await redisClient.connect();
  
  aggregator.onSnapshot(async (snapshot) => {
    broadcast('orderbook', snapshot);
    
    if (redisConnected) {
      await redisClient.addSnapshot(snapshot);
    }
  });

  aggregator.onAnomaly((anomalies) => {
    console.log(`[Server] Detected ${anomalies.length} anomalies`);
    
    recentAnomalies.push(...anomalies);
    if (recentAnomalies.length > MAX_ANOMALIES_HISTORY) {
      recentAnomalies = recentAnomalies.slice(-MAX_ANOMALIES_HISTORY);
    }
    
    broadcast('anomalies', anomalies);
  });

  await aggregator.init();

  server.listen(config.port, () => {
    console.log(`\n[Server] HTTP server listening on port ${config.port}`);
    console.log(`[Server] WebSocket server ready on ws://localhost:${config.port}`);
    console.log(`[Server] Monitoring ${config.symbol} across Binance and OKX`);
    console.log('\nEndpoints:');
    console.log('  GET /api/health        - Health check');
    console.log('  GET /api/orderbook     - Current aggregated orderbook');
    console.log('  GET /api/anomalies     - Recent anomalies');
    console.log('  GET /api/snapshots     - Historical snapshots');
    console.log('  GET /api/config        - Server configuration');
    console.log('\nPress Ctrl+C to stop\n');
  });
}

process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down gracefully...');
  aggregator.disconnect();
  await redisClient.disconnect();
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Shutting down gracefully...');
  aggregator.disconnect();
  await redisClient.disconnect();
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});

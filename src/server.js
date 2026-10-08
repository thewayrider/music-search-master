const express = require('express');
const cors = require('cors');
const path = require('path');
const fleetManager = require('./services/fleetManager');

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for LAN and Android Mobile App
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());

// Serve static Command Center UI
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// --- Fleet REST API Endpoints ---

// 1. Full Fleet & Database Telemetry
app.get('/api/fleet/status', (req, res) => {
  try {
    const status = fleetManager.getFleetStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Trigger on-demand crawler/radar run
app.post('/api/fleet/trigger/:serviceId', (req, res) => {
  const { serviceId } = req.params;
  const result = fleetManager.triggerService(serviceId);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// 3. Stop running crawler
app.post('/api/fleet/stop/:serviceId', (req, res) => {
  const { serviceId } = req.params;
  const result = fleetManager.stopService(serviceId);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// 4. Stream circular log buffer
app.get('/api/fleet/logs/:serviceId', (req, res) => {
  const { serviceId } = req.params;
  const logs = fleetManager.getServiceLogs(serviceId);
  if (logs.error) {
    return res.status(404).json(logs);
  }
  res.json(logs);
});

// 5. Recent discoveries from master SQLite
app.get('/api/fleet/recent-discoveries', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 25;
  try {
    const tracks = fleetManager.getRecentDiscoveries(limit);
    res.json({ count: tracks.length, tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Unified Fleet Command Center',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Fallback for single-page app
app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start listening on 0.0.0.0 for LAN, Lenovo, and Android access
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================================`);
  console.log(`🛰️  UNIFIED FLEET COMMAND CENTER IS ONLINE`);
  console.log(`--------------------------------------------------------`);
  console.log(`🌐 Local Access:    http://localhost:${PORT}`);
  console.log(`📱 LAN/Bridge Mode: http://0.0.0.0:${PORT}`);
  console.log(`💾 Master SQLite:   data/master_catalog.sqlite`);
  console.log(`========================================================\n`);
});

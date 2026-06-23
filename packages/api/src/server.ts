import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { db, checkConnection } from './db/connection.js';
import { profileRoutes } from './routes/profiles.js';
import { customerRoutes } from './routes/customers.js';
import { nicheRoutes } from './routes/niches.js';
import { batchRoutes } from './routes/batches.js';
import { pipelineRoutes } from './routes/pipeline.js';
import { mlRoutes } from './routes/ml.js';
import { statsRoutes } from './routes/stats.js';
import { settingsRoutes } from './routes/settings.js';
import { importRoutes } from './routes/import.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' }
    }
  },
  connectionTimeout: 15000,
  keepAliveTimeout: 60000
});

// Plugins
await app.register(cors, { origin: true, credentials: true });
await app.register(websocket);
await app.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip
});

// Health check
app.get('/api/health', async () => ({
  status: 'ok',
  version: '4.0.0',
  uptime: process.uptime(),
  timestamp: new Date().toISOString()
}));

// Routes
const routes = [
  profileRoutes, customerRoutes, nicheRoutes,
  batchRoutes, pipelineRoutes, mlRoutes, statsRoutes,
  settingsRoutes, importRoutes
];
for (const register of routes) {
  await app.register(register, { prefix: '/api' });
}

// WebSocket for real-time pipeline updates
app.register(async function wsRoutes(scope) {
  scope.get('/ws/pipeline', { websocket: true }, (socket) => {
    app.log.info('Pipeline monitor connected');
    socket.on('message', (msg: string) => {
      socket.send(JSON.stringify({ echo: msg }));
    });
  });
});

// Start
async function start() {
  try {
    await checkConnection();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`🚀 Hermes API running on http://${HOST}:${PORT}`);
    app.log.info(`📊 Health: http://localhost:${PORT}/api/health`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'] as const;
for (const signal of signals) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    process.exit(0);
  });
}

start();

export { app, db };

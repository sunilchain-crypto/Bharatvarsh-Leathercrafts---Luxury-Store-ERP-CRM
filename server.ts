/**
 * Full-Stack Express Server Entry Point for Bharatvarsh Leathercrafts LLP
 * Runs Express API routes and mounts Vite dev server middleware on Port 3000.
 */

import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './src/server/api.ts';
import { cartRecovery } from './src/server/cartRecovery.ts';
import { db } from './src/server/db.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const isBundledServer = path.basename(__filename) === 'server.js';
  const isProduction = process.env.NODE_ENV === 'production' || isBundledServer;
  const PORT = !isProduction ? 3000 : (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

  // Initialize Hostinger MySQL in the background so port 3000 binds immediately
  const mysqlInitPromise = db.initializeMySQL().catch(err => {
    console.error('[DB] MySQL startup initialization failed, continuing with local disk persistence:', err);
  });

  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint responds immediately once HTTP server binds
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'healthy',
      app: 'Bharatvarsh Leathercrafts LLP',
      primaryHub: 'Pune, Maharashtra',
      timestamp: new Date().toISOString()
    });
  });

  // Ensure API requests wait for MySQL hydration before reading/mutating state
  app.use('/api', async (_req, _res, next) => {
    await mysqlInitPromise;
    next();
  });

  // Mount API Router
  app.use('/api', apiRouter);

  // Legacy compatibility alias so persisted or cached /src/assets/images/* URLs still resolve
  const legacyImagesDir = isProduction
    ? path.resolve(__dirname, 'dist', 'assets', 'images')
    : path.resolve(__dirname, 'public', 'assets', 'images');
  app.use('/src/assets/images', express.static(legacyImagesDir));

  // Start background abandoned cart detection worker (every 60s)
  cartRecovery.startBackgroundWorker(60000);

  if (!isProduction) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';

    // Mount Vite dev server middleware and attach HMR WS to httpServer (avoids port 24678 conflicts)
    const viteReadyPromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: hmrDisabled ? false : { server: httpServer },
          ws: hmrDisabled ? false : undefined
        },
        appType: 'spa',
      })
    );

    if (hmrDisabled) {
      // Vite 8 still serves /@vite/client and tries to open ws://...:24678 even when hmr/ws=false;
      // stub out transport.connect while preserving CSS injection and module HMR helpers.
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const vite = await viteReadyPromise;
          const transformed = await vite.transformRequest('/@vite/client');
          if (transformed?.code) {
            const patched = transformed.code.replace(
              'transport.connect(createHMRHandler(handleMessage));',
              '/* HMR WebSocket connection disabled via DISABLE_HMR=true */'
            );
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(patched);
          }
        } catch {
          // Fall through to vite.middlewares
        }
        return next();
      });
    }

    app.use(async (req, res, next) => {
      try {
        const vite = await viteReadyPromise;
        return vite.middlewares(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
  } else {
    // Production static file serving
    const distPath = path.resolve(__dirname, 'dist');
    const indexPath = path.resolve(distPath, 'index.html');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      if (!fs.existsSync(indexPath)) {
        return res.status(503).send('Production bundle missing. Please run npm run build.');
      }
      return res.sendFile(indexPath);
    });
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[Bharatvarsh Server] HTTP server error on port ${PORT}:`, err);
    process.exit(1);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Bharatvarsh Server] Listening at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

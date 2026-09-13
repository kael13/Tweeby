'use strict';

import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';

import config from './config/index.js';
import apiRoutes from './routes/apiRoutes.js';
import setupSockets from './sockets/telemetrySocket.js';
import errorHandler from './middleware/errorHandler.js';

// Ensure necessary storage directories exist
fs.mkdirSync(config.storage.downloadDir, { recursive: true });
fs.mkdirSync(config.storage.archiveDir, { recursive: true });
fs.mkdirSync(config.storage.subtitlesCacheDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());

// Serve static frontend assets
app.use(express.static(config.publicDir));
app.use('/src', express.static(config.srcDir));
app.use('/archives', express.static(config.storage.archiveDir));
app.use('/downloads', express.static(config.storage.downloadDir));

// Mount master API routes
app.use('/api', apiRoutes);

// Real-time WebSockets
setupSockets(io);

// Global Error Handler
app.use(errorHandler);

// Helper to start listening with automatic port hunting if port is occupied
function startListening(port, maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️  Port ${port} is currently in use.`);
        if (maxAttempts > 0) {
          const nextPort = port + 1;
          console.log(`🔄 Auto-adjusting to next available port: ${nextPort}...`);
          server.removeListener('error', onError);
          resolve(startListening(nextPort, maxAttempts - 1));
        } else {
          reject(new Error(`Could not find an available port after 30 attempts starting from ${config.port}`));
        }
      } else {
        reject(err);
      }
    };

    server.once('error', onError);

    server.listen(port, config.host, () => {
      server.removeListener('error', onError);
      config.port = port;
      resolve(port);
    });
  });
}

// Start server with dynamic port resolution
startListening(config.port)
  .then((boundPort) => {
    config.logStatus();
    console.log(`\n🚀 Tweeby Server is live!`);
    console.log(`   ➜ Local:   http://localhost:${boundPort}`);

    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`   ➜ Network: http://${net.address}:${boundPort} (${name})`);
        }
      }
    }
    console.log('');
  })
  .catch((err) => {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  });

export default server;


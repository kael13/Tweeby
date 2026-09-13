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

// Start server
server.listen(config.port, config.host, () => {
  config.logStatus();
  console.log(`\n🚀 Tweeby Server is live!`);
  console.log(`   ➜ Local:   http://localhost:${config.port}`);

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   ➜ Network: http://${net.address}:${config.port} (${name})`);
      }
    }
  }
  console.log('');
});

export default server;

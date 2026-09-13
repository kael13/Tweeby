'use strict';

import {
  client,
  optimizer,
  emitProgress,
  setSocketServer,
} from '../services/webtorrentEngine.js';

export function setupSockets(io) {
  setSocketServer(io);

  // Sampler tick: drive the peer optimizer for every active torrent
  setInterval(() => {
    for (const t of client.torrents) {
      const hash = (t.infoHash || t._tweebyHash || '').toLowerCase();
      if (!hash) continue;
      const result = optimizer.tick(hash);
      const s = optimizer.summary(hash);
      io.to(hash).emit('peers', {
        infoHash: hash,
        peers: result.peers,
        active: s.active,
        topRate: s.topRate,
        avgRate: s.avgRate,
      });
    }
  }, 1000);

  io.on('connection', (socket) => {
    socket.on('join', (infoHash) => {
      const h = (infoHash || '').toLowerCase();
      if (!h) return;
      socket.join(h);
      const t = client.torrents.find((x) => (x.infoHash || x._tweebyHash || '').toLowerCase() === h);
      if (t) emitProgress(t);
    });

    socket.on('disconnect', () => {
      // no-op
    });
  });
}

export default setupSockets;

'use strict';

import fs from 'fs';
import path from 'path';
import WebTorrent from 'webtorrent';
import config from '../config/index.js';
import PeerOptimizer from './peerOptimizerService.js';
import ArchiverService from './archiverService.js';

const DOWNLOAD_DIR = config.storage.downloadDir;
const ARCHIVE_DIR = config.storage.archiveDir;

export const client = new WebTorrent({
  maxConns: config.torrent.maxConns,
  downloadLimit: -1, // unlimited
  uploadLimit: -1,   // unlimited
});

export const optimizer = new PeerOptimizer({
  sampleMs: config.peerOptimizer.sampleMs,
  graceMs: config.peerOptimizer.graceMs,
  minRatio: config.peerOptimizer.minRatio,
  minPeersToPrune: config.peerOptimizer.minPeersToPrune,
});

// Track per-infoHash jobs so we can report & archive.
export const jobs = new Map(); // infoHash -> { torrent, state, archive, lastActiveAt, archiveWanted, tmdb, name, format }

let ioInstance = null;

export function setSocketServer(io) {
  ioInstance = io;
}

export function getSocketServer() {
  return ioInstance;
}

export function touchTorrentActivity(hash) {
  if (!hash) return;
  const h = String(hash).toLowerCase();
  const job = jobs.get(h);
  if (job) {
    job.lastActiveAt = Date.now();
  }
}

// Inactive swarm maintenance: throttle piece pulling for unarchived streams idle for >30 mins
setInterval(() => {
  const now = Date.now();
  for (const [, job] of jobs.entries()) {
    if (!job.archiveWanted && job.torrent && !job.torrent.done) {
      if (job.lastActiveAt && (now - job.lastActiveAt > 30 * 60 * 1000)) {
        try {
          if (typeof job.torrent.deselect === 'function' && job.torrent.pieces?.length) {
            job.torrent.deselect(0, job.torrent.pieces.length - 1, 0);
          }
        } catch (_) { }
      }
    }
  }
}, 5 * 60 * 1000);

client.on('error', (err) => {
  console.error('[client] error:', err.message);
});

export function emitProgress(torrent) {
  if (!ioInstance) return;
  const hash = (torrent.infoHash || torrent._tweebyHash || '').toLowerCase();
  if (!hash) return;
  const pct = (torrent.progress || 0) * 100;
  const downloaded = torrent.downloaded || 0;
  const length = torrent.length || 0;
  const uploadSpeed = torrent.uploadSpeed || 0;
  const downloadSpeed = torrent.downloadSpeed || 0;
  const numPeers = torrent.numPeers || 0;
  const ratio = torrent.ratio || 0;

  const progress = {
    infoHash: hash,
    name: torrent.name || 'Torrent',
    state: torrent.done ? 'complete' : 'downloading',
    progress: pct,
    downloaded,
    length,
    downloadSpeed,
    uploadSpeed,
    numPeers,
    ratio,
    timeRemaining: torrent.timeRemaining, // ms
  };

  ioInstance.emit('progress', progress);
}

export function wireTorrentEvents(torrent) {
  if (!torrent || torrent._tweebyWired) return;
  torrent._tweebyWired = true;

  const getHash = () => (torrent.infoHash || torrent._tweebyHash || '').toLowerCase();

  // Wire up peer tracking
  torrent.on('wire', (wire) => {
    const h = getHash();
    if (h) optimizer.addPeer(h, wire);
    wire.on('close', () => {
      const h2 = getHash();
      if (h2) optimizer.removePeer(h2, wire);
    });
  });

  // Progress reporting
  torrent.on('download', () => {
    emitProgress(torrent);
  });

  // Metadata resolution event
  torrent.on('metadata', () => {
    const h = getHash();
    const job = h ? jobs.get(h) : null;
    if (job) {
      job.name = torrent.name;
    }
    if (h) {
      optimizer.attach(h);
      emitProgress(torrent);
      if (ioInstance) {
        ioInstance.emit('metadata', {
          infoHash: h,
          name: torrent.name,
          numFiles: torrent.files?.length || 0,
        });
      }
    }
  });

  torrent.on('done', () => {
    const h = getHash();
    emitProgress(torrent);
    if (h) {
      optimizer.detach(h);
      const job = jobs.get(h);
      if (job) job.state = 'complete';
      if (ioInstance) {
        ioInstance.emit('status', {
          infoHash: h,
          name: torrent.name,
          state: 'complete',
        });
      }
    }
  });
}

export function extractInfoHashFromMagnet(magnetUri) {
  if (!magnetUri || typeof magnetUri !== 'string') return null;
  const match = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return match ? match[1].toLowerCase() : null;
}

export function extractMagnetDn(magnetUri) {
  try {
    const url = new URL(magnetUri);
    return url.searchParams.get('dn') || null;
  } catch (_) {
    return null;
  }
}

/**
 * Add a magnet/torrent link and start downloading.
 */
export function startDownload(magnetUri, format = 'zip') {
  return new Promise((resolve, reject) => {
    const targetHash = extractInfoHashFromMagnet(magnetUri);
    const magnetDn = extractMagnetDn(magnetUri);

    let torrent = client.torrents.find((t) => {
      const h = (t.infoHash || t._tweebyHash || '').toLowerCase();
      return (targetHash && h === targetHash) || t.magnetURI === magnetUri;
    });

    if (torrent) {
      const resolvedHash = (torrent.infoHash || targetHash || torrent._tweebyHash || '').toLowerCase();
      if (resolvedHash && !jobs.has(resolvedHash)) {
        jobs.set(resolvedHash, {
          torrent,
          name: torrent.name || magnetDn || 'Torrent',
          state: torrent.done ? 'complete' : 'downloading',
          archive: null,
          format,
        });
      }
      wireTorrentEvents(torrent);
      if (resolvedHash) optimizer.attach(resolvedHash);
      return resolve({
        infoHash: resolvedHash,
        name: torrent.name || magnetDn || 'Torrent',
        ready: Boolean(torrent.metadata && torrent.files && torrent.files.length > 0),
      });
    }

    try {
      torrent = client.add(magnetUri, {
        path: DOWNLOAD_DIR,
        announce: config.torrent.trackers,
      });
      if (targetHash) {
        torrent._tweebyHash = targetHash;
      }
      const resolvedHash = (targetHash || torrent.infoHash || '').toLowerCase();

      if (resolvedHash && !jobs.has(resolvedHash)) {
        jobs.set(resolvedHash, {
          torrent,
          name: torrent.name || magnetDn || 'Torrent',
          state: 'downloading',
          archive: null,
          format,
        });
      }
      wireTorrentEvents(torrent);

      torrent.on('error', (err) => {
        console.error(`[torrent] error on ${resolvedHash || 'unknown'}:`, err.message);
      });

      torrent.on('infoHash', () => {
        if (torrent.infoHash) {
          const actualHash = torrent.infoHash.toLowerCase();
          torrent._tweebyHash = actualHash;
          const existingJob = resolvedHash ? jobs.get(resolvedHash) : null;
          if (existingJob) {
            jobs.set(actualHash, existingJob);
          } else {
            jobs.set(actualHash, {
              torrent,
              name: torrent.name || magnetDn || 'Torrent',
              state: 'downloading',
              archive: null,
              format,
            });
          }
          optimizer.attach(actualHash);
        }
      });

      resolve({
        infoHash: resolvedHash,
        name: torrent.name || magnetDn || 'Torrent',
        ready: Boolean(torrent.metadata && torrent.files && torrent.files.length > 0),
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Compress a completed torrent into the requested format and broadcast the result.
 */
export async function archiveTorrent(infoHash) {
  const job = jobs.get(infoHash);
  if (!job) return;
  if (!job.torrent.done) return;
  if (job.archive) return; // already archived

  const sourceDir = path.join(DOWNLOAD_DIR, job.torrent.name);
  if (!fs.existsSync(sourceDir)) {
    throw new Error('Downloaded folder missing on disk.');
  }

  job.state = 'compressing';
  if (ioInstance) {
    ioInstance.to(infoHash).emit('status', {
      infoHash,
      name: job.torrent.name,
      state: 'compressing',
    });
  }

  const fmt = job.format === 'rar' ? 'rar' : 'zip';
  const result = await ArchiverService.compress(sourceDir, ARCHIVE_DIR, fmt);

  job.archive = result;
  job.state = 'archived';

  if (ioInstance) {
    ioInstance.to(infoHash).emit('archive', {
      infoHash,
      name: job.torrent.name,
      archive: {
        filename: path.basename(result.path),
        format: result.format,
        url: `/archives/${path.basename(result.path)}`,
      },
    });
  }

  return result;
}

/**
 * Stop and remove a torrent from the WebTorrent client and jobs map.
 */
export function removeTorrent(identifier, deleteStore = false) {
  return new Promise((resolve) => {
    if (!identifier) return resolve(false);
    const h = String(identifier).toLowerCase();

    // Find torrent in client or jobs
    let torrent = client.torrents.find((t) => {
      const th = (t.infoHash || t._tweebyHash || '').toLowerCase();
      return th === h || t.name === identifier || (t.files && t.files.some((f) => f.path === identifier || f.name === identifier));
    });

    const jobEntry = jobs.get(h) || Array.from(jobs.entries()).find(([, j]) => j.name === identifier || (j.torrent && j.torrent.name === identifier));
    const resolvedHash = torrent ? (torrent.infoHash || torrent._tweebyHash || '').toLowerCase() : (jobEntry ? jobEntry[0] : h);

    if (resolvedHash) {
      optimizer.detach(resolvedHash);
      jobs.delete(resolvedHash);
    }

    if (torrent) {
      try {
        client.remove(torrent, { destroyStore: deleteStore }, () => {
          if (ioInstance && resolvedHash) {
            ioInstance.emit('torrentRemoved', { infoHash: resolvedHash });
          }
          resolve(true);
        });
        return;
      } catch (_) {
        resolve(false);
        return;
      }
    }

    if (ioInstance && resolvedHash) {
      ioInstance.emit('torrentRemoved', { infoHash: resolvedHash });
    }
    resolve(Boolean(jobEntry));
  });
}

export default {
  client,
  optimizer,
  jobs,
  setSocketServer,
  getSocketServer,
  touchTorrentActivity,
  emitProgress,
  wireTorrentEvents,
  extractInfoHashFromMagnet,
  extractMagnetDn,
  startDownload,
  archiveTorrent,
  removeTorrent,
};


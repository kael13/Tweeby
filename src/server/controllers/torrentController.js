'use strict';

import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import {
  client,
  jobs,
  startDownload,
} from '../services/webtorrentEngine.js';
import { resolveMimeType, isStreamable } from '../middleware/staticMime.js';
import { findPosterIndex, sniffMediaType } from '../utils/fileHelpers.js';
import { getMediaDuration } from '../services/ffmpegService.js';
import { fetchTmdbMetadata } from '../services/tmdbService.js';

const DOWNLOAD_DIR = config.storage.downloadDir;

export async function postDownload(req, res) {
  const { magnet, format } = req.body || {};
  if (!magnet || typeof magnet !== 'string' || !magnet.startsWith('magnet:')) {
    return res.status(400).json({ error: 'A valid magnet: link is required.' });
  }
  const fmt = format === 'rar' ? 'rar' : 'zip';
  try {
    const info = await startDownload(magnet.trim(), fmt);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function getActiveTorrents(req, res) {
  const list = client.torrents.map((t) => {
    const hash = (t.infoHash || t._tweebyHash || '').toLowerCase();
    const job = hash ? jobs.get(hash) : null;
    return {
      infoHash: hash,
      name: t.name || job?.name || 'Torrent',
      progress: (t.progress || 0) * 100,
      downloadSpeed: t.downloadSpeed || 0,
      numPeers: t.numPeers || 0,
      done: Boolean(t.done),
      length: t.length || 0,
    };
  });
  res.json(list);
}

export async function getTorrentFiles(req, res) {
  const infoHash = (req.params.infoHash || '').toLowerCase();
  const job = jobs.get(infoHash);
  const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === infoHash);
  if (!torrent) {
    if (job) {
      return res.json({
        infoHash,
        name: job.name || 'Torrent',
        ready: false,
        files: [],
        tmdb: job.tmdb || null,
      });
    }
    return res.status(404).json({ error: 'Torrent not found.' });
  }

  // If metadata is not resolved yet, return immediately without blocking!
  if (!torrent.files || torrent.files.length === 0) {
    return res.json({
      infoHash,
      name: torrent.name || job?.name || 'Torrent',
      ready: false,
      files: [],
      tmdb: job?.tmdb || null,
    });
  }

  const files = await Promise.all(
    torrent.files.map(async (f, i) => {
      let type = resolveMimeType(f.name, f.type);
      let duration = null;
      const diskPath = path.join(DOWNLOAD_DIR, f.path || f.name);
      if (fs.existsSync(diskPath)) {
        try {
          const stat = fs.statSync(diskPath);
          const isComplete = stat.size >= (f.length || 0) && (torrent.progress >= 1 || f.progress >= 1);
          if (isComplete) {
            duration = await getMediaDuration(diskPath);
          }
        } catch (_) { }
        if (type === 'application/octet-stream') {
          const sniffed = await sniffMediaType(f);
          if (sniffed) type = sniffed;
        }
      }
      return {
        index: i,
        name: f.name,
        path: f.path,
        length: f.length,
        type,
        progress: f.progress || 0,
        streamable: isStreamable(type),
        duration,
      };
    })
  );

  const images = files.filter((f) => (f.type || '').startsWith('image/'));

  let torrentTmdb = job?.tmdb || null;
  if (!torrentTmdb && torrent.name) {
    torrentTmdb = await fetchTmdbMetadata(torrent.name);
    if (job) job.tmdb = torrentTmdb;
  }

  for (const f of files) {
    const t = f.type || '';
    if (t.startsWith('video/') || t.startsWith('audio/')) {
      const idx = findPosterIndex(f, images);
      if (idx !== undefined) {
        f.posterIndex = idx;
        const img = images.find((x) => x.index === idx);
        if (img) img.usedAsPoster = true;
      }
      if (t.startsWith('video/') && torrentTmdb) {
        f.tmdb = torrentTmdb;
        f.posterUrl = torrentTmdb.posterUrl;
        f.backdropUrl = torrentTmdb.backdropUrl;
        if (!f.duration && torrentTmdb.runtime && torrentTmdb.runtime > 0) {
          f.duration = torrentTmdb.runtime * 60;
        }
      }
    }
  }

  res.json({
    infoHash,
    name: torrent.name,
    ready: true,
    files,
    tmdb: torrentTmdb,
  });
}

export function prioritizeFile(req, res) {
  const infoHash = (req.params.infoHash || '').toLowerCase();
  const fileIndex = Number(req.params.fileIndex);
  const job = jobs.get(infoHash);
  const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === infoHash);
  if (!torrent || !torrent.files) return res.status(404).json({ error: 'Torrent not found.' });

  const file = torrent.files[fileIndex];
  if (!file) return res.status(404).json({ error: 'File not found.' });

  try {
    file.select(1);
    if (file._startPiece !== undefined && file._endPiece !== undefined && typeof torrent.critical === 'function') {
      torrent.critical(file._startPiece, Math.min(file._endPiece, file._startPiece + 8));
      torrent.critical(Math.max(file._startPiece, file._endPiece - 2), file._endPiece);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function prioritizeSeek(req, res) {
  const { infoHash, fileIndex, time, duration } = req.query;
  if (!infoHash) return res.status(400).json({ error: 'infoHash is required' });

  const h = String(infoHash).toLowerCase();
  const job = jobs.get(h);
  const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === h);
  if (!torrent || !torrent.files) {
    return res.json({ prioritized: false });
  }

  const fIdx = parseInt(fileIndex, 10) || 0;
  const file = torrent.files[fIdx] || torrent.files[0];
  if (!file) return res.json({ prioritized: false });

  const seekTime = Math.max(0, parseFloat(time) || 0);
  const totalDuration = Math.max(1, parseFloat(duration) || 5400);
  const ratio = Math.min(0.99, Math.max(0, seekTime / totalDuration));

  if (file._startPiece !== undefined && file._endPiece !== undefined) {
    const totalPieces = file._endPiece - file._startPiece + 1;
    const targetPiece = Math.min(
      file._endPiece,
      Math.max(
        file._startPiece,
        Math.floor(file._startPiece + ratio * totalPieces)
      )
    );
    const tier1End = Math.min(file._endPiece, targetPiece + 4);
    const tier2End = Math.min(file._endPiece, targetPiece + 25);

    try {
      if (typeof torrent.critical === 'function') {
        // Tier 1: Immediate critical pieces
        torrent.critical(targetPiece, tier1End);
        // Container header & index atom protection
        torrent.critical(file._startPiece, Math.min(file._endPiece, file._startPiece + 2));
        torrent.critical(Math.max(file._startPiece, file._endPiece - 2), file._endPiece);
      }
      if (typeof torrent.select === 'function' && tier1End < tier2End) {
        // Tier 2: Lookahead sliding buffer
        torrent.select(tier1End + 1, tier2End, 1);
      }
      return res.json({
        prioritized: true,
        targetPiece,
        tier1End,
        tier2End,
        numPeers: torrent.numPeers || 0,
        speed: torrent.downloadSpeed || 0,
      });
    } catch (_) { }
  }

  res.json({ prioritized: false });
}

export default {
  postDownload,
  getActiveTorrents,
  getTorrentFiles,
  prioritizeFile,
  prioritizeSeek,
};

'use strict';

import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import pump from 'pump';
import rangeParser from 'range-parser';
import config from '../config/index.js';
import {
  client,
  jobs,
  touchTorrentActivity,
} from '../services/webtorrentEngine.js';
import { resolveMimeType } from '../middleware/staticMime.js';
import { sniffMediaType } from '../utils/fileHelpers.js';
import { getVideoEncoderArgs, getMediaDuration } from '../services/ffmpegService.js';
import { fetchTmdbMetadata } from '../services/tmdbService.js';

const DOWNLOAD_DIR = config.storage.downloadDir;

export async function getMediaDurationHandler(req, res) {
  const { path: relPath, infoHash, fileIndex, title } = req.query;

  let targetPath = null;
  let mediaName = title || null;
  let isTorrent = false;
  let isComplete = false;

  if (relPath) {
    targetPath = path.join(DOWNLOAD_DIR, path.normalize(relPath).replace(/^(\.\.[\/\\])+/, ''));
    if (!mediaName) mediaName = path.basename(relPath);
    isComplete = fs.existsSync(targetPath);
  } else if (infoHash !== undefined) {
    const h = String(infoHash).toLowerCase();
    const job = jobs.get(h);
    const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === h);
    if (!mediaName) mediaName = torrent?.name || job?.name;
    isTorrent = true;
    if (fileIndex !== undefined && torrent?.files) {
      const file = torrent.files[Number(fileIndex)];
      if (file) {
        targetPath = path.join(DOWNLOAD_DIR, file.path || file.name);
        if (!mediaName) mediaName = file.name;
        if (fs.existsSync(targetPath)) {
          try {
            const stat = fs.statSync(targetPath);
            isComplete = stat.size >= (file.length || 0) && (torrent.progress >= 1 || file.progress >= 1);
          } catch (_) { }
        }
      }
    }
  }

  // 1. For swarms or when media name/title is known, TMDB runtime gives the authoritative full duration
  if (mediaName) {
    try {
      const tmdbMeta = await fetchTmdbMetadata(mediaName);
      if (tmdbMeta?.runtime && tmdbMeta.runtime > 0) {
        return res.json({ duration: tmdbMeta.runtime * 60, source: 'tmdb' });
      }
    } catch (_) { }
  }

  // 2. Only probe disk if file is complete (not a partial torrent fragment)
  if (targetPath && fs.existsSync(targetPath) && (!isTorrent || isComplete)) {
    const dur = await getMediaDuration(targetPath);
    if (dur && dur > 30) return res.json({ duration: dur, source: 'ffprobe' });
  }

  res.json({ duration: null });
}

export async function streamFile(req, res) {
  const infoHash = (req.params.infoHash || '').toLowerCase();
  touchTorrentActivity(infoHash);
  const fileIndex = Number(req.params.fileIndex);
  const job = jobs.get(infoHash);
  const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === infoHash);
  if (!torrent || !torrent.files) return res.status(404).end();

  const file = torrent.files[fileIndex];
  if (!file) return res.status(404).end();

  // If live AAC audio transcoding / remuxing is requested:
  if (req.query.transcode) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );

    const startSec = Math.max(0, parseFloat(req.query.start || req.query.ss || '0') || 0);
    const isH264 = req.query.transcode === 'h264' || req.query.transcode === 'full' || req.query.transcode === 'universal';
    const diskPath = path.join(DOWNLOAD_DIR, file.path || file.name);

    try {
      if (file._startPiece !== undefined && file._endPiece !== undefined && typeof torrent.critical === 'function') {
        const estDuration = torrent?.duration || (job?.tmdb?.runtime ? job.tmdb.runtime * 60 : null) || 5400;
        if (startSec > 0) {
          const ratio = Math.min(0.99, Math.max(0, startSec / estDuration));
          const targetPiece = Math.floor(file._startPiece + ratio * (file._endPiece - file._startPiece));
          const tier1End = Math.min(file._endPiece, targetPiece + 4);
          const tier2End = Math.min(file._endPiece, targetPiece + 25);

          // Tier 1: Immediate critical pieces
          torrent.critical(targetPiece, tier1End);
          // Tier 2: Lookahead buffer
          if (typeof torrent.select === 'function' && tier1End < tier2End) {
            torrent.select(tier1End + 1, tier2End, 1);
          }
        } else {
          torrent.critical(file._startPiece, Math.min(file._endPiece, file._startPiece + 6));
          if (typeof torrent.select === 'function') {
            torrent.select(file._startPiece + 7, Math.min(file._endPiece, file._startPiece + 25), 1);
          }
        }
        // Container header and index atom protection
        torrent.critical(file._startPiece, Math.min(file._endPiece, file._startPiece + 2));
        torrent.critical(Math.max(file._startPiece, file._endPiece - 2), file._endPiece);
      }
    } catch (_) { }

    if (fs.existsSync(diskPath)) {
      try {
        const diskStat = fs.statSync(diskPath);
        if (diskStat.size >= file.length) {
          const ffArgs = [
            '-loglevel', 'warning',
            '-fflags', '+genpts+discardcorrupt+fastseek',
          ];
          if (startSec > 0) {
            ffArgs.push('-ss', String(startSec));
          }
          ffArgs.push('-i', diskPath, '-map', '0:v:0?', '-map', '0:a:0?');

          if (isH264) {
            ffArgs.push(...getVideoEncoderArgs());
          } else {
            ffArgs.push('-c:v', 'copy');
          }

          ffArgs.push(
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ac', '2',
            '-af', 'aresample=async=1000:min_hard_comp=0.100000:first_pts=0',
            '-avoid_negative_ts', 'make_zero',
            '-max_muxing_queue_size', '2048',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            '-f', 'mp4',
            'pipe:1'
          );
          const ff = spawn('ffmpeg', ffArgs);
          ff.stdout.pipe(res);
          ff.stderr.on('data', (d) => console.warn('[FFmpeg remux disk]', d.toString().trim()));
          ff.on('error', (err) => console.error('[FFmpeg disk spawn error]', err.message));
          res.on('close', () => {
            try { ff.kill('SIGKILL'); } catch (_) { }
          });
          return;
        }
      } catch (_) { }
    }

    let inStream;
    const ffArgs = [
      '-loglevel', 'warning',
      '-analyzeduration', '2000000',
      '-probesize', '2000000',
      '-fflags', '+genpts+discardcorrupt+fastseek',
      '-err_detect', 'ignore_err',
    ];

    if (startSec > 0) {
      ffArgs.push('-ss', String(startSec));
    }
    ffArgs.push('-i', 'pipe:0', '-map', '0:v:0?', '-map', '0:a:0?');

    if (isH264) {
      ffArgs.push(...getVideoEncoderArgs());
    } else {
      ffArgs.push('-c:v', 'copy');
    }

    ffArgs.push(
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ac', '2',
      '-af', 'aresample=async=1000:min_hard_comp=0.100000:first_pts=0',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '2048',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1'
    );

    const ff = spawn('ffmpeg', ffArgs);

    inStream = file.createReadStream();
    inStream.pipe(ff.stdin);
    ff.stdout.pipe(res);

    inStream.on('error', (err) => console.warn('[StreamPipe] inStream error:', err.message));
    ff.stdin.on('error', () => { });
    ff.stdout.on('error', () => { });
    ff.stderr.on('data', (d) => console.warn('[FFmpeg remux]', d.toString().trim()));
    ff.on('error', (err) => console.error('[FFmpeg spawn error]', err.message));
    res.on('close', () => {
      try { inStream.destroy(); } catch (_) { }
      try { ff.kill('SIGKILL'); } catch (_) { }
    });
    return;
  }

  let type = resolveMimeType(file.name, file.type);
  const diskPath = path.join(DOWNLOAD_DIR, file.path || file.name);
  if (type === 'application/octet-stream' && fs.existsSync(diskPath)) {
    const sniffed = await sniffMediaType(file);
    if (sniffed) type = sniffed;
  }

  const len = file.length;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', type || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`
  );

  if (len === 0) {
    res.setHeader('Content-Length', 0);
    return res.status(200).end();
  }

  let start = 0;
  let end = len - 1;
  let status = 200;

  if (req.headers.range) {
    const ranges = rangeParser(len, req.headers.range);
    if (ranges === -2 || ranges === -1) {
      res.setHeader('Content-Range', `bytes */${len}`);
      return res.status(416).end();
    }
    const r = ranges[0];
    start = r.start;
    end = r.end;
    status = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${len}`);
  }

  res.status(status);
  res.setHeader('Content-Length', end - start + 1);

  if (fs.existsSync(diskPath)) {
    try {
      const diskStat = fs.statSync(diskPath);
      if (diskStat.size >= len || diskStat.size > end) {
        const diskStream = fs.createReadStream(diskPath, { start, end, highWaterMark: 256 * 1024 });
        diskStream.on('error', () => {
          try { res.destroy(); } catch (_) { }
        });
        res.on('close', () => diskStream.destroy());
        pump(diskStream, res);
        return;
      }
    } catch (_) { }
  }

  if (file._startPiece !== undefined && file._endPiece !== undefined) {
    const totalPieces = file._endPiece - file._startPiece + 1;
    const targetPiece = Math.min(
      file._endPiece,
      Math.max(
        file._startPiece,
        Math.floor(file._startPiece + (start / Math.max(1, len)) * totalPieces)
      )
    );
    const tier1End = Math.min(file._endPiece, targetPiece + 4);
    const tier2End = Math.min(file._endPiece, targetPiece + 25);

    try {
      if (typeof torrent.critical === 'function') {
        // Tier 1: Immediate critical pieces for rapid demuxing
        torrent.critical(targetPiece, tier1End);
        // Container header & index atom protection
        torrent.critical(file._startPiece, Math.min(file._endPiece, file._startPiece + 2));
        torrent.critical(Math.max(file._startPiece, file._endPiece - 2), file._endPiece);
      }
      if (typeof torrent.select === 'function' && tier1End < tier2End) {
        // Tier 2: Lookahead sliding buffer
        torrent.select(tier1End + 1, tier2End, 1);
      }
    } catch (_) { }
  }

  const stream = file.createReadStream({ start, end });
  stream.on('error', () => {
    try { res.destroy(); } catch (_) { }
  });
  res.on('close', () => stream.destroy());
  pump(stream, res);
}

export function streamLocal(req, res) {
  const relPath = req.query.path;
  if (!relPath) return res.status(400).end();
  const safePath = path.join(DOWNLOAD_DIR, path.normalize(relPath).replace(/^(\.\.[\/\\])+/, ''));
  if (!fs.existsSync(safePath)) return res.status(404).end();

  const stat = fs.statSync(safePath);
  const len = stat.size;
  const mimeType = resolveMimeType(path.basename(safePath));

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(safePath))}`);

  if (len === 0) {
    res.setHeader('Content-Length', 0);
    return res.status(200).end();
  }

  let start = 0;
  let end = len - 1;
  let status = 200;

  if (req.headers.range) {
    const ranges = rangeParser(len, req.headers.range);
    if (ranges === -2 || ranges === -1) {
      res.setHeader('Content-Range', `bytes */${len}`);
      return res.status(416).end();
    }
    const r = ranges[0];
    start = r.start;
    end = r.end;
    status = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${len}`);
  }

  res.status(status);
  res.setHeader('Content-Length', end - start + 1);

  const stream = fs.createReadStream(safePath, { start, end, highWaterMark: 256 * 1024 });
  stream.on('error', () => {
    try { res.destroy(); } catch (_) { }
  });
  res.on('close', () => stream.destroy());
  pump(stream, res);
}

export function transcodeLocal(req, res) {
  const relPath = req.query.path;
  if (!relPath) return res.status(400).end();
  const safePath = path.join(DOWNLOAD_DIR, path.normalize(relPath).replace(/^(\.\.[\/\\])+/, ''));
  if (!fs.existsSync(safePath)) return res.status(404).end();

  const startSec = Math.max(0, parseFloat(req.query.start || req.query.ss || '0') || 0);
  const isH264 = req.query.transcode === 'h264' || req.query.transcode === 'full' || req.query.transcode === 'universal';

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'none');

  const ffArgs = ['-loglevel', 'error'];
  if (startSec > 0) {
    ffArgs.push('-ss', String(startSec));
  }
  ffArgs.push('-i', safePath, '-map', '0:v:0?', '-map', '0:a:0?');

  if (isH264) {
    ffArgs.push(...getVideoEncoderArgs());
  } else {
    ffArgs.push('-c:v', 'copy');
  }

  ffArgs.push(
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  );

  const ff = spawn('ffmpeg', ffArgs);

  ff.stdout.pipe(res);
  ff.on('error', () => { });
  res.on('close', () => {
    try { ff.kill('SIGKILL'); } catch (_) { }
  });
}

export function closeStream(req, res) {
  const { infoHash } = req.body || {};
  const h = (infoHash || '').toLowerCase();
  const job = jobs.get(h);
  const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === h);

  if (torrent && !torrent.done && !job?.archiveWanted) {
    try {
      if (typeof torrent.deselect === 'function' && torrent.pieces?.length) {
        torrent.deselect(0, torrent.pieces.length - 1, 0);
      }
    } catch (_) { }
  }
  res.json({ ok: true });
}

export default {
  getMediaDurationHandler,
  streamFile,
  streamLocal,
  transcodeLocal,
  closeStream,
};

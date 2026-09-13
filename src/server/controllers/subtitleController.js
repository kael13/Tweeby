'use strict';

import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import config from '../config/index.js';
import {
  client,
  jobs,
  touchTorrentActivity,
} from '../services/webtorrentEngine.js';
import {
  getMediaSubtitles,
  getSubtitleCacheKey,
} from '../services/subtitleService.js';

const DOWNLOAD_DIR = config.storage.downloadDir;

export async function listSubtitles(req, res) {
  const { path: relPath, infoHash, fileIndex } = req.query;

  let targetPath = null;
  if (relPath) {
    targetPath = path.join(DOWNLOAD_DIR, path.normalize(relPath).replace(/^(\.\.[\/\\])+/, ''));
  } else if (infoHash !== undefined && fileIndex !== undefined) {
    const h = String(infoHash).toLowerCase();
    const job = jobs.get(h);
    const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === h);
    const file = torrent?.files?.[Number(fileIndex)];
    if (file) {
      targetPath = path.join(DOWNLOAD_DIR, file.path || file.name);
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    return res.json({ subtitles: [] });
  }

  const subtitles = await getMediaSubtitles(targetPath);
  res.json({ subtitles });
}

export async function streamSubtitles(req, res) {
  const { path: relPath, infoHash, fileIndex, track, extPath, start, ss } = req.query;
  const startSec = Math.max(0, parseFloat(start || ss || '0') || 0);

  let targetPath = null;
  if (relPath) {
    targetPath = path.join(DOWNLOAD_DIR, path.normalize(relPath).replace(/^(\.\.[\/\\])+/, ''));
  } else if (infoHash !== undefined && fileIndex !== undefined) {
    const h = String(infoHash).toLowerCase();
    touchTorrentActivity(h);
    const job = jobs.get(h);
    const torrent = job?.torrent || client.torrents.find((t) => (t.infoHash || t._tweebyHash || '').toLowerCase() === h);
    const file = torrent?.files?.[Number(fileIndex)];
    if (file) {
      targetPath = path.join(DOWNLOAD_DIR, file.path || file.name);
    }
  }

  if (extPath) {
    const fullExt = path.join(DOWNLOAD_DIR, path.normalize(extPath).replace(/^(\.\.[\/\\])+/, ''));
    if (fs.existsSync(fullExt)) {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (fullExt.endsWith('.vtt')) {
        return fs.createReadStream(fullExt, { highWaterMark: 64 * 1024 }).pipe(res);
      }

      const cachedExtVtt = getSubtitleCacheKey(fullExt, 'ext');
      if (fs.existsSync(cachedExtVtt)) {
        return fs.createReadStream(cachedExtVtt, { highWaterMark: 64 * 1024 }).pipe(res);
      }

      try {
        const rawSrt = await fs.promises.readFile(fullExt, 'utf8');
        const vtt = 'WEBVTT\n\n' + rawSrt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        await fs.promises.writeFile(cachedExtVtt, vtt, 'utf8').catch(() => { });
        return res.send(vtt);
      } catch (_) { }
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    return res.status(404).send('Media file not found');
  }

  const trackIndex = parseInt(track, 10) || 0;
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const cacheFile = getSubtitleCacheKey(targetPath, trackIndex);

  if (fs.existsSync(cacheFile)) {
    if (startSec > 0) {
      const ff = spawn('ffmpeg', [
        '-loglevel', 'error',
        '-ss', String(startSec),
        '-i', cacheFile,
        '-f', 'webvtt',
        'pipe:1',
      ]);
      ff.stdout.pipe(res);
      req.on('close', () => { try { ff.kill('SIGTERM'); } catch (_) { } });
      ff.on('error', () => {
        if (!res.headersSent) res.status(500).send('Error extracting subtitles');
      });
      return;
    }
    return fs.createReadStream(cacheFile, { highWaterMark: 64 * 1024 }).pipe(res);
  }

  const tempExtract = `${cacheFile}.tmp.${Date.now()}`;
  const ffArgs = ['-loglevel', 'error', '-i', targetPath, '-map', `0:s:${trackIndex}`, '-f', 'webvtt', tempExtract];

  const ffmpeg = spawn('ffmpeg', ffArgs);

  ffmpeg.on('close', async (code) => {
    if (code === 0 && fs.existsSync(tempExtract)) {
      await fs.promises.rename(tempExtract, cacheFile).catch(() => { });
      if (!res.headersSent) {
        if (startSec > 0) {
          const ffSeek = spawn('ffmpeg', ['-loglevel', 'error', '-ss', String(startSec), '-i', cacheFile, '-f', 'webvtt', 'pipe:1']);
          ffSeek.stdout.pipe(res);
          req.on('close', () => { try { ffSeek.kill('SIGTERM'); } catch (_) { } });
        } else {
          fs.createReadStream(cacheFile, { highWaterMark: 64 * 1024 }).pipe(res);
        }
      }
    } else {
      try { await fs.promises.unlink(tempExtract); } catch (_) { }
      if (!res.headersSent) res.status(500).send('Error extracting subtitles');
    }
  });

  req.on('close', () => {
    try { ffmpeg.kill('SIGTERM'); } catch (_) { }
    try { fs.unlinkSync(tempExtract); } catch (_) { }
  });

  ffmpeg.on('error', () => {
    if (!res.headersSent) res.status(500).send('Error extracting subtitles');
  });
}

export default {
  listSubtitles,
  streamSubtitles,
};

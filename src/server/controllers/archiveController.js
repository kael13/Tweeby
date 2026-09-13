'use strict';

import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import { jobs, archiveTorrent } from '../services/webtorrentEngine.js';
import { scanLibraryDir, baseNameNoExt, POSTER_NAMES } from '../utils/fileHelpers.js';
import { fetchTmdbMetadata } from '../services/tmdbService.js';
import { getMediaDuration } from '../services/ffmpegService.js';

const DOWNLOAD_DIR = config.storage.downloadDir;

export async function getLibrary(req, res) {
  const allFiles = scanLibraryDir(DOWNLOAD_DIR);
  const images = allFiles.filter((f) => f.category === 'image');

  const library = await Promise.all(
    allFiles.map(async (f, idx) => {
      let posterUrl = null;
      let tmdbMeta = null;

      if (f.category === 'image') {
        posterUrl = f.streamUrl;
      } else if (f.category === 'video' || f.category === 'audio') {
        const dir = path.dirname(f.relPath);
        const base = baseNameNoExt(f.name);
        const match = images.find((img) => path.dirname(img.relPath) === dir && (baseNameNoExt(img.name) === base || POSTER_NAMES.includes(baseNameNoExt(img.name))))
          || images.find((img) => path.dirname(img.relPath) === dir);

        if (match) {
          posterUrl = match.streamUrl;
        } else if (f.category === 'video') {
          tmdbMeta = (await fetchTmdbMetadata(f.name)) || (await fetchTmdbMetadata(path.basename(dir)));
          if (tmdbMeta?.posterUrl) {
            posterUrl = tmdbMeta.posterUrl;
          }
        }
      }

      let duration = null;
      if (f.category === 'video' || f.category === 'audio') {
        const fullDiskPath = path.join(DOWNLOAD_DIR, f.relPath);
        duration = await getMediaDuration(fullDiskPath);
      }

      const folderParts = f.relPath.split('/');
      const groupName = folderParts.length > 1 ? folderParts[0] : 'Downloads';

      return {
        id: `local-${idx}`,
        name: f.name,
        path: f.relPath,
        length: f.size,
        type: f.type,
        category: f.category,
        streamUrl: f.streamUrl,
        posterUrl,
        backdropUrl: tmdbMeta?.backdropUrl || null,
        tmdb: tmdbMeta,
        progress: 1.0,
        isLocal: true,
        torrentName: groupName,
        jobState: 'complete',
        duration,
      };
    })
  );

  res.json({ items: library });
}

export function verifyMedia(req, res) {
  const relPath = req.query.path;
  if (!relPath || typeof relPath !== 'string') {
    return res.status(400).json({ exists: false, error: 'Path parameter is required.' });
  }

  const safePath = path.join(DOWNLOAD_DIR, path.normalize(relPath).replace(/^(\.\.[\/\\])+/, ''));
  const exists = fs.existsSync(safePath);
  let size = 0;
  if (exists) {
    try {
      const stat = fs.statSync(safePath);
      size = stat.size;
    } catch (_) {}
  }

  res.json({ exists, size, path: relPath });
}

export async function postArchive(req, res) {
  const { infoHash, format } = req.body || {};
  const h = (infoHash || '').toLowerCase();
  const job = jobs.get(h);
  if (!job) return res.status(404).json({ error: 'Torrent not found.' });
  if (!job.torrent?.done) {
    return res.status(409).json({ error: 'Download is not complete yet.' });
  }
  if (format) job.format = format === 'rar' ? 'rar' : 'zip';

  try {
    const result = await archiveTorrent(h);
    res.json({
      infoHash: h,
      name: job.torrent.name,
      archive: {
        filename: path.basename(result.path),
        format: result.format,
        url: `/archives/${path.basename(result.path)}`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default {
  getLibrary,
  verifyMedia,
  postArchive,
};

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

/**
 * Delete one or multiple media files from storage, pruning empty directories
 * and removing active WebTorrent swarms.
 */
export async function deleteMedia(req, res) {
  const rawPaths = req.body?.paths || (req.body?.path ? [req.body.path] : (req.query?.path ? [req.query.path] : []));
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    return res.status(400).json({ error: 'At least one valid media path is required.' });
  }

  const deletedPaths = [];
  let freedBytes = 0;
  const errors = [];
  const resolvedDownloadDir = path.resolve(DOWNLOAD_DIR);

  for (const rawPath of rawPaths) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) continue;

    const normalized = path.normalize(rawPath).replace(/^[/\\]+/, '');
    const fullPath = path.resolve(DOWNLOAD_DIR, normalized);

    // Prevent directory traversal escaping DOWNLOAD_DIR
    if (rawPath.includes('..') || !fullPath.startsWith(resolvedDownloadDir) || fullPath === resolvedDownloadDir) {
      errors.push({ path: rawPath, error: 'Access denied: Path outside storage directory.' });
      continue;
    }


    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          freedBytes += stat.size;
          fs.unlinkSync(fullPath);
          deletedPaths.push(normalized);

          // Clean up parent directory if empty
          let parentDir = path.dirname(fullPath);
          while (parentDir !== resolvedDownloadDir && parentDir.startsWith(resolvedDownloadDir)) {
            try {
              const entries = fs.readdirSync(parentDir);
              const nonHidden = entries.filter((e) => !e.startsWith('.'));
              if (nonHidden.length === 0) {
                // Remove hidden files (like .DS_Store) and then the directory
                for (const e of entries) {
                  try { fs.unlinkSync(path.join(parentDir, e)); } catch (_) {}
                }
                fs.rmdirSync(parentDir);
                parentDir = path.dirname(parentDir);
              } else {
                break;
              }
            } catch (_) {
              break;
            }
          }
        } else if (stat.isDirectory()) {
          // If a whole folder was specified
          let folderSize = 0;
          const calculateDirSize = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const ent of entries) {
              const p = path.join(dir, ent.name);
              if (ent.isDirectory()) calculateDirSize(p);
              else if (ent.isFile()) folderSize += fs.statSync(p).size;
            }
          };
          calculateDirSize(fullPath);
          freedBytes += folderSize;
          fs.rmSync(fullPath, { recursive: true, force: true });
          deletedPaths.push(normalized);
        }

        // Clean up any matching torrent swarm in memory
        const { removeTorrent } = await import('../services/webtorrentEngine.js');
        await removeTorrent(normalized);
        const baseFolder = normalized.split('/')[0];
        if (baseFolder) await removeTorrent(baseFolder);
      } else {
        // File doesn't exist on disk, but still check if matching swarm exists to clean up
        const { removeTorrent } = await import('../services/webtorrentEngine.js');
        await removeTorrent(normalized);
        deletedPaths.push(normalized);
      }
    } catch (err) {
      console.error(`[deleteMedia] Error deleting ${rawPath}:`, err);
      errors.push({ path: rawPath, error: err.message });
    }
  }

  res.json({
    success: deletedPaths.length > 0 || errors.length === 0,
    deletedCount: deletedPaths.length,
    deletedPaths,
    freedBytes,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export default {
  getLibrary,
  verifyMedia,
  postArchive,
  deleteMedia,
};


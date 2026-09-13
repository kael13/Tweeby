'use strict';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import util from 'util';
import config from '../config/index.js';

const execFileAsync = util.promisify(execFile);
const subtitleCache = new Map();
const DOWNLOAD_DIR = config.storage.downloadDir;
const SUBTITLES_CACHE_DIR = config.storage.subtitlesCacheDir;

export function getSubtitleCacheKey(targetPath, trackKey) {
  const hash = crypto.createHash('md5').update(`${targetPath}:track:${trackKey}`).digest('hex');
  return path.join(SUBTITLES_CACHE_DIR, `${hash}.vtt`);
}

/**
 * Probes all embedded subtitle streams and discovers external .srt/.vtt files.
 */
export async function getMediaSubtitles(filePath) {
  if (!filePath || typeof filePath !== 'string') return [];
  if (subtitleCache.has(filePath)) return subtitleCache.get(filePath);

  const subtitles = [];

  // 1. Scan for external .srt and .vtt files in the same directory
  try {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const files = await fs.promises.readdir(dir);
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.srt' || ext === '.vtt') {
        const fullSubPath = path.join(dir, f);
        const subBase = path.basename(f, ext).toLowerCase();
        if (subBase.includes(baseName) || files.length < 15 || f.toLowerCase().includes('sub')) {
          let lang = 'und';
          let label = path.basename(f, ext);
          if (/\b(en|eng|english)\b/i.test(f)) { lang = 'eng'; label = 'English (External)'; }
          else if (/\b(es|spa|spanish|espanol)\b/i.test(f)) { lang = 'spa'; label = 'Español (External)'; }
          else if (/\b(fr|fre|fra|french|francais)\b/i.test(f)) { lang = 'fre'; label = 'Français (External)'; }
          else if (/\b(de|ger|deu|german|deutsch)\b/i.test(f)) { lang = 'ger'; label = 'Deutsch (External)'; }

          subtitles.push({
            id: `ext_${subtitles.length}`,
            type: 'external',
            format: ext.slice(1),
            lang,
            label,
            path: path.relative(DOWNLOAD_DIR, fullSubPath),
          });
        }
      }
    }
  } catch (_) { }

  // 2. Probe embedded subtitle streams with ffprobe
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 's',
      '-show_entries', 'stream=index:stream_tags=language,title',
      '-of', 'json',
      filePath,
    ], { timeout: 6000 });

    const data = JSON.parse(stdout || '{}');
    if (Array.isArray(data.streams)) {
      data.streams.forEach((st, idx) => {
        const lang = st.tags?.language || 'und';
        const title = st.tags?.title || '';
        let label = title || (lang !== 'und' ? lang.toUpperCase() : `Subtitle track ${idx + 1}`);
        if (title && lang && !title.toLowerCase().includes(lang.toLowerCase())) {
          label = `${title} (${lang})`;
        }

        subtitles.push({
          id: `emb_${idx}`,
          type: 'embedded',
          streamIndex: st.index,
          subtitleIndex: idx,
          lang,
          label,
        });
      });
    }
  } catch (_) { }

  subtitleCache.set(filePath, subtitles);
  return subtitles;
}

export default {
  getSubtitleCacheKey,
  getMediaSubtitles,
};

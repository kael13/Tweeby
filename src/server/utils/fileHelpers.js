'use strict';

import fs from 'fs';
import path from 'path';

// Well-known names that denote a poster/cover/fanart image in a torrent.
export const POSTER_NAMES = ['poster', 'cover', 'folder', 'front', 'thumb', 'thumbnail', 'fanart', 'backdrop'];

/** Return a lower-cased basename without its extension ("Movie.mp4" -> "movie"). */
export function baseNameNoExt(name) {
  const b = path.basename(name || '');
  const dot = b.lastIndexOf('.');
  return (dot > 0 ? b.slice(0, dot) : b).toLowerCase();
}

/**
 * Find the best image to use as a preview/thumbnail for a media file.
 * Priority: same basename → well-known poster name → any image in same folder.
 * @returns {number|undefined} index of the poster image, or undefined.
 */
export function findPosterIndex(mediaFile, images) {
  if (!images.length) return undefined;
  const base = baseNameNoExt(mediaFile.name);

  for (const img of images) {
    if (baseNameNoExt(img.name) === base) return img.index;
  }
  for (const img of images) {
    if (POSTER_NAMES.includes(baseNameNoExt(img.name))) return img.index;
  }
  const dir = path.posix.dirname(mediaFile.path || mediaFile.name);
  for (const img of images) {
    if (path.posix.dirname(img.path || img.name) === dir) return img.index;
  }
  return undefined;
}

/**
 * Detect a media MIME type from a file's magic bytes (content sniffing).
 * Used as a fallback when the extension-based lookup fails or yields a
 * generic type. Reads only the first 16 bytes.
 */
export async function sniffMediaType(file) {
  if (!file.length || file.length < 4) return null;

  const head = new Uint8Array(Math.min(16, file.length));
  const stream = file.createReadStream({ start: 0, end: head.length - 1 });

  let offset = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.destroy();
  }, 3000);

  try {
    for await (const chunk of stream) {
      if (offset >= head.length) break;
      head.set(chunk.subarray(0, head.length - offset), offset);
      offset += chunk.length;
    }
  } catch (_) {
    // fall through
  } finally {
    clearTimeout(timer);
    try { stream.destroy(); } catch (_) { }
  }

  if (timedOut || offset === 0) return null;

  const u8 = head;
  const ascii = (s, i = 0) => {
    for (let k = 0; k < s.length; k++) if (u8[i + k] !== s.charCodeAt(k)) return false;
    return true;
  };

  // ISO Base Media / MP4 family (mp4, m4a, mov, m4v, 3gp…)
  if (ascii('ftyp', 4) || ascii('moov', 4) || ascii('mdat', 4) || ascii('free', 4)) {
    return 'video/mp4';
  }
  // Matroska (mkv, mka, webm) — EBML header
  if (u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3) {
    return 'video/x-matroska';
  }
  // Ogg (ogg, ogv, oga, opus)
  if (ascii('OggS', 0)) return 'audio/ogg';
  // FLAC
  if (ascii('fLaC', 0)) return 'audio/x-flac';
  // WAV (RIFF .... WAVE)
  if (ascii('RIFF', 0) && ascii('WAVE', 8)) return 'audio/wav';
  // AVI (RIFF .... AVI )
  if (ascii('RIFF', 0) && ascii('AVI ', 8)) return 'video/x-msvideo';
  // MP3 — ID3 tag, or MPEG frame sync
  if (ascii('ID3', 0)) return 'audio/mpeg';
  if (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  // AAC ADTS frame sync (0xFFF)
  if (u8[0] === 0xff && (u8[1] & 0xf6) === 0xf0) return 'audio/x-aac';
  // JPEG
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  // PNG
  if (u8[0] === 0x89 && ascii('PNG', 1)) return 'image/png';
  // GIF
  if (ascii('GIF8', 0)) return 'image/gif';
  // WebP
  if (ascii('RIFF', 0) && ascii('WEBP', 8)) return 'image/webp';

  return null;
}

/**
 * Scan directory recursively for existing downloaded media
 */
export function scanLibraryDir(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const fullPath = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results = results.concat(scanLibraryDir(fullPath, baseDir));
    } else if (ent.isFile()) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const ext = path.extname(ent.name).toLowerCase();
      let type = 'application/octet-stream';
      let category = 'other';

      if (['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'].includes(ext)) {
        type = ext === '.mkv' ? 'video/x-matroska' : `video/${ext.slice(1)}`;
        category = 'video';
      } else if (['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac'].includes(ext)) {
        type = ext === '.mp3' ? 'audio/mpeg' : (ext === '.flac' ? 'audio/x-flac' : `audio/${ext.slice(1)}`);
        category = 'audio';
      } else if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
        type = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
        category = 'image';
      }

      const stat = fs.statSync(fullPath);
      results.push({
        name: ent.name,
        relPath,
        size: stat.size,
        type,
        category,
        streamUrl: category === 'image' ? `/downloads/${encodeURI(relPath)}` : `/api/stream-local?path=${encodeURIComponent(relPath)}`,
      });
    }
  }
  return results;
}

export default {
  POSTER_NAMES,
  baseNameNoExt,
  findPosterIndex,
  sniffMediaType,
  scanLibraryDir,
};

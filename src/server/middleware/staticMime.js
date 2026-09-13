'use strict';

import path from 'path';

/**
 * Instant file extension MIME resolver.
 */
export function resolveMimeType(fileName, fallbackType = '') {
  const ext = path.extname(fileName || '').toLowerCase();
  if (['.mp4', '.m4v'].includes(ext)) return 'video/mp4';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.avi') return 'video/x-msvideo';
  if (ext === '.ts') return 'video/mp2t';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.flac') return 'audio/x-flac';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.aac') return 'audio/x-aac';
  if (ext === '.ogg') return 'audio/ogg';
  if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (['.srt', '.vtt', '.sub', '.ass', '.ssa'].includes(ext)) return 'text/plain';
  if (fallbackType && fallbackType !== 'application/octet-stream') return fallbackType;
  return 'application/octet-stream';
}

/**
 * Check whether a file can be streamed inline (media).
 */
export function isStreamable(mime) {
  return /^(video|audio|image)\//.test(mime || '');
}

export default {
  resolveMimeType,
  isStreamable,
};

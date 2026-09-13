'use strict';

import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);
const durationCache = new Map();

/**
 * Platform-specific hardware video encoding arguments.
 * Uses Apple Silicon / Intel VideoToolbox on macOS (dropping CPU usage from >200% to ~5-10%),
 * falling back gracefully to libx264 on other platforms.
 */
export function getVideoEncoderArgs() {
  if (process.platform === 'darwin') {
    return ['-c:v', 'h264_videotoolbox', '-b:v', '6000k', '-pix_fmt', 'yuv420p'];
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p'];
}

/**
 * Fast ffprobe duration detector with in-memory caching.
 * Resolves file runtime in seconds.
 */
export async function getMediaDuration(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (durationCache.has(filePath)) return durationCache.get(filePath);

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { timeout: 4000 });
    const dur = parseFloat(stdout.trim());
    if (!isNaN(dur) && dur > 0) {
      durationCache.set(filePath, dur);
      return dur;
    }
  } catch (_) { }
  return null;
}

export default {
  getVideoEncoderArgs,
  getMediaDuration,
};

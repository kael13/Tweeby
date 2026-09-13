'use strict';

/**
 * Convert bytes to human-readable format e.g. "1.45 GB"
 */
export function formatBytes(bytes) {
  const n = parseInt(bytes, 10);
  if (isNaN(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
}

/**
 * Convert transfer rate to human-readable speed e.g. "4.2 MB/s"
 */
export function formatSpeed(bytesPerSec) {
  const n = parseFloat(bytesPerSec);
  if (isNaN(n) || n <= 0) return '0 KB/s';
  return formatBytes(n) + '/s';
}

/**
 * Convert seconds into formatted time string: "01:24:10" or "04:32"
 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(parseFloat(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default {
  formatBytes,
  formatSpeed,
  formatDuration,
};

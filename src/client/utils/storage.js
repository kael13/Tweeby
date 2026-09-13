'use strict';

/**
 * Playback Progress Persistence (localStorage)
 */
export function getProgressStorageKey(item) {
  if (!item) return '';
  return `tweeby_prog_${item.isLocal ? item.path : (item.infoHash + '_' + item.fileIndex)}`;
}

export function getMediaProgress(item) {
  try {
    const key = getProgressStorageKey(item);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.time === 'number') return data;
  } catch (_) { }
  return null;
}

export function saveMediaProgress(item, currentTime, duration) {
  try {
    const key = getProgressStorageKey(item);
    if (!key || !duration || duration <= 0) return;
    if (currentTime > duration * 0.95) {
      localStorage.removeItem(key);
      return;
    }
    const pct = Math.min(1.0, Math.max(0, currentTime / duration));
    localStorage.setItem(key, JSON.stringify({
      time: currentTime,
      duration: duration,
      percent: pct,
      updatedAt: Date.now(),
    }));
  } catch (_) { }
}

export function clearMediaProgress(item) {
  try {
    const key = getProgressStorageKey(item);
    if (key) localStorage.removeItem(key);
  } catch (_) { }
}

export default {
  getProgressStorageKey,
  getMediaProgress,
  saveMediaProgress,
  clearMediaProgress,
};

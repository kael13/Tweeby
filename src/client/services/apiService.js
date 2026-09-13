'use strict';

/**
 * Standard fetch wrapper with automatic JSON parsing and error handling.
 */
export async function apiRequest(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    console.error(`[API Error] ${url}:`, err);
    throw err;
  }
}

export const api = {
  // Discovery
  getTrending: (type = 'all', window = 'week', page = 1) =>
    apiRequest(`/api/tmdb/trending?type=${type}&window=${window}&page=${page}`),
  getCategory: (type = 'movie', category = 'popular', page = 1) =>
    apiRequest(`/api/tmdb/discover?type=${type}&category=${category}&page=${page}`),
  getGenres: (type = 'all') =>
    apiRequest(`/api/tmdb/genres?type=${type}`),
  getDiscoverByGenre: (type = 'movie', genreId, page = 1, sortBy = 'popularity.desc') =>
    apiRequest(`/api/tmdb/discover?type=${type}&genreId=${encodeURIComponent(genreId)}&page=${page}&sortBy=${encodeURIComponent(sortBy)}`),
  getMediaDetails: (type, id) =>
    apiRequest(`/api/tmdb/details/${type}/${id}`),
  searchTmdbCatalog: (query, page = 1) =>
    apiRequest(`/api/tmdb/search-catalog?query=${encodeURIComponent(query)}&page=${page}`),

  // Torrents & Swarms
  searchTorrents: (title, year = '', type = 'movie', season = '') => {
    let url = `/api/torrents/search?title=${encodeURIComponent(title)}&type=${type}`;
    if (year) url += `&year=${encodeURIComponent(year)}`;
    if (season) url += `&season=${encodeURIComponent(season)}`;
    return apiRequest(url);
  },
  postDownload: (magnet, format = 'zip') =>
    apiRequest('/api/download', {
      method: 'POST',
      body: JSON.stringify({ magnet, format }),
    }),
  getTorrents: () =>
    apiRequest('/api/torrents'),
  getTorrentFiles: (infoHash) =>
    apiRequest(`/api/files/${infoHash}`),
  prioritizeSeek: (infoHash, fileIndex, time, duration) =>
    apiRequest(`/api/torrent/prioritize-seek?infoHash=${infoHash}&fileIndex=${fileIndex}&time=${time}&duration=${duration}`),
  prioritizeFile: (infoHash, fileIndex) =>
    apiRequest(`/api/prioritize/${infoHash}/${fileIndex}`, { method: 'POST' }),
  getMediaDuration: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/api/media/duration?${qs}`);
  },
  closeStream: (infoHash) =>
    apiRequest('/api/stream/close', {
      method: 'POST',
      body: JSON.stringify({ infoHash }),
    }),

  // Library & Subtitles
  getLibrary: () =>
    apiRequest('/api/library'),
  getSubtitlesList: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/api/subtitles/list?${qs}`);
  },
  postArchive: (infoHash, format = 'zip') =>
    apiRequest('/api/archive', {
      method: 'POST',
      body: JSON.stringify({ infoHash, format }),
    }),
};

export default api;

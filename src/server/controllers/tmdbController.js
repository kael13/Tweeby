'use strict';

import {
  fetchTmdbMetadata,
  fetchTrending,
  fetchCategory,
  fetchMediaDetailsAndVideos,
  searchTmdbCatalog,
  fetchGenres,
  fetchDiscoverByGenre,
} from '../services/tmdbService.js';

export async function searchTmdb(req, res) {
  const { query, year, isTv } = req.query;
  if (!query) return res.status(400).json({ error: 'Query parameter is required.' });
  try {
    const data = await fetchTmdbMetadata(query, {
      year: year || null,
      isTv: isTv === 'true' || isTv === '1',
    });
    res.json({ result: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getTrending(req, res) {
  const { type = 'all', window = 'week', page = 1 } = req.query;
  try {
    const data = await fetchTrending({
      type: String(type),
      window: String(window),
      page: Math.max(1, parseInt(page, 10) || 1),
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDiscoverCategory(req, res) {
  const { type = 'movie', category = 'popular', page = 1, genreId, genre, sortBy = 'popularity.desc' } = req.query;
  const targetGenre = genreId || genre;
  try {
    if (targetGenre) {
      const data = await fetchDiscoverByGenre({
        type: String(type),
        genreId: String(targetGenre),
        page: Math.max(1, parseInt(page, 10) || 1),
        sortBy: String(sortBy),
      });
      return res.json(data);
    }
    const data = await fetchCategory({
      type: String(type),
      category: String(category),
      page: Math.max(1, parseInt(page, 10) || 1),
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMediaDetails(req, res) {
  const { type, id } = req.params;
  try {
    const data = await fetchMediaDetailsAndVideos(type, id);
    if (!data) return res.status(404).json({ error: 'Media details not found.' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function searchCatalog(req, res) {
  const { query, page = 1 } = req.query;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Query parameter is required.' });
  }
  try {
    const data = await searchTmdbCatalog(query, Math.max(1, parseInt(page, 10) || 1));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getGenres(req, res) {
  const { type = 'all' } = req.query;
  try {
    const data = await fetchGenres(String(type));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDiscoverByGenre(req, res) {
  const { type = 'movie', genreId, page = 1, sortBy = 'popularity.desc' } = req.query;
  if (!genreId) {
    return res.status(400).json({ error: 'genreId query parameter is required.' });
  }
  try {
    const data = await fetchDiscoverByGenre({
      type: String(type),
      genreId: String(genreId),
      page: Math.max(1, parseInt(page, 10) || 1),
      sortBy: String(sortBy),
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default {
  searchTmdb,
  getTrending,
  getDiscoverCategory,
  getMediaDetails,
  searchCatalog,
  getGenres,
  getDiscoverByGenre,
};

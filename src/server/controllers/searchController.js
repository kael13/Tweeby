'use strict';

import { searchTorrentsForMedia } from '../services/torrentSearchService.js';

export async function searchTorrents(req, res) {
  const { title, year, type = 'movie', season } = req.query;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title parameter is required.' });
  }
  try {
    const results = await searchTorrentsForMedia(
      title.trim(),
      year ? String(year).trim() : null,
      type === 'tv' || type === 'series' ? 'tv' : 'movie',
      season || null
    );
    res.json({
      title: title.trim(),
      year: year || null,
      type: type === 'tv' || type === 'series' ? 'tv' : 'movie',
      season: season || null,
      count: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default {
  searchTorrents,
};

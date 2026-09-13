'use strict';

import express from 'express';
import {
  searchTmdb,
  getTrending,
  getDiscoverCategory,
  getMediaDetails,
  searchCatalog,
  getGenres,
  getDiscoverByGenre,
} from '../controllers/tmdbController.js';

const router = express.Router();

router.get('/tmdb/search', searchTmdb);
router.get('/tmdb/trending', getTrending);
router.get('/tmdb/genres', getGenres);
router.get('/tmdb/discover/genre', getDiscoverByGenre);
router.get('/tmdb/discover', getDiscoverCategory);
router.get('/tmdb/details/:type/:id', getMediaDetails);
router.get('/tmdb/search-catalog', searchCatalog);

export default router;

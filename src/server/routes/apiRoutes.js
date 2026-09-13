'use strict';

import express from 'express';
import tmdbRoutes from './tmdbRoutes.js';
import torrentRoutes from './torrentRoutes.js';
import streamRoutes from './streamRoutes.js';
import subtitleRoutes from './subtitleRoutes.js';
import archiveRoutes from './archiveRoutes.js';

const router = express.Router();

router.use('/', tmdbRoutes);
router.use('/', torrentRoutes);
router.use('/', streamRoutes);
router.use('/', subtitleRoutes);
router.use('/', archiveRoutes);

export default router;

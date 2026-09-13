'use strict';

import express from 'express';
import { listSubtitles, streamSubtitles } from '../controllers/subtitleController.js';

const router = express.Router();

router.get('/subtitles/list', listSubtitles);
router.get('/subtitles/stream', streamSubtitles);

export default router;

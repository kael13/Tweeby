'use strict';

import express from 'express';
import {
  streamFile,
  streamLocal,
  transcodeLocal,
  closeStream,
  getMediaDurationHandler,
} from '../controllers/streamController.js';

const router = express.Router();

router.get('/media-duration', getMediaDurationHandler);
router.get('/stream/:infoHash/:fileIndex', streamFile);
router.get('/stream-local', streamLocal);
router.get('/transcode-local', transcodeLocal);
router.post('/stream/close', closeStream);

export default router;

'use strict';

import express from 'express';
import {
  getLibrary,
  verifyMedia,
  postArchive,
} from '../controllers/archiveController.js';

const router = express.Router();

router.get('/library', getLibrary);
router.get('/media/verify', verifyMedia);
router.post('/archive', postArchive);

export default router;

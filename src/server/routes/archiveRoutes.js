'use strict';

import express from 'express';
import {
  getLibrary,
  verifyMedia,
  postArchive,
  deleteMedia,
} from '../controllers/archiveController.js';

const router = express.Router();

router.get('/library', getLibrary);
router.get('/media/verify', verifyMedia);
router.post('/archive', postArchive);
router.delete('/media', deleteMedia);
router.post('/media/delete', deleteMedia);

export default router;


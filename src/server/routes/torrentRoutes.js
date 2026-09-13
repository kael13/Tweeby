'use strict';

import express from 'express';
import {
  postDownload,
  getActiveTorrents,
  getTorrentFiles,
  prioritizeFile,
  prioritizeSeek,
} from '../controllers/torrentController.js';
import { searchTorrents } from '../controllers/searchController.js';

const router = express.Router();

router.post('/download', postDownload);
router.get('/torrents', getActiveTorrents);
router.get('/torrents/search', searchTorrents);
router.get('/files/:infoHash', getTorrentFiles);
router.post('/prioritize/:infoHash/:fileIndex', prioritizeFile);
router.get('/torrent/prioritize-seek', prioritizeSeek);

export default router;

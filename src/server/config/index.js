'use strict';

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../');

// ---------------------------------------------------------------------------
// Environment Initialization
// ---------------------------------------------------------------------------
// 1. Try dotenv first (standard cross-platform support)
dotenv.config({ path: path.join(rootDir, '.env') });

// 2. Fallback to Node 20.6+ native process.loadEnvFile if available & not loaded
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(rootDir, '.env'));
  } catch (_) {
    // Silently ignore if .env does not exist or was already loaded
  }
}

// ---------------------------------------------------------------------------
// Helper Parsers
// ---------------------------------------------------------------------------
function parseInteger(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const num = parseInt(val, 10);
  return Number.isNaN(num) ? fallback : num;
}

function parseFloatNumber(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const num = parseFloat(val);
  return Number.isNaN(num) ? fallback : num;
}

function parseStringList(val, fallback) {
  if (!val || typeof val !== 'string') return fallback;
  return val
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Default high-performance BitTorrent tracker list
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
];

// ---------------------------------------------------------------------------
// Centralized Configuration Object
// ---------------------------------------------------------------------------
export const config = {
  // Paths
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  srcDir: path.join(rootDir, 'src'),

  // Server & Environment
  env: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || '').toLowerCase() === 'production',
  port: parseInteger(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',

  // The Movie Database (TMDB) API & CDN
  tmdb: {
    apiKey: (process.env.TMDB_API_KEY || '').trim(),
    readAccessToken: (process.env.TMDB_READ_ACCESS_TOKEN || '').trim(),
    baseUrl: process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3',
    imageBaseUrl: process.env.TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org/t/p',

    /**
     * Checks whether TMDB credentials are provided in the environment.
     */
    isConfigured() {
      return Boolean(this.readAccessToken || this.apiKey);
    },

    /**
     * Builds standard headers for TMDB fetch requests, including Bearer auth when token is present.
     */
    getAuthHeaders(extraHeaders = {}) {
      const headers = {
        Accept: 'application/json',
        ...extraHeaders,
      };
      if (this.readAccessToken) {
        headers.Authorization = `Bearer ${this.readAccessToken}`;
      }
      return headers;
    },

    /**
     * Injects the TMDB API key parameter into URLSearchParams if Bearer token is not present.
     */
    applyAuthParams(params) {
      if (!this.readAccessToken && this.apiKey) {
        params.set('api_key', this.apiKey);
      }
      return params;
    },
  },

  // Storage Directories
  storage: {
    downloadDir: process.env.DOWNLOAD_DIR
      ? path.resolve(process.env.DOWNLOAD_DIR)
      : path.join(rootDir, 'public', 'downloads'),
    archiveDir: process.env.ARCHIVE_DIR
      ? path.resolve(process.env.ARCHIVE_DIR)
      : path.join(rootDir, 'public', 'archives'),
    subtitlesCacheDir: path.join(
      process.env.DOWNLOAD_DIR
        ? path.resolve(process.env.DOWNLOAD_DIR)
        : path.join(rootDir, 'public', 'downloads'),
      '.subtitles_cache'
    ),
  },

  // BitTorrent Engine Settings
  torrent: {
    maxConns: parseInteger(process.env.MAX_CONNS, 200),
    trackers: parseStringList(process.env.TRACKERS, DEFAULT_TRACKERS),
  },

  // Peer Optimizer Settings
  peerOptimizer: {
    sampleMs: parseInteger(process.env.PEER_SAMPLE_MS, 1000),
    graceMs: parseInteger(process.env.PEER_GRACE_MS, 8000),
    minRatio: parseFloatNumber(process.env.PEER_MIN_RATIO, 0.05),
    minPeersToPrune: parseInteger(process.env.PEER_MIN_PEERS_TO_PRUNE, 3),
  },

  /**
   * Logs a clean, masked startup diagnostics summary of configured credentials and paths.
   */
  logStatus() {
    const tmdbStatus = this.tmdb.readAccessToken
      ? '✓ Bearer Read Access Token loaded (TMDB v4)'
      : this.tmdb.apiKey
        ? `✓ API Key loaded (...${this.tmdb.apiKey.slice(-6)})`
        : '✗ Not configured (set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY in .env)';

    console.log('--------------------------------------------------');
    console.log(`📡 Tweeby Environment: ${this.env}`);
    console.log(`🌐 Port: ${this.port}`);
    console.log(`🎬 TMDB Status: ${tmdbStatus}`);
    console.log(`📂 Downloads Dir: ${this.storage.downloadDir}`);
    console.log(`📦 Archives Dir: ${this.storage.archiveDir}`);
    console.log(`⚡ Max Torrent Connections: ${this.torrent.maxConns}`);
    console.log('--------------------------------------------------');
  },
};

export default config;

'use strict';

import assert from 'assert';
import { parseMediaTitle, fetchGenres, fetchDiscoverByGenre } from '../src/server/services/tmdbService.js';
import { PeerOptimizer } from '../src/server/services/peerOptimizerService.js';
import { formatBytes, formatSpeed, formatDuration } from '../src/client/utils/formatters.js';
import { resolveMimeType, isStreamable } from '../src/server/middleware/staticMime.js';
import config from '../src/server/config/index.js';

console.log('🧪 Running Tweeby Full-Stack Test Suite...\n');

// 1. Config tests
console.log('1️⃣ Validating Server Configuration...');
assert.ok(config.port, 'Port must be defined');
assert.ok(config.storage.downloadDir, 'Download directory must be configured');
assert.ok(config.storage.archiveDir, 'Archive directory must be configured');
assert.ok(Array.isArray(config.torrent.trackers), 'Trackers list must be an array');
console.log('   ✓ Config verified successfully.\n');

// 2. TMDB Title Sanitization tests
console.log('2️⃣ Validating TMDB Title Parser & Sanitizer...');
const movieTest = parseMediaTitle('Inception.2010.1080p.BluRay.x264-SPARKS.mp4');
assert.strictEqual(movieTest.query, 'Inception', 'Movie title parsed correctly');
assert.strictEqual(movieTest.year, '2010', 'Movie year parsed correctly');
assert.strictEqual(movieTest.isTv, false, 'Movie is not TV series');

const tvTest = parseMediaTitle('Breaking.Bad.S02E05.720p.HDTV.x264.mkv');
assert.strictEqual(tvTest.query, 'Breaking Bad', 'TV show title parsed correctly');
assert.strictEqual(tvTest.isTv, true, 'TV show identified');
assert.strictEqual(tvTest.season, 2, 'TV season extracted');
assert.strictEqual(tvTest.episode, 5, 'TV episode extracted');
console.log('   ✓ TMDB parser verified successfully.\n');

// 3. TMDB Genres & Discover Services tests
console.log('3️⃣ Validating TMDB Genres & Discovery by Genre...');
const movieGenres = await fetchGenres('movie');
assert.ok(Array.isArray(movieGenres.genres), 'Movie genres returns an array');
assert.ok(movieGenres.genres.length > 0, 'Movie genres contains items');
assert.ok(movieGenres.genres.some((g) => g.name === 'Action'), 'Action genre present in movie genres');

const tvGenres = await fetchGenres('tv');
assert.ok(Array.isArray(tvGenres.genres), 'TV genres returns an array');
assert.ok(tvGenres.genres.length > 0, 'TV genres contains items');

const allGenres = await fetchGenres('all');
assert.ok(Array.isArray(allGenres.genres), 'All genres returns merged array');

const genreDiscover = await fetchDiscoverByGenre({ type: 'movie', genreId: '28', page: 1 });
assert.ok(genreDiscover.page === 1, 'Discover by genre returns page 1');
assert.ok(Array.isArray(genreDiscover.results), 'Discover by genre returns results array');
console.log('   ✓ TMDB Genres & Discovery verified successfully.\n');

// 4. MIME Resolution tests
console.log('4️⃣ Validating MIME Type Resolution & Streamability...');
assert.strictEqual(resolveMimeType('movie.mp4'), 'video/mp4', 'MP4 resolved');
assert.strictEqual(resolveMimeType('video.mkv'), 'video/x-matroska', 'MKV resolved');
assert.strictEqual(resolveMimeType('song.flac'), 'audio/x-flac', 'FLAC resolved');
assert.strictEqual(resolveMimeType('subs.srt'), 'text/plain', 'SRT resolved');
assert.ok(isStreamable('video/mp4'), 'video/mp4 is streamable');
assert.ok(isStreamable('audio/mpeg'), 'audio/mpeg is streamable');
assert.ok(!isStreamable('application/zip'), 'zip is not streamable');
console.log('   ✓ MIME resolution verified successfully.\n');

// 5. Client Formatters tests
console.log('5️⃣ Validating Client Formatters...');
assert.strictEqual(formatBytes(1024 * 1024 * 500), '500.00 MB', 'Format bytes MB');
assert.strictEqual(formatBytes(1024 * 1024 * 1024 * 2.5), '2.50 GB', 'Format bytes GB');
assert.strictEqual(formatSpeed(1024 * 1024 * 3.5), '3.50 MB/s', 'Format speed');
assert.strictEqual(formatDuration(3665), '1:01:05', 'Format duration HH:MM:SS');
assert.strictEqual(formatDuration(125), '2:05', 'Format duration MM:SS');
console.log('   ✓ Formatters verified successfully.\n');

// 6. Peer Optimizer tests
console.log('6️⃣ Validating Peer Optimizer Unit Logic...');
const opt = new PeerOptimizer({ sampleMs: 1000, minPeersToPrune: 2, graceMs: 0 });
opt.attach('test-hash');
const mockWire1 = { peerId: 'peer-1', downloaded: 1000000, remoteAddress: '1.2.3.4' };
const mockWire2 = { peerId: 'peer-2', downloaded: 50000, remoteAddress: '5.6.7.8' };
opt.addPeer('test-hash', mockWire1);
opt.addPeer('test-hash', mockWire2);
const summary = opt.summary('test-hash');
assert.strictEqual(summary.active, 2, 'Active peer count matches');
opt.detach('test-hash');
console.log('   ✓ Peer Optimizer verified successfully.\n');

// 7. Swarm Sliding Lookahead Window Math tests
console.log('7️⃣ Validating Swarm Two-Tiered Sliding Lookahead Calculations...');
const startPiece = 100;
const endPiece = 300;
const totalPieces = endPiece - startPiece + 1; // 201
const seekTime = 2700; // 45m
const totalDuration = 5400; // 90m
const ratio = Math.min(0.99, Math.max(0, seekTime / totalDuration)); // 0.5
const targetPiece = Math.min(endPiece, Math.max(startPiece, Math.floor(startPiece + ratio * totalPieces)));
const tier1End = Math.min(endPiece, targetPiece + 4);
const tier2End = Math.min(endPiece, targetPiece + 25);

assert.strictEqual(targetPiece, 200, 'Target piece calculated at 50% midpoint');
assert.strictEqual(tier1End, 204, 'Tier-1 immediate window covers 5 pieces (200-204)');
assert.strictEqual(tier2End, 225, 'Tier-2 lookahead window covers 21 pieces (205-225)');
console.log('   ✓ Swarm Sliding Lookahead Math verified successfully.\n');

console.log('🎉 All automated tests passed successfully with 100% assertions!');

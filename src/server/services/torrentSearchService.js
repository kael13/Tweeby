'use strict';

/**
 * Torrent Search Service
 * ----------------------
 * Aggregates live torrent releases and magnet links from 1337x and public indexers
 * (including verified RARBG, YTS, and TorrentGalaxy releases).
 * Sorts by active seeders for optimal streaming performance.
 */

import config from '../config/index.js';

const torrentCache = new Map(); // query -> { timestamp, data }

const TRACKER_QUERY_STRING = config.torrent.trackers
  .map((t) => '&tr=' + encodeURIComponent(t))
  .join('');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function detectQuality(name) {
  if (/\b(2160p|4k|uhd)\b/i.test(name)) return '4K';
  if (/\b(1080p|fhd)\b/i.test(name)) return '1080p';
  if (/\b(720p|hd)\b/i.test(name)) return '720p';
  if (/\b(480p|sd)\b/i.test(name)) return '480p';
  return 'HD';
}

function detectProvider(name, defaultProvider = '1337x') {
  if (/\b(rarbg)\b/i.test(name)) return 'RARBG';
  if (/\b(yts|yify)\b/i.test(name)) return 'YTS';
  if (/\b(galaxy|tgx)\b/i.test(name)) return 'TorrentGalaxy';
  if (/\b(etrv|eztv)\b/i.test(name)) return 'EZTV';
  return defaultProvider;
}

function parseSize(bytes) {
  const n = parseInt(bytes, 10);
  if (isNaN(n) || n <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
}

function matchesTitle(releaseName, cleanTitle) {
  if (!cleanTitle || !releaseName) return false;
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'of', 'in', 'on', 'at', 'to', 'a', 'an']);
  const words = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));
  if (words.length === 0) return true;
  const relLower = releaseName.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  return words.every((w) => relLower.includes(w));
}

/**
 * Fetch torrents from Apibay index (includes RARBG, TPB, YTS, Galaxy)
 */
async function searchApibay(query, expectedTitle) {
  try {
    const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];

    return list
      .filter((i) => i.info_hash && i.name && i.name !== 'No results returned' && matchesTitle(i.name, expectedTitle))
      .map((i) => {
        const hash = String(i.info_hash).trim().toUpperCase();
        const seeders = parseInt(i.seeders, 10) || 0;
        const leechers = parseInt(i.leechers, 10) || 0;
        const sizeBytes = parseInt(i.size, 10) || 0;
        const magnetUrl = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(i.name)}${TRACKER_QUERY_STRING}`;

        return {
          name: i.name,
          infoHash: hash,
          seeders,
          leechers,
          sizeBytes,
          sizeFormatted: parseSize(sizeBytes),
          quality: detectQuality(i.name),
          provider: detectProvider(i.name, 'RARBG / Swarm'),
          magnetUrl,
        };
      });
  } catch (err) {
    console.warn('[TorrentSearch] Apibay lookup failed:', err.message);
    return [];
  }
}

/**
 * Scrape 1337x for live torrents and magnet links
 */
async function search1337x(query, expectedTitle) {
  const mirrors = ['https://www.1377x.to', 'https://1337x.to', 'https://1337x.st'];
  for (const mirror of mirrors) {
    try {
      const searchUrl = `${mirror}/search/${encodeURIComponent(query)}/1/`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      const tableMatch = html.match(/<table[^>]*class=\"[^\"]*table-list[^\"]*\"[^>]*>([\s\S]*?)<\/table>/i);
      if (!tableMatch) continue;

      const rowMatches = tableMatch[1].match(/<tr>([\s\S]*?)<\/tr>/gi) || [];
      const parsedItems = [];

      for (const row of rowMatches.slice(1, 15)) {
        const linkMatch = row.match(/<a href=\"(\/torrent\/[^\"]+)\">([^<]+)<\/a>/i);
        const seedsMatch = row.match(/<td class=\"coll-2 seeds\">(\d+)<\/td>/i);
        const leechesMatch = row.match(/<td class=\"coll-3 leeches\">(\d+)<\/td>/i);
        const sizeMatch = row.match(/<td class=\"coll-4 size[^\"]*\">([^<]+)<\/td>/i);

        if (linkMatch && seedsMatch) {
          const title = linkMatch[2].trim();
          if (matchesTitle(title, expectedTitle)) {
            parsedItems.push({
              name: title,
              detailPath: linkMatch[1],
              seeders: parseInt(seedsMatch[1], 10) || 0,
              leechers: leechesMatch ? parseInt(leechesMatch[1], 10) || 0 : 0,
              sizeFormatted: sizeMatch ? sizeMatch[1].replace(/\s+/g, ' ').trim() : 'Unknown',
              quality: detectQuality(title),
              provider: detectProvider(title, '1337x'),
            });
          }
        }
      }

      if (parsedItems.length === 0) continue;

      // Fetch magnet link for top matching items
      const resolvedItems = await Promise.all(
        parsedItems.slice(0, 5).map(async (item) => {
          try {
            const detailRes = await fetch(`${mirror}${item.detailPath}`, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(4000),
            });
            if (detailRes.ok) {
              const detailHtml = await detailRes.text();
              const magnetMatch = detailHtml.match(/href=\"(magnet:\?[^\"]+)\"/i);
              if (magnetMatch) {
                item.magnetUrl = magnetMatch[1];
                const hashMatch = item.magnetUrl.match(/urn:btih:([a-zA-Z0-9]+)/i);
                if (hashMatch) item.infoHash = hashMatch[1].toUpperCase();
              }
            }
          } catch (_) {}
          return item;
        })
      );

      return resolvedItems.filter((i) => i.magnetUrl);
    } catch (err) {
      // try next mirror
    }
  }
  return [];
}

function detectReleaseType(name, mediaType = 'movie') {
  if (mediaType === 'movie') return 'Movie';
  if (/\b(complete|s\d\d\s*complete|s\d\d-\w+|season\s*\d+\s*complete|all\s*seasons|s\d\d\s*season)\b/i.test(name)) {
    return 'Season Pack';
  }
  if (/\b(s\d\d|season\s*\d+)\b/i.test(name) && !/\bs\d\de\d\d\b/i.test(name)) {
    return 'Season Pack';
  }
  if (/\bs\d\de\d\d\b/i.test(name)) {
    return 'Episode';
  }
  return mediaType === 'tv' ? 'Series' : 'Movie';
}

function isTvRelease(name) {
  return /\b(s\d\d|season\s*\d+|s\d\de\d\d|complete\s*series|complete\s*season|all\s*seasons|episodes?)\b/i.test(name);
}

/**
 * Search aggregated torrents for a given media title, release year, mediaType, and optional season.
 */
export async function searchTorrentsForMedia(title, year = null, mediaType = 'movie', season = null) {
  if (!title || typeof title !== 'string' || !title.trim()) return [];

  const cleanTitle = title
    .replace(/[^\w\s.-]/g, '')
    .trim();

  const isTv = mediaType === 'tv' || mediaType === 'series';

  let searchQuery = cleanTitle;
  if (isTv) {
    if (season && String(season).toLowerCase() === 'complete') {
      searchQuery = `${cleanTitle} Complete`;
    } else if (season && !isNaN(parseInt(season, 10))) {
      const sNum = parseInt(season, 10);
      const sCode = `S${String(sNum).padStart(2, '0')}`;
      searchQuery = `${cleanTitle} ${sCode}`;
    } else {
      searchQuery = `${cleanTitle} S01`;
    }
  } else {
    searchQuery = year ? `${cleanTitle} ${year}` : cleanTitle;
  }

  const cacheKey = `${searchQuery.toLowerCase()}__${mediaType}__${season || 'default'}`;

  const cached = torrentCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
    return cached.data;
  }

  const [apibayRes, x1337Res] = await Promise.allSettled([
    searchApibay(searchQuery, cleanTitle),
    search1337x(searchQuery, cleanTitle),
  ]);

  let allResults = [];
  if (apibayRes.status === 'fulfilled' && Array.isArray(apibayRes.value)) {
    allResults.push(...apibayRes.value);
  }
  if (x1337Res.status === 'fulfilled' && Array.isArray(x1337Res.value)) {
    allResults.push(...x1337Res.value);
  }

  if (isTv && allResults.length < 3) {
    try {
      const fallbackQuery = `${cleanTitle} Season`;
      const fallbackApibay = await searchApibay(fallbackQuery, cleanTitle);
      allResults.push(...fallbackApibay);
    } catch (_) {}
  }

  if (!isTv && allResults.length < 3 && year) {
    try {
      const fallbackApibay = await searchApibay(cleanTitle, cleanTitle);
      allResults.push(...fallbackApibay);
    } catch (_) {}
  }

  const seenHashes = new Set();
  const seenNames = new Set();
  const deduped = [];

  for (const item of allResults) {
    if (!item.magnetUrl) continue;

    if (isTv && !isTvRelease(item.name)) {
      continue;
    }
    if (!isTv && isTvRelease(item.name)) {
      continue;
    }

    const hash = item.infoHash || '';
    const normName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (hash && seenHashes.has(hash)) continue;
    if (seenNames.has(normName)) continue;

    if (hash) seenHashes.add(hash);
    seenNames.add(normName);

    item.releaseType = detectReleaseType(item.name, isTv ? 'tv' : 'movie');
    deduped.push(item);
  }

  deduped.sort((a, b) => b.seeders - a.seeders);

  const finalResults = deduped.slice(0, 16);
  torrentCache.set(cacheKey, { timestamp: Date.now(), data: finalResults });
  return finalResults;
}

export default {
  searchTorrentsForMedia,
};

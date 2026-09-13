'use strict';

import config from '../config/index.js';

/**
 * TMDB (The Movie Database) Metadata and Poster Service
 * Handles title sanitization, external TMDB API requests with Bearer token / API key,
 * and in-memory caching.
 */

const TMDB_BASE_URL = config.tmdb.baseUrl;
const TMDB_IMAGE_BASE_URL = config.tmdb.imageBaseUrl;

// In-memory cache for TMDB lookups (query:year -> result)
const metadataCache = new Map();

/**
 * Clean and extract title, year, and TV series hints from a filename or torrent name.
 */
export function parseMediaTitle(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return { query: '', year: null, isTv: false };
  }

  // 1. Remove file extension
  let clean = rawName.replace(/\.[a-z0-9]{2,5}$/i, '').trim();

  // 2. Strip leading group tags in square brackets or parentheses e.g. [HorribleSubs], [YTS.MX], (1080p)
  clean = clean.replace(/^\[[^\]]+\]\s*/, '').replace(/^\([^\)]+\)\s*/, '');

  // 3. Normalize dots and underscores to spaces
  clean = clean.replace(/[._+]/g, ' ');

  // 4. Detect TV show season/episode tags (e.g. S01E02, S2 - 07, 1x04, Season 1)
  let isTv = false;
  let season = null;
  let episode = null;

  const tvMatch = clean.match(/\bS(\d{1,2})\s*(?:-|E|e|\s)\s*(\d{1,2})\b/i) ||
                  clean.match(/(?:\b|\b[sS])(\d{1,2})[eE](\d{1,2})\b/i) ||
                  clean.match(/\b(?:season|series)\s*(\d{1,2})\b/i) ||
                  clean.match(/\bS(\d{1,2})\b/i) ||
                  clean.match(/\b(\d{1,2})x(\d{1,2})\b/i);

  if (tvMatch) {
    isTv = true;
    if (tvMatch[1]) season = parseInt(tvMatch[1], 10);
    if (tvMatch[2]) episode = parseInt(tvMatch[2], 10);
    // Truncate everything from the TV tag onwards for the clean show title
    clean = clean.slice(0, tvMatch.index).trim();
  }

  // 5. Detect 4-digit release year (1900-2099)
  let year = null;
  const yearMatch = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = yearMatch[1];
    // If it's a movie, truncate everything from the year onwards to eliminate release group tags
    if (!isTv) {
      clean = clean.slice(0, yearMatch.index).trim();
    }
  }

  // 6. Strip common release group, resolution, audio & format tags
  const noiseRegex = /\b(1080p|720p|480p|2160p|4k|uhd|bluray|blu-ray|bdrip|brrip|dvdrip|dvd|web-dl|webrip|web|hdtv|hdrip|x264|x265|hevc|h264|h265|avc|av1|xvid|divx|aac|aac2\.0|dts|dts-hd|truehd|ddp5\.1|dd5\.1|atmos|ac3|mp3|flac|remux|repack|proper|extended|unrated|directors\.cut|imax|hdr|hdr10|dv|dolby\.vision|yify|yts|eztv|rartv|rarbg|vxt|galaxy|flt|sparks|evo|nogrp|dual[\s\.-]audio|multi[\s\.-]audio|ita|eng|fre|spa|ger|subbed|dubbed)\b/gi;
  clean = clean.replace(noiseRegex, ' ');

  // 7. Clean braces, brackets, parentheses and extra spaces
  clean = clean.replace(/[\[\](){}\-_]/g, ' ')
               .replace(/\s+/g, ' ')
               .trim();

  // If cleaning resulted in empty string, fallback to original basename
  if (!clean) {
    clean = rawName.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  }

  return { query: clean, year, isTv, season, episode };
}

/**
 * Fetch poster and metadata from TMDB.
 */
export async function fetchTmdbMetadata(rawTitle, options = {}) {
  if (!config.tmdb.isConfigured()) {
    return null;
  }

  const parsed = parseMediaTitle(rawTitle);
  const query = options.query || parsed.query;
  const year = options.year || parsed.year;
  const isTv = options.isTv !== undefined ? options.isTv : parsed.isTv;

  if (!query || query.length < 2) return null;

  const cacheKey = `${query.toLowerCase()}:${year || ''}:${isTv ? 'tv' : 'any'}`;
  if (metadataCache.has(cacheKey)) {
    return metadataCache.get(cacheKey);
  }

  try {
    const headers = config.tmdb.getAuthHeaders();

    const searchOnce = async (searchType, searchQuery, searchYear) => {
      const params = new URLSearchParams();
      config.tmdb.applyAuthParams(params);
      params.set('query', searchQuery);
      params.set('include_adult', 'false');

      if (searchYear) {
        if (searchType === 'tv') params.set('first_air_date_year', searchYear);
        else params.set('year', searchYear);
      }

      const endpoint = searchType === 'tv' ? 'search/tv' : (searchType === 'movie' ? 'search/movie' : 'search/multi');
      const url = `${TMDB_BASE_URL}/${endpoint}?${params.toString()}`;

      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    };

    let results = [];
    if (isTv) {
      results = await searchOnce('tv', query, year);
      if (!results.length) results = await searchOnce('multi', query, null);
    } else {
      results = await searchOnce('multi', query, year);
      if (!results.length && year) results = await searchOnce('multi', query, null);
      if (!results.length) results = await searchOnce('tv', query, null);
    }

    if (!results.length) {
      metadataCache.set(cacheKey, null);
      return null;
    }

    let best = results.find((r) => (r.media_type === 'movie' || r.media_type === 'tv' || isTv) && r.poster_path);
    if (!best) {
      best = results.find((r) => r.poster_path) || results[0];
    }

    if (!best) {
      metadataCache.set(cacheKey, null);
      return null;
    }

    const mediaType = best.media_type || (best.first_air_date ? 'tv' : 'movie');
    const releaseDate = best.release_date || best.first_air_date || '';
    const releaseYear = releaseDate ? releaseDate.slice(0, 4) : year;

    const result = {
      tmdbId: best.id,
      mediaType,
      title: best.title || best.name || query,
      originalTitle: best.original_title || best.original_name,
      year: releaseYear,
      overview: best.overview || '',
      rating: best.vote_average ? Number(best.vote_average.toFixed(1)) : null,
      voteCount: best.vote_count || 0,
      posterUrl: best.poster_path ? `${TMDB_IMAGE_BASE_URL}/w500${best.poster_path}` : null,
      posterThumbUrl: best.poster_path ? `${TMDB_IMAGE_BASE_URL}/w342${best.poster_path}` : null,
      backdropUrl: best.backdrop_path ? `${TMDB_IMAGE_BASE_URL}/w1280${best.backdrop_path}` : null,
    };

    metadataCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`[TMDB] Lookup failed for "${query}":`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// TMDB Discovery, Categories, Details & Trailer Videos
// ---------------------------------------------------------------------------

const discoverCache = new Map();
const detailsCache = new Map();
const genreCache = new Map();

export const DEFAULT_MOVIE_GENRES = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 10770, name: 'TV Movie' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' },
];

export const DEFAULT_TV_GENRES = [
  { id: 10759, name: 'Action & Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 10762, name: 'Kids' },
  { id: 9648, name: 'Mystery' },
  { id: 10763, name: 'News' },
  { id: 10764, name: 'Reality' },
  { id: 10765, name: 'Sci-Fi & Fantasy' },
  { id: 10766, name: 'Soap' },
  { id: 10767, name: 'Talk' },
  { id: 10768, name: 'War & Politics' },
  { id: 37, name: 'Western' },
];

function getTmdbAuth() {
  const isConfigured = config.tmdb.isConfigured();
  const headers = config.tmdb.getAuthHeaders();
  return {
    isConfigured,
    token: config.tmdb.readAccessToken,
    apiKey: config.tmdb.apiKey,
    headers,
  };
}

function formatTmdbItem(item, defaultMediaType = 'movie') {
  const mediaType = item.media_type || (item.first_air_date ? 'tv' : defaultMediaType);
  const releaseDate = item.release_date || item.first_air_date || '';
  const year = releaseDate ? releaseDate.slice(0, 4) : '';
  return {
    id: item.id,
    mediaType,
    title: item.title || item.name || 'Untitled',
    originalTitle: item.original_title || item.original_name || '',
    year,
    releaseDate,
    overview: item.overview || '',
    rating: item.vote_average ? Number(item.vote_average.toFixed(1)) : null,
    voteCount: item.vote_count || 0,
    popularity: item.popularity || 0,
    posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE_URL}/w500${item.poster_path}` : null,
    posterThumbUrl: item.poster_path ? `${TMDB_IMAGE_BASE_URL}/w342${item.poster_path}` : null,
    backdropUrl: item.backdrop_path ? `${TMDB_IMAGE_BASE_URL}/w1280${item.backdrop_path}` : null,
    genreIds: item.genre_ids || [],
  };
}

/**
 * Fetch trending movies and series.
 */
export async function fetchTrending(opts = {}) {
  const { type = 'all', window = 'week', page = 1 } = opts;
  const cacheKey = `trending:${type}:${window}:${page}`;
  const cached = discoverCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.data;
  }

  const { isConfigured, headers } = getTmdbAuth();
  if (!isConfigured) return { results: [], page: 1, totalPages: 1 };

  const params = new URLSearchParams();
  config.tmdb.applyAuthParams(params);
  params.set('page', String(page));

  const url = `${TMDB_BASE_URL}/trending/${type}/${window}?${params.toString()}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { results: [], page: 1, totalPages: 1 };
    const data = await res.json();
    const results = (data.results || [])
      .filter((i) => i.poster_path || i.backdrop_path)
      .map((i) => formatTmdbItem(i, type === 'tv' ? 'tv' : 'movie'));

    const out = {
      page: data.page || page,
      totalPages: Math.min(data.total_pages || 1, 50),
      totalResults: data.total_results || 0,
      results,
    };
    discoverCache.set(cacheKey, { timestamp: Date.now(), data: out });
    return out;
  } catch (err) {
    console.warn('[TMDB] fetchTrending failed:', err.message);
    return { results: [], page: 1, totalPages: 1 };
  }
}

/**
 * Fetch categorized movies or TV shows.
 */
export async function fetchCategory(opts = {}) {
  const { type = 'movie', category = 'popular', page = 1 } = opts;
  const validCategories = {
    movie: ['popular', 'top_rated', 'now_playing', 'upcoming'],
    tv: ['popular', 'top_rated', 'on_the_air', 'airing_today'],
  };
  const safeType = type === 'tv' ? 'tv' : 'movie';
  const safeCat = (validCategories[safeType] || []).includes(category) ? category : 'popular';

  const cacheKey = `cat:${safeType}:${safeCat}:${page}`;
  const cached = discoverCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.data;
  }

  const { isConfigured, headers } = getTmdbAuth();
  if (!isConfigured) return { results: [], page: 1, totalPages: 1 };

  const params = new URLSearchParams();
  config.tmdb.applyAuthParams(params);
  params.set('page', String(page));

  const url = `${TMDB_BASE_URL}/${safeType}/${safeCat}?${params.toString()}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { results: [], page: 1, totalPages: 1 };
    const data = await res.json();
    const results = (data.results || [])
      .filter((i) => i.poster_path || i.backdrop_path)
      .map((i) => formatTmdbItem(i, safeType));

    const out = {
      page: data.page || page,
      totalPages: Math.min(data.total_pages || 1, 50),
      totalResults: data.total_results || 0,
      results,
    };
    discoverCache.set(cacheKey, { timestamp: Date.now(), data: out });
    return out;
  } catch (err) {
    console.warn('[TMDB] fetchCategory failed:', err.message);
    return { results: [], page: 1, totalPages: 1 };
  }
}

/**
 * Fetch detailed movie or TV metadata, official YouTube trailers, and top cast.
 */
export async function fetchMediaDetailsAndVideos(mediaType, id) {
  if (!id) return null;
  const safeType = mediaType === 'tv' ? 'tv' : 'movie';
  const cacheKey = `details:${safeType}:${id}`;
  const cached = detailsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    return cached.data;
  }

  const { isConfigured, headers } = getTmdbAuth();
  if (!isConfigured) return null;

  const params = new URLSearchParams();
  config.tmdb.applyAuthParams(params);
  params.set('append_to_response', 'videos,credits');

  const url = `${TMDB_BASE_URL}/${safeType}/${id}?${params.toString()}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();

    const releaseDate = data.release_date || data.first_air_date || '';
    const year = releaseDate ? releaseDate.slice(0, 4) : '';

    // Extract videos (filtering YouTube trailers and teasers)
    let rawVideos = data.videos?.results || [];
    if (safeType === 'tv' && rawVideos.length === 0) {
      try {
        const sUrl = `${TMDB_BASE_URL}/tv/${id}/season/1/videos?${params.toString()}`;
        const sRes = await fetch(sUrl, { headers, signal: AbortSignal.timeout(5000) });
        if (sRes.ok) {
          const sData = await sRes.json();
          if (Array.isArray(sData.results) && sData.results.length > 0) {
            rawVideos = sData.results;
          }
        }
      } catch (_) {}
    }

    const ytVideos = rawVideos
      .filter((v) => v.site === 'YouTube' && v.key)
      .map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        site: v.site,
        type: v.type, // 'Trailer', 'Teaser', 'Featurette', etc.
        official: Boolean(v.official),
        embedUrl: `https://www.youtube-nocookie.com/embed/${v.key}?autoplay=1&rel=0`,
        watchUrl: `https://www.youtube.com/watch?v=${v.key}`,
      }));

    // Sort trailers: official trailer first, then any trailer, then teasers
    ytVideos.sort((a, b) => {
      const score = (v) => (v.type === 'Trailer' ? 10 : 0) + (v.official ? 5 : 0) + (v.type === 'Teaser' ? 2 : 0);
      return score(b) - score(a);
    });

    const primaryTrailer = ytVideos[0] || null;

    // Extract genres
    const genres = (data.genres || []).map((g) => g.name);

    // Extract cast
    const cast = (data.credits?.cast || []).slice(0, 6).map((c) => ({
      name: c.name,
      character: c.character,
      profileUrl: c.profile_path ? `${TMDB_IMAGE_BASE_URL}/w185${c.profile_path}` : null,
    }));

    const result = {
      id: data.id,
      mediaType: safeType,
      title: data.title || data.name || 'Untitled',
      originalTitle: data.original_title || data.original_name || '',
      tagline: data.tagline || '',
      overview: data.overview || '',
      year,
      releaseDate,
      status: data.status || '',
      rating: data.vote_average ? Number(data.vote_average.toFixed(1)) : null,
      voteCount: data.vote_count || 0,
      runtime: data.runtime || null, // minutes for movies
      numberOfSeasons: data.number_of_seasons || null,
      numberOfEpisodes: data.number_of_episodes || null,
      genres,
      cast,
      posterUrl: data.poster_path ? `${TMDB_IMAGE_BASE_URL}/w500${data.poster_path}` : null,
      backdropUrl: data.backdrop_path ? `${TMDB_IMAGE_BASE_URL}/w1280${data.backdrop_path}` : null,
      trailer: primaryTrailer,
      allTrailers: ytVideos,
    };

    detailsCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
  } catch (err) {
    console.warn(`[TMDB] fetchMediaDetailsAndVideos failed for ${safeType}/${id}:`, err.message);
    return null;
  }
}

/**
 * Search TMDB across movies and TV shows.
 */
export async function searchTmdbCatalog(query, page = 1) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { results: [], page: 1, totalPages: 1 };
  }

  const cleanQuery = query.trim();
  const cacheKey = `search:${cleanQuery.toLowerCase()}:${page}`;
  const cached = discoverCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return cached.data;
  }

  const { isConfigured, headers } = getTmdbAuth();
  if (!isConfigured) return { results: [], page: 1, totalPages: 1 };

  const params = new URLSearchParams();
  config.tmdb.applyAuthParams(params);
  params.set('query', cleanQuery);
  params.set('include_adult', 'false');
  params.set('page', String(page));

  const url = `${TMDB_BASE_URL}/search/multi?${params.toString()}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { results: [], page: 1, totalPages: 1 };
    const data = await res.json();
    const results = (data.results || [])
      .filter((i) => (i.media_type === 'movie' || i.media_type === 'tv') && (i.poster_path || i.backdrop_path))
      .map((i) => formatTmdbItem(i));

    const out = {
      page: data.page || page,
      totalPages: Math.min(data.total_pages || 1, 50),
      totalResults: data.total_results || 0,
      results,
    };
    discoverCache.set(cacheKey, { timestamp: Date.now(), data: out });
    return out;
  } catch (err) {
    console.warn(`[TMDB] searchTmdbCatalog failed for "${query}":`, err.message);
    return { results: [], page: 1, totalPages: 1 };
  }
}

/**
 * Fetch genres list for movies, tv series, or unified/all.
 */
export async function fetchGenres(type = 'all') {
  const safeType = type === 'tv' ? 'tv' : (type === 'movie' ? 'movie' : 'all');
  const cacheKey = `genres:${safeType}`;
  const cached = genreCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
    return cached.data;
  }

  const { isConfigured, headers } = getTmdbAuth();

  const fetchTypeList = async (mediaType) => {
    if (!isConfigured) {
      return mediaType === 'tv' ? DEFAULT_TV_GENRES : DEFAULT_MOVIE_GENRES;
    }
    try {
      const params = new URLSearchParams();
      config.tmdb.applyAuthParams(params);
      const url = `${TMDB_BASE_URL}/genre/${mediaType}/list?${params.toString()}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        return mediaType === 'tv' ? DEFAULT_TV_GENRES : DEFAULT_MOVIE_GENRES;
      }
      const data = await res.json();
      return Array.isArray(data.genres) && data.genres.length > 0
        ? data.genres
        : (mediaType === 'tv' ? DEFAULT_TV_GENRES : DEFAULT_MOVIE_GENRES);
    } catch (err) {
      console.warn(`[TMDB] fetchGenres failed for ${mediaType}:`, err.message);
      return mediaType === 'tv' ? DEFAULT_TV_GENRES : DEFAULT_MOVIE_GENRES;
    }
  };

  let results = [];
  if (safeType === 'movie') {
    results = await fetchTypeList('movie');
  } else if (safeType === 'tv') {
    results = await fetchTypeList('tv');
  } else {
    const [movies, tvs] = await Promise.all([fetchTypeList('movie'), fetchTypeList('tv')]);
    const map = new Map();
    [...movies, ...tvs].forEach((g) => {
      if (!map.has(g.name.toLowerCase())) {
        map.set(g.name.toLowerCase(), g);
      }
    });
    results = Array.from(map.values());
  }

  const out = { genres: results };
  genreCache.set(cacheKey, { timestamp: Date.now(), data: out });
  return out;
}

/**
 * Discover movies or TV shows by genre ID.
 */
export async function fetchDiscoverByGenre(opts = {}) {
  const { type = 'movie', genreId, page = 1, sortBy = 'popularity.desc' } = opts;
  const safeType = type === 'tv' ? 'tv' : 'movie';
  const cleanGenreId = String(genreId || '').trim();

  if (!cleanGenreId) {
    return { results: [], page: 1, totalPages: 1, totalResults: 0 };
  }

  const cacheKey = `discover:genre:${safeType}:${cleanGenreId}:${sortBy}:${page}`;
  const cached = discoverCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.data;
  }

  const { isConfigured, headers } = getTmdbAuth();
  if (!isConfigured) return { results: [], page: 1, totalPages: 1, totalResults: 0 };

  const params = new URLSearchParams();
  config.tmdb.applyAuthParams(params);
  params.set('with_genres', cleanGenreId);
  params.set('sort_by', sortBy);
  params.set('include_adult', 'false');
  params.set('page', String(page));

  const url = `${TMDB_BASE_URL}/discover/${safeType}?${params.toString()}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { results: [], page: 1, totalPages: 1, totalResults: 0 };
    const data = await res.json();
    const results = (data.results || [])
      .filter((i) => i.poster_path || i.backdrop_path)
      .map((i) => formatTmdbItem(i, safeType));

    const out = {
      page: data.page || page,
      totalPages: Math.min(data.total_pages || 1, 50),
      totalResults: data.total_results || 0,
      results,
    };
    discoverCache.set(cacheKey, { timestamp: Date.now(), data: out });
    return out;
  } catch (err) {
    console.warn(`[TMDB] fetchDiscoverByGenre failed for ${safeType} genre ${cleanGenreId}:`, err.message);
    return { results: [], page: 1, totalPages: 1, totalResults: 0 };
  }
}

export default {
  parseMediaTitle,
  fetchTmdbMetadata,
  fetchTrending,
  fetchCategory,
  fetchMediaDetailsAndVideos,
  searchTmdbCatalog,
  fetchGenres,
  fetchDiscoverByGenre,
};


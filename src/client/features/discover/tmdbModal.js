'use strict';

import { api } from '../../services/apiService.js';
import { escapeHtml, showToast } from '../../utils/domHelpers.js';
import { CONSTANTS } from '../../config/constants.js';

export class TmdbModal {
  constructor(options = {}) {
    this.onStreamTorrent = options.onStreamTorrent || (() => {});
    this.activeDetails = null;
    this.activeMagnets = [];
    this.currentQuality = 'all';

    this.initElements();
  }

  initElements() {
    this.modal = document.getElementById('tmdb-modal');
    this.backdrop = document.getElementById('tmdb-modal-backdrop');
    this.backdropImg = document.getElementById('tmdb-backdrop-img');
    this.btnClose = document.getElementById('btn-tmdb-close');
    this.btnCancel = document.getElementById('btn-tmdb-modal-cancel');
    this.posterImg = document.getElementById('tmdb-poster-img');
    this.ratingPill = document.getElementById('tmdb-rating-pill');
    this.votesText = document.getElementById('tmdb-votes-text');
    this.metaType = document.getElementById('tmdb-meta-type');
    this.metaStatus = document.getElementById('tmdb-meta-status');
    this.metaRuntime = document.getElementById('tmdb-meta-runtime');
    this.metaDate = document.getElementById('tmdb-meta-date');
    this.title = document.getElementById('tmdb-title');
    this.tagline = document.getElementById('tmdb-tagline');
    this.genresWrap = document.getElementById('tmdb-genres-wrap');
    this.overview = document.getElementById('tmdb-overview');
    this.castList = document.getElementById('tmdb-cast-list');
    this.trailerFrameWrap = document.getElementById('tmdb-trailer-frame-wrap');
    this.trailerIframe = document.getElementById('tmdb-trailer-iframe');
    this.trailerFallback = document.getElementById('tmdb-trailer-fallback');
    this.trailerYtLink = document.getElementById('tmdb-trailer-yt-link');
    this.btnMagnetSearch = document.getElementById('btn-tmdb-magnet-search');
    this.magnetsList = document.getElementById('tmdb-magnets-list');
    this.magnetsCountBadge = document.getElementById('tmdb-magnets-count-badge');
    this.qualityFilters = document.getElementById('magnets-quality-filters');
    this.seasonSelectorWrap = document.getElementById('tmdb-season-selector-wrap');
    this.seasonSelector = document.getElementById('tmdb-season-selector');

    this.attachEvents();
  }

  attachEvents() {
    if (this.btnClose) this.btnClose.addEventListener('click', () => this.close());
    if (this.btnCancel) this.btnCancel.addEventListener('click', () => this.close());
    if (this.backdrop) this.backdrop.addEventListener('click', () => this.close());

    if (this.btnMagnetSearch) {
      this.btnMagnetSearch.addEventListener('click', () => this.searchReleases());
    }

    if (this.qualityFilters) {
      this.qualityFilters.addEventListener('click', (e) => {
        const btn = e.target.closest('.magnet-filter-btn') || e.target.closest('.quality-filter-btn');
        if (!btn) return;
        this.currentQuality = btn.dataset.quality || 'all';
        this.qualityFilters.querySelectorAll('.magnet-filter-btn, .quality-filter-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        this.renderMagnets();
      });
    }

    if (this.seasonSelector) {
      this.seasonSelector.addEventListener('change', () => this.searchReleases());
    }
  }

  async open(mediaType, id, autoplayTrailer = false) {
    if (!this.modal) return;
    this.modal.hidden = false;
    document.body.style.overflow = 'hidden';

    try {
      const details = await api.getMediaDetails(mediaType, id);
      this.activeDetails = details;
      this.renderDetails(autoplayTrailer);
      this.searchReleases();
    } catch (err) {
      showToast('Could not load details for this title.', 'error');
      this.close();
    }
  }

  close() {
    if (!this.modal) return;
    this.modal.hidden = true;
    document.body.style.overflow = '';
    if (this.trailerIframe) this.trailerIframe.src = '';
    this.activeDetails = null;
    this.activeMagnets = [];
  }

  renderDetails(autoplayTrailer) {
    const d = this.activeDetails;
    if (!d) return;

    if (this.backdropImg && d.backdropUrl) this.backdropImg.src = d.backdropUrl;
    if (this.posterImg) this.posterImg.src = d.posterUrl || CONSTANTS.DEFAULT_PLACEHOLDER_POSTER;
    if (this.title) this.title.textContent = d.title;
    if (this.tagline) this.tagline.textContent = d.tagline || '';
    if (this.overview) this.overview.textContent = d.overview || 'No overview available.';
    if (this.ratingPill) this.ratingPill.textContent = `★ ${d.rating || 'N/A'}`;
    if (this.metaType) this.metaType.textContent = (d.mediaType || 'movie').toUpperCase();
    if (this.metaDate) this.metaDate.textContent = d.year || d.releaseDate || '';
    if (this.metaRuntime) {
      this.metaRuntime.textContent = d.runtime ? `${d.runtime} min` : (d.numberOfSeasons ? `${d.numberOfSeasons} Season${d.numberOfSeasons > 1 ? 's' : ''}` : '');
    }

    // Render Genres
    if (this.genresWrap) {
      this.genresWrap.innerHTML = (d.genres || [])
        .map((g) => `<span class="genre-pill">${escapeHtml(g)}</span>`)
        .join('');
    }

    // Render Cast
    if (this.castList) {
      this.castList.innerHTML = (d.cast || [])
        .map((c) => `
          <div class="cast-item">
            ${c.profileUrl ? `<img src="${c.profileUrl}" alt="${escapeHtml(c.name)}" />` : '<div class="cast-avatar-placeholder">👤</div>'}
            <span class="cast-name">${escapeHtml(c.name)}</span>
            <span class="cast-role">${escapeHtml(c.character || '')}</span>
          </div>
        `)
        .join('');
    }

    // Render Trailer
    if (d.trailer && this.trailerIframe) {
      if (this.trailerFrameWrap) this.trailerFrameWrap.hidden = false;
      if (this.trailerFallback) this.trailerFallback.hidden = true;
      this.trailerIframe.src = autoplayTrailer ? d.trailer.embedUrl : d.trailer.embedUrl.replace('autoplay=1', 'autoplay=0');
    } else {
      if (this.trailerFrameWrap) this.trailerFrameWrap.hidden = true;
      if (this.trailerFallback) this.trailerFallback.hidden = false;
    }
  }

  async searchReleases() {
    if (!this.activeDetails) return;
    if (this.magnetsList) {
      this.magnetsList.innerHTML = `
        <div class="magnets-loading">
          <div class="spinner"></div>
          <span>Searching verified swarm releases...</span>
        </div>
      `;
    }

    const d = this.activeDetails;
    const season = this.seasonSelector ? this.seasonSelector.value : '';

    try {
      const data = await api.searchTorrents(d.title, d.year, d.mediaType, season);
      this.activeMagnets = data.results || [];
      this.renderMagnets();
    } catch (err) {
      if (this.magnetsList) {
        this.magnetsList.innerHTML = `
          <div class="magnets-empty">
            <p>Could not load releases at this moment.</p>
          </div>
        `;
      }
    }
  }

  renderMagnets() {
    if (!this.magnetsList) return;
    if (this.qualityFilters) {
      this.qualityFilters.hidden = this.activeMagnets.length === 0;
    }
    let list = this.activeMagnets;
    if (this.currentQuality !== 'all') {
      list = list.filter((m) => m.quality === this.currentQuality);
    }

    if (this.magnetsCountBadge) {
      this.magnetsCountBadge.textContent = list.length;
    }

    if (list.length === 0) {
      this.magnetsList.innerHTML = `
        <div class="magnets-empty">
          <p>No verified releases found matching your filter.</p>
        </div>
      `;
      return;
    }

    this.magnetsList.innerHTML = list
      .map((item) => {
        const q = (item.quality || 'hd').toLowerCase();
        const qualityClass = q.includes('4k') ? '4k' : (q.includes('1080') ? '1080p' : (q.includes('720') ? '720p' : 'hd'));

        return `
        <div class="magnet-release-row">
          <div class="release-main-col">
            <div class="release-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
            <div class="release-meta-row">
              <span class="badge-quality badge-quality-${qualityClass}">${item.quality || 'HD'}</span>
              <span class="release-seeders">⚡ ${item.seeders || 0} seeders</span>
              <span class="release-size">📦 ${item.sizeFormatted || 'Unknown'}</span>
              <span class="release-provider">${item.provider || 'Swarm'}</span>
            </div>
          </div>
          <div class="release-actions">
            <button class="btn-stream-now btn-stream-action" data-magnet="${escapeHtml(item.magnetUrl)}" data-name="${escapeHtml(item.name)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"></polygon>
              </svg>
              <span>Stream</span>
            </button>
          </div>
        </div>
      `;
      })
      .join('');

    this.magnetsList.querySelectorAll('.btn-stream-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const magnet = btn.dataset.magnet;
        const name = btn.dataset.name;
        if (magnet) {
          const details = this.activeDetails;
          this.close();
          this.onStreamTorrent(magnet, name, details);
        }
      });
    });
  }
}

export default TmdbModal;

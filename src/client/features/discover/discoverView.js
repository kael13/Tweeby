'use strict';

import { api } from '../../services/apiService.js';
import { CONSTANTS } from '../../config/constants.js';
import { escapeHtml } from '../../utils/domHelpers.js';

export class DiscoverView {
  constructor(options = {}) {
    this.onOpenDetails = options.onOpenDetails || (() => {});
    this.currentFilter = 'trending-all';
    this.activeGenreId = null;
    this.activeGenreName = '';
    this.currentPage = 1;
    this.totalPages = 1;
    this.items = [];
    this.heroItem = null;
    this.genres = [];
    this.isDropdownOpen = false;

    this.initElements();
  }

  initElements() {
    this.discoverHero = document.getElementById('discover-hero');
    this.heroBackdrop = document.getElementById('hero-backdrop');
    this.heroRating = document.getElementById('hero-rating');
    this.heroYear = document.getElementById('hero-year');
    this.heroType = document.getElementById('hero-type');
    this.heroTitle = document.getElementById('hero-title');
    this.heroOverview = document.getElementById('hero-overview');
    this.btnHeroTrailer = document.getElementById('btn-hero-trailer');
    this.btnHeroDetails = document.getElementById('btn-hero-details');

    this.discoverFiltersEl = document.getElementById('discover-filters');
    this.genreDropdownWrap = document.getElementById('genre-dropdown-wrap');
    this.genreDropdownBtn = document.getElementById('genre-dropdown-btn');
    this.genreDropdownLabel = document.getElementById('genre-dropdown-label');
    this.genreDropdownMenu = document.getElementById('genre-dropdown-menu');
    this.genreDropdownSearch = document.getElementById('genre-dropdown-search');
    this.genreDropdownList = document.getElementById('genre-dropdown-list');

    this.discoverHeadingEl = document.getElementById('discover-heading');
    this.discoverSubtitleEl = document.getElementById('discover-subtitle');
    this.discoverGridEl = document.getElementById('discover-grid');
    this.discoverPaginationWrap = document.getElementById('discover-pagination-wrap');
    this.discoverPaginationInfo = document.getElementById('discover-pagination-info');
    this.discoverPaginationPages = document.getElementById('discover-pagination-pages');
    this.btnDiscoverPrev = document.getElementById('btn-discover-prev');
    this.btnDiscoverNext = document.getElementById('btn-discover-next');

    this.attachEvents();
    this.loadGenres();
  }

  getMediaType() {
    if (this.currentFilter.includes('tv')) return 'tv';
    if (this.currentFilter.includes('movie')) return 'movie';
    return 'all';
  }

  attachEvents() {
    if (this.discoverFiltersEl) {
      this.discoverFiltersEl.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (!pill) return;
        const filter = pill.dataset.filter;
        if (filter && filter !== this.currentFilter) {
          this.setFilter(filter);
        }
      });
    }

    // Genre Dropdown Toggle
    if (this.genreDropdownBtn) {
      this.genreDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleGenreDropdown();
      });
    }

    // Genre Dropdown Search Filter
    if (this.genreDropdownSearch) {
      this.genreDropdownSearch.addEventListener('input', (e) => {
        const term = (e.target.value || '').trim().toLowerCase();
        this.renderGenreDropdownItems(term);
      });
      this.genreDropdownSearch.addEventListener('click', (e) => e.stopPropagation());
    }

    // Genre Dropdown Option Click
    if (this.genreDropdownList) {
      this.genreDropdownList.addEventListener('click', (e) => {
        const item = e.target.closest('.genre-dropdown-item');
        if (!item) return;
        const genreId = item.dataset.genreId;
        const genreName = item.dataset.genreName || '';
        this.setGenreFilter(genreId, genreName);
        this.closeGenreDropdown();
      });
    }

    // Close Dropdown on Click Outside
    document.addEventListener('click', (e) => {
      if (this.isDropdownOpen && this.genreDropdownWrap && !this.genreDropdownWrap.contains(e.target)) {
        this.closeGenreDropdown();
      }
    });

    // Close Dropdown on Escape Key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isDropdownOpen) {
        this.closeGenreDropdown();
      }
    });

    if (this.btnDiscoverPrev) {
      this.btnDiscoverPrev.addEventListener('click', () => {
        if (this.currentPage > 1) this.fetchFeed(this.currentPage - 1);
      });
    }

    if (this.btnDiscoverNext) {
      this.btnDiscoverNext.addEventListener('click', () => {
        if (this.currentPage < this.totalPages) this.fetchFeed(this.currentPage + 1);
      });
    }

    if (this.btnHeroDetails) {
      this.btnHeroDetails.addEventListener('click', () => {
        if (this.heroItem) this.onOpenDetails(this.heroItem.mediaType, this.heroItem.id);
      });
    }

    if (this.btnHeroTrailer) {
      this.btnHeroTrailer.addEventListener('click', () => {
        if (this.heroItem) this.onOpenDetails(this.heroItem.mediaType, this.heroItem.id, true);
      });
    }
  }

  toggleGenreDropdown() {
    if (this.isDropdownOpen) {
      this.closeGenreDropdown();
    } else {
      this.openGenreDropdown();
    }
  }

  openGenreDropdown() {
    if (!this.genreDropdownMenu) return;
    this.isDropdownOpen = true;
    this.genreDropdownMenu.hidden = false;
    this.genreDropdownWrap?.classList.add('dropdown-open');
    this.genreDropdownBtn?.setAttribute('aria-expanded', 'true');
    if (this.genreDropdownSearch) {
      this.genreDropdownSearch.value = '';
      this.renderGenreDropdownItems('');
      setTimeout(() => this.genreDropdownSearch.focus(), 50);
    }
  }

  closeGenreDropdown() {
    if (!this.genreDropdownMenu) return;
    this.isDropdownOpen = false;
    this.genreDropdownMenu.hidden = true;
    this.genreDropdownWrap?.classList.remove('dropdown-open');
    this.genreDropdownBtn?.setAttribute('aria-expanded', 'false');
  }

  async loadGenres() {
    const mediaType = this.getMediaType();
    
    // 1. Immediately seed default genres so the dropdown list is instantly full
    if (mediaType === 'tv') {
      this.genres = [...(CONSTANTS.DEFAULT_TV_GENRES || [])];
    } else if (mediaType === 'movie') {
      this.genres = [...(CONSTANTS.DEFAULT_MOVIE_GENRES || [])];
    } else {
      const merged = new Map();
      [...(CONSTANTS.DEFAULT_MOVIE_GENRES || []), ...(CONSTANTS.DEFAULT_TV_GENRES || [])].forEach((g) => {
        if (!merged.has(g.name.toLowerCase())) merged.set(g.name.toLowerCase(), g);
      });
      this.genres = Array.from(merged.values());
    }
    this.renderGenreDropdownItems();

    // 2. Fetch live genres from server
    try {
      const data = await api.getGenres(mediaType);
      if (Array.isArray(data.genres) && data.genres.length > 0) {
        this.genres = data.genres;
        this.renderGenreDropdownItems();
      }
    } catch (err) {
      console.warn('[DiscoverView] Live genres fetch failed, using fallback:', err.message);
    }
  }

  renderGenreDropdownItems(searchTerm = '') {
    if (!this.genreDropdownList) return;
    const isAllActive = !this.activeGenreId || this.activeGenreId === 'all';
    
    let filteredGenres = this.genres;
    if (searchTerm) {
      filteredGenres = this.genres.filter((g) => g.name.toLowerCase().includes(searchTerm));
    }

    let html = '';
    
    // Show 'All Genres' item if no search term or matches search
    if (!searchTerm || 'all genres'.includes(searchTerm)) {
      html += `
        <div class="genre-dropdown-item ${isAllActive ? 'active' : ''}" data-genre-id="all" role="option" tabindex="0">
          <span class="genre-item-label">✨ All Genres</span>
          ${isAllActive ? '<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
        </div>
      `;
    }

    if (filteredGenres.length === 0 && searchTerm) {
      html += `
        <div class="genre-dropdown-empty">
          <span>No matching genres</span>
        </div>
      `;
    } else {
      html += filteredGenres
        .map((g) => {
          const isActive = String(this.activeGenreId) === String(g.id);
          return `
            <div class="genre-dropdown-item ${isActive ? 'active' : ''}" data-genre-id="${g.id}" data-genre-name="${escapeHtml(g.name)}" role="option" tabindex="0">
              <span class="genre-item-label">${escapeHtml(g.name)}</span>
              ${isActive ? '<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
            </div>
          `;
        })
        .join('');
    }

    this.genreDropdownList.innerHTML = html;
  }

  async setGenreFilter(genreId, genreName = '') {
    if (genreId === 'all' || !genreId) {
      this.activeGenreId = null;
      this.activeGenreName = '';
      if (this.genreDropdownLabel) this.genreDropdownLabel.textContent = 'All Genres';
      this.genreDropdownBtn?.classList.remove('has-filter');
    } else {
      this.activeGenreId = genreId;
      this.activeGenreName = genreName;
      if (this.genreDropdownLabel) this.genreDropdownLabel.textContent = genreName;
      this.genreDropdownBtn?.classList.add('has-filter');
    }

    this.renderGenreDropdownItems();
    this.updateSectionTitles();
    await this.fetchFeed(1);
  }

  updateSectionTitles() {
    const titles = {
      'trending-all': { heading: 'Trending This Week', sub: 'Live movies and television series from TMDB' },
      'trending-movie': { heading: 'Trending Movies', sub: 'Top watched movies this week' },
      'trending-tv': { heading: 'Trending TV Series', sub: 'Popular television series streaming this week' },
      'top-rated': { heading: 'Top Rated All-Time', sub: 'Highest rated movies & series by global critics' },
      'popular-movie': { heading: 'Popular Movies', sub: 'Box office and streaming sensations' },
      'popular-tv': { heading: 'Popular TV Shows', sub: 'Most watched shows worldwide' },
    };

    if (this.activeGenreId && this.activeGenreName) {
      const typeLabel = this.getMediaType() === 'tv' ? 'TV Series' : 'Movies';
      if (this.discoverHeadingEl) this.discoverHeadingEl.textContent = `${this.activeGenreName} ${typeLabel}`;
      if (this.discoverSubtitleEl) this.discoverSubtitleEl.textContent = `Explore popular ${this.activeGenreName.toLowerCase()} titles`;
    } else if (titles[this.currentFilter]) {
      if (this.discoverHeadingEl) this.discoverHeadingEl.textContent = titles[this.currentFilter].heading;
      if (this.discoverSubtitleEl) this.discoverSubtitleEl.textContent = titles[this.currentFilter].sub;
    }
  }

  async setFilter(filter) {
    this.currentFilter = filter;
    this.activeGenreId = null;
    this.activeGenreName = '';
    if (this.genreDropdownLabel) this.genreDropdownLabel.textContent = 'All Genres';
    this.genreDropdownBtn?.classList.remove('has-filter');
    this.closeGenreDropdown();

    if (this.discoverFiltersEl) {
      this.discoverFiltersEl.querySelectorAll('.filter-pill').forEach((p) => {
        p.classList.toggle('active', p.dataset.filter === filter);
      });
    }

    this.updateSectionTitles();
    await this.loadGenres();
    await this.fetchFeed(1);
  }

  async fetchFeed(page = 1) {
    this.currentPage = page;
    if (this.discoverGridEl) {
      this.discoverGridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⏳</div>
          <h3>Loading catalog...</h3>
          <p>Fetching titles from TMDB</p>
        </div>
      `;
    }

    try {
      let data;
      if (this.activeGenreId) {
        const mediaType = this.getMediaType() === 'tv' ? 'tv' : 'movie';
        data = await api.getDiscoverByGenre(mediaType, this.activeGenreId, page);
      } else if (this.currentFilter === 'trending-all') {
        data = await api.getTrending('all', 'week', page);
      } else if (this.currentFilter === 'trending-movie') {
        data = await api.getTrending('movie', 'week', page);
      } else if (this.currentFilter === 'trending-tv') {
        data = await api.getTrending('tv', 'week', page);
      } else if (this.currentFilter === 'top-rated') {
        data = await api.getCategory('movie', 'top_rated', page);
      } else if (this.currentFilter === 'popular-movie') {
        data = await api.getCategory('movie', 'popular', page);
      } else if (this.currentFilter === 'popular-tv') {
        data = await api.getCategory('tv', 'popular', page);
      } else {
        data = await api.getTrending('all', 'week', page);
      }

      this.items = data.results || [];
      this.totalPages = data.totalPages || 1;
      this.render();
    } catch (err) {
      console.error('[DiscoverView] fetchFeed error:', err);
      if (this.discoverGridEl) {
        this.discoverGridEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <h3>Could not load catalog</h3>
            <p>${escapeHtml(err.message || 'Please ensure the server is running and TMDB API credentials are configured in .env.')}</p>
          </div>
        `;
      }
    }
  }

  render() {
    // Render Hero (from first item on page 1)
    if (this.currentPage === 1 && this.items.length > 0) {
      this.heroItem = this.items[0];
      if (this.discoverHero) {
        this.discoverHero.hidden = false;
        if (this.heroBackdrop && this.heroItem.backdropUrl) {
          this.heroBackdrop.style.backgroundImage = `url('${this.heroItem.backdropUrl}')`;
        }
        if (this.heroTitle) this.heroTitle.textContent = this.heroItem.title;
        if (this.heroOverview) this.heroOverview.textContent = this.heroItem.overview || 'No synopsis available.';
        if (this.heroRating) this.heroRating.textContent = `★ ${this.heroItem.rating || 'N/A'}`;
        if (this.heroYear) this.heroYear.textContent = this.heroItem.year || '';
        if (this.heroType) this.heroType.textContent = (this.heroItem.mediaType || 'Movie').toUpperCase();
      }
    }

    // Render Grid Cards
    if (!this.discoverGridEl) return;
    if (this.items.length === 0) {
      this.discoverGridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎬</div>
          <h3>No titles found</h3>
          <p>Try selecting another genre or category above.</p>
        </div>
      `;
      return;
    }

    this.discoverGridEl.innerHTML = this.items
      .map((item) => `
        <article class="poster-card" data-media-type="${item.mediaType}" data-id="${item.id}" tabindex="0" role="button" aria-label="${escapeHtml(item.title)}">
          <div class="poster-art-wrap">
            <img class="poster-img" src="${item.posterThumbUrl || item.posterUrl || CONSTANTS.DEFAULT_PLACEHOLDER_POSTER}" alt="${escapeHtml(item.title)}" loading="lazy" />
            <div class="poster-overlay">
              <button class="poster-play-btn" aria-label="Play & Details">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 20 12 6 21 6 3"></polygon>
                </svg>
              </button>
            </div>
            <div class="poster-rating-badge">★ ${item.rating || 'N/A'}</div>
            <span class="poster-type-badge">${(item.mediaType || 'movie').toUpperCase()}</span>
          </div>
          <div class="poster-info">
            <div class="poster-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            <div class="poster-meta-row">
              <span>${item.year || ''}</span>
              <span>${item.mediaType === 'tv' ? 'Series' : 'Movie'}</span>
            </div>
          </div>
        </article>
      `)
      .join('');

    // Attach card click handlers
    this.discoverGridEl.querySelectorAll('.poster-card').forEach((card) => {
      card.addEventListener('click', () => {
        const type = card.dataset.mediaType;
        const id = card.dataset.id;
        if (type && id) this.onOpenDetails(type, id);
      });
    });

    // Render pagination
    if (this.discoverPaginationWrap) {
      this.discoverPaginationWrap.hidden = this.totalPages <= 1;
    }
    if (this.discoverPaginationInfo) {
      this.discoverPaginationInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
    }
    if (this.btnDiscoverPrev) this.btnDiscoverPrev.disabled = this.currentPage <= 1;
    if (this.btnDiscoverNext) this.btnDiscoverNext.disabled = this.currentPage >= this.totalPages;
  }
}

export default DiscoverView;

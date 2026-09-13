'use strict';

import { api } from '../../services/apiService.js';
import { escapeHtml } from '../../utils/domHelpers.js';
import { CONSTANTS } from '../../config/constants.js';
import { getMediaProgress } from '../../utils/storage.js';

export class LibraryView {
  constructor(options = {}) {
    this.onPlayItem = options.onPlayItem || (() => {});
    this.items = [];
    this.currentCategory = 'all';
    this.searchQuery = '';

    this.initElements();
  }

  initElements() {
    this.grid = document.getElementById('poster-grid');
    this.emptyState = document.getElementById('empty-state');
    this.categoryFilters = document.getElementById('category-filters');
    this.libraryCountBadge = document.getElementById('library-count-badge');

    this.attachEvents();
  }

  attachEvents() {
    const emptyAddBtn = document.getElementById('empty-add-btn');
    if (emptyAddBtn) {
      emptyAddBtn.addEventListener('click', () => {
        const magnetPanel = document.getElementById('magnet-panel');
        if (magnetPanel) magnetPanel.hidden = false;
        const magnetInput = document.getElementById('magnet');
        if (magnetInput) magnetInput.focus();
      });
    }

    if (this.categoryFilters) {
      this.categoryFilters.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (!pill) return;
        this.currentCategory = pill.dataset.category || 'all';
        this.categoryFilters.querySelectorAll('.filter-pill').forEach((p) => {
          p.classList.toggle('active', p === pill);
        });
        this.render();
      });
    }
  }

  async load() {
    try {
      const data = await api.getLibrary();
      this.items = data.items || [];
      if (this.libraryCountBadge) {
        this.libraryCountBadge.textContent = this.items.length;
        this.libraryCountBadge.hidden = this.items.length === 0;
      }

      // Update category counts
      const counts = { all: this.items.length, video: 0, audio: 0, image: 0, other: 0 };
      for (const i of this.items) {
        if (counts[i.category] !== undefined) counts[i.category]++;
        else counts.other++;
      }

      for (const [cat, cnt] of Object.entries(counts)) {
        const el = document.getElementById(`count-${cat}`);
        if (el) el.textContent = cnt;
      }

      this.render();
    } catch (err) {
      console.error('[LibraryView] Load error:', err);
    }
  }

  setSearchQuery(q) {
    this.searchQuery = (q || '').toLowerCase().trim();
    this.render();
  }


  render() {
    if (!this.grid) return;

    let filtered = this.items;
    if (this.currentCategory !== 'all') {
      filtered = filtered.filter((i) => i.category === this.currentCategory);
    }
    if (this.searchQuery) {
      filtered = filtered.filter((i) => (i.name || '').toLowerCase().includes(this.searchQuery));
    }

    if (filtered.length === 0) {
      this.grid.innerHTML = '';
      if (this.emptyState) this.emptyState.hidden = false;
      return;
    }

    if (this.emptyState) this.emptyState.hidden = true;

    this.grid.innerHTML = filtered
      .map((item) => {
        const prog = getMediaProgress(item);
        const progPct = prog ? (prog.percent * 100).toFixed(0) : 0;

        return `
          <article class="poster-card" data-id="${item.id}" tabindex="0" role="button" aria-label="${escapeHtml(item.name)}">
            <div class="poster-art-wrap">
              <img class="poster-img" src="${item.posterUrl || CONSTANTS.DEFAULT_PLACEHOLDER_POSTER}" alt="${escapeHtml(item.name)}" loading="lazy" />
              ${progPct > 0 ? `<div class="card-progress-track"><div class="card-progress-bar" style="width: ${progPct}%;"></div></div>` : ''}
              <div class="poster-overlay">
                <button class="poster-play-btn" aria-label="Play">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 3 20 12 6 21 6 3"></polygon>
                  </svg>
                </button>
              </div>
              <span class="poster-type-badge">${(item.category || 'media').toUpperCase()}</span>
            </div>
            <div class="poster-info">
              <div class="poster-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
              <div class="poster-meta-row">
                <span>${item.category}</span>
                <span>${item.duration ? `${Math.floor(item.duration / 60)} min` : ''}</span>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    this.grid.querySelectorAll('.poster-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const item = this.items.find((i) => i.id === id);
        if (item) this.onPlayItem(item);
      });
    });
  }
}

export default LibraryView;

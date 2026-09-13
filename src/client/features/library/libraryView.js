'use strict';

import { api } from '../../services/apiService.js';
import { escapeHtml, showToast } from '../../utils/domHelpers.js';
import { CONSTANTS } from '../../config/constants.js';
import { getMediaProgress } from '../../utils/storage.js';
import { formatBytes, formatDuration } from '../../utils/formatters.js';

export class LibraryView {
  constructor(options = {}) {
    this.onPlayItem = options.onPlayItem || (() => {});
    this.items = [];
    this.currentCategory = 'all';
    this.searchQuery = '';
    this.viewMode = localStorage.getItem('tweeby_media_view_mode') || 'grid';
    this.selectedPaths = new Set();
    this.deleteTargetPaths = [];

    this.initElements();
  }

  initElements() {
    this.displayContainer = document.getElementById('media-display-container');
    this.grid = document.getElementById('poster-grid');
    this.list = document.getElementById('poster-list');
    this.emptyState = document.getElementById('empty-state');
    this.categoryFilters = document.getElementById('category-filters');
    this.libraryCountBadge = document.getElementById('library-count-badge');
    this.mediaSubtitle = document.getElementById('media-subtitle');

    // View Switcher Elements
    this.btnViewGrid = document.getElementById('btn-view-grid');
    this.btnViewList = document.getElementById('btn-view-list');

    // Selection & Batch Action Elements
    this.selectAllCheckbox = document.getElementById('select-all-media');
    this.selectAllText = document.getElementById('select-all-text');
    this.batchBar = document.getElementById('media-batch-bar');
    this.batchCount = document.getElementById('batch-selected-count');
    this.batchSize = document.getElementById('batch-selected-size');
    this.batchDeleteCount = document.getElementById('batch-delete-count');
    this.btnBatchDeselect = document.getElementById('btn-batch-deselect');
    this.btnBatchDelete = document.getElementById('btn-batch-delete');

    // Delete Confirmation Modal Elements
    this.deleteModal = document.getElementById('delete-confirm-modal');
    this.deleteModalBackdrop = document.getElementById('delete-modal-backdrop');
    this.deleteModalClose = document.getElementById('delete-modal-close');
    this.btnDeleteCancel = document.getElementById('btn-delete-cancel');
    this.btnDeleteConfirm = document.getElementById('btn-delete-confirm');
    this.deleteModalCount = document.getElementById('delete-modal-count');
    this.deleteModalSizePill = document.getElementById('delete-modal-size-pill');
    this.deleteModalItemsList = document.getElementById('delete-modal-items-list');

    this.attachEvents();
    this.applyViewMode(this.viewMode, false);
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

    // Category Filter Pills
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

    // View Switcher (Grid vs List)
    if (this.btnViewGrid) {
      this.btnViewGrid.addEventListener('click', () => this.applyViewMode('grid'));
    }
    if (this.btnViewList) {
      this.btnViewList.addEventListener('click', () => this.applyViewMode('list'));
    }

    // Master Select / Deselect All
    if (this.selectAllCheckbox) {
      this.selectAllCheckbox.addEventListener('change', () => {
        this.toggleSelectAll(this.selectAllCheckbox.checked);
      });
    }

    // Batch Actions Bar
    if (this.btnBatchDeselect) {
      this.btnBatchDeselect.addEventListener('click', () => {
        this.clearSelection();
      });
    }
    if (this.btnBatchDelete) {
      this.btnBatchDelete.addEventListener('click', () => {
        if (this.selectedPaths.size > 0) {
          this.openDeleteModal(Array.from(this.selectedPaths));
        }
      });
    }

    // Delete Confirmation Modal Listeners
    if (this.deleteModalClose) {
      this.deleteModalClose.addEventListener('click', () => this.closeDeleteModal());
    }
    if (this.deleteModalBackdrop) {
      this.deleteModalBackdrop.addEventListener('click', () => this.closeDeleteModal());
    }
    if (this.btnDeleteCancel) {
      this.btnDeleteCancel.addEventListener('click', () => this.closeDeleteModal());
    }
    if (this.btnDeleteConfirm) {
      this.btnDeleteConfirm.addEventListener('click', () => this.executeDelete());
    }
  }

  applyViewMode(mode, shouldRender = true) {
    this.viewMode = mode === 'list' ? 'list' : 'grid';
    try {
      localStorage.setItem('tweeby_media_view_mode', this.viewMode);
    } catch (_) {}

    if (this.btnViewGrid && this.btnViewList) {
      this.btnViewGrid.classList.toggle('active', this.viewMode === 'grid');
      this.btnViewList.classList.toggle('active', this.viewMode === 'list');
    }

    if (this.displayContainer) {
      this.displayContainer.className = `media-display-container mode-${this.viewMode}`;
    }

    if (this.grid) this.grid.hidden = this.viewMode !== 'grid';
    if (this.list) this.list.hidden = this.viewMode !== 'list';

    if (shouldRender) {
      this.render();
    }
  }

  getFilteredItems() {
    let filtered = this.items;
    if (this.currentCategory !== 'all') {
      filtered = filtered.filter((i) => i.category === this.currentCategory);
    }
    if (this.searchQuery) {
      filtered = filtered.filter((i) =>
        (i.name || '').toLowerCase().includes(this.searchQuery) ||
        (i.path || '').toLowerCase().includes(this.searchQuery)
      );
    }
    return filtered;
  }

  toggleSelectAll(checked) {
    const visibleItems = this.getFilteredItems();
    if (checked) {
      for (const item of visibleItems) {
        if (item.path) this.selectedPaths.add(item.path);
      }
    } else {
      for (const item of visibleItems) {
        if (item.path) this.selectedPaths.delete(item.path);
      }
    }
    this.updateSelectionUI();
    this.render();
  }

  toggleItemSelection(path, event) {
    if (event) event.stopPropagation();
    if (!path) return;

    if (this.selectedPaths.has(path)) {
      this.selectedPaths.delete(path);
    } else {
      this.selectedPaths.add(path);
    }

    this.updateSelectionUI();
    this.render();
  }

  clearSelection() {
    this.selectedPaths.clear();
    this.updateSelectionUI();
    this.render();
  }

  updateSelectionUI() {
    const visibleItems = this.getFilteredItems();
    const visibleCount = visibleItems.length;
    let selectedCount = 0;
    let selectedSize = 0;

    for (const item of visibleItems) {
      if (item.path && this.selectedPaths.has(item.path)) {
        selectedCount++;
        selectedSize += item.length || 0;
      }
    }

    // Update Master Checkbox State
    if (this.selectAllCheckbox) {
      if (visibleCount > 0 && selectedCount === visibleCount) {
        this.selectAllCheckbox.checked = true;
        this.selectAllCheckbox.indeterminate = false;
        if (this.selectAllText) this.selectAllText.textContent = 'Deselect All';
      } else if (selectedCount > 0) {
        this.selectAllCheckbox.checked = false;
        this.selectAllCheckbox.indeterminate = true;
        if (this.selectAllText) this.selectAllText.textContent = `Selected (${selectedCount})`;
      } else {
        this.selectAllCheckbox.checked = false;
        this.selectAllCheckbox.indeterminate = false;
        if (this.selectAllText) this.selectAllText.textContent = 'Select All';
      }
    }

    // Update Floating Batch Bar
    if (this.batchBar) {
      const hasSelection = this.selectedPaths.size > 0;
      this.batchBar.hidden = !hasSelection;
      if (hasSelection) {
        if (this.batchCount) this.batchCount.textContent = `${this.selectedPaths.size} item${this.selectedPaths.size === 1 ? '' : 's'} selected`;
        if (this.batchSize) this.batchSize.textContent = formatBytes(selectedSize);
        if (this.batchDeleteCount) this.batchDeleteCount.textContent = this.selectedPaths.size;
      }
    }
  }

  openDeleteModal(paths) {
    this.deleteTargetPaths = Array.isArray(paths) ? paths : [paths];
    if (this.deleteTargetPaths.length === 0) return;

    const targets = this.items.filter((i) => this.deleteTargetPaths.includes(i.path));
    const totalSize = targets.reduce((sum, i) => sum + (i.length || 0), 0);
    const count = this.deleteTargetPaths.length;

    if (this.deleteModalCount) {
      this.deleteModalCount.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
    }
    if (this.deleteModalSizePill) {
      this.deleteModalSizePill.textContent = `${formatBytes(totalSize)} will be freed`;
    }

    if (this.deleteModalItemsList) {
      this.deleteModalItemsList.innerHTML = targets
        .map(
          (t) => `
        <div class="delete-item-preview">
          <div class="delete-item-thumb">
            ${
              t.posterUrl
                ? `<img src="${t.posterUrl}" alt="${escapeHtml(t.name)}" />`
                : `<span class="delete-item-category-icon">${t.category === 'video' ? '🎬' : t.category === 'audio' ? '🎵' : '📄'}</span>`
            }
          </div>
          <div class="delete-item-meta">
            <span class="delete-item-title" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
            <span class="delete-item-sub">${escapeHtml(t.path)} • ${formatBytes(t.length || 0)}</span>
          </div>
        </div>
      `
        )
        .join('');
    }

    if (this.deleteModal) this.deleteModal.hidden = false;
  }

  closeDeleteModal() {
    if (this.deleteModal) this.deleteModal.hidden = true;
    this.deleteTargetPaths = [];
  }

  async executeDelete() {
    if (!this.deleteTargetPaths || this.deleteTargetPaths.length === 0) {
      this.closeDeleteModal();
      return;
    }

    const pathsToDelete = [...this.deleteTargetPaths];
    const count = pathsToDelete.length;

    try {
      if (this.btnDeleteConfirm) {
        this.btnDeleteConfirm.disabled = true;
        this.btnDeleteConfirm.textContent = 'Deleting...';
      }

      const res = await api.deleteMedia(pathsToDelete);
      showToast(`Successfully deleted ${res.deletedCount || count} media ${count === 1 ? 'item' : 'items'} (${formatBytes(res.freedBytes || 0)} freed).`, 'success');

      // Remove deleted paths from selection
      for (const p of pathsToDelete) {
        this.selectedPaths.delete(p);
      }

      this.closeDeleteModal();
      await this.load();
    } catch (err) {
      showToast(err.message || 'Failed to delete media.', 'error');
    } finally {
      if (this.btnDeleteConfirm) {
        this.btnDeleteConfirm.disabled = false;
        this.btnDeleteConfirm.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          <span>Delete Permanently</span>
        `;
      }
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

      this.updateSelectionUI();
      this.render();
    } catch (err) {
      console.error('[LibraryView] Load error:', err);
    }
  }

  setSearchQuery(q) {
    this.searchQuery = (q || '').toLowerCase().trim();
    this.updateSelectionUI();
    this.render();
  }

  render() {
    const filtered = this.getFilteredItems();

    if (this.mediaSubtitle) {
      this.mediaSubtitle.textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'} found`;
    }

    if (filtered.length === 0) {
      if (this.grid) this.grid.innerHTML = '';
      if (this.list) this.list.innerHTML = '';
      if (this.emptyState) this.emptyState.hidden = false;
      this.updateSelectionUI();
      return;
    }

    if (this.emptyState) this.emptyState.hidden = true;

    if (this.viewMode === 'grid') {
      this.renderGrid(filtered);
    } else {
      this.renderList(filtered);
    }

    this.updateSelectionUI();
  }

  renderGrid(items) {
    if (!this.grid) return;
    this.grid.hidden = false;
    if (this.list) this.list.hidden = true;

    this.grid.innerHTML = items
      .map((item) => {
        const isSelected = item.path && this.selectedPaths.has(item.path);
        const prog = getMediaProgress(item);
        const progPct = prog ? (prog.percent * 100).toFixed(0) : 0;

        return `
          <article class="poster-card ${isSelected ? 'selected' : ''}" data-id="${item.id}" data-path="${escapeHtml(item.path || '')}" tabindex="0" role="button" aria-label="${escapeHtml(item.name)}">
            <div class="poster-art-wrap">
              <img class="poster-img" src="${item.posterUrl || CONSTANTS.DEFAULT_PLACEHOLDER_POSTER}" alt="${escapeHtml(item.name)}" loading="lazy" />
              ${progPct > 0 ? `<div class="card-progress-track"><div class="card-progress-bar" style="width: ${progPct}%;"></div></div>` : ''}
              
              <!-- Top-Left Select Checkbox -->
              <div class="card-select-overlay" title="Select Item">
                <label class="custom-checkbox-label">
                  <input type="checkbox" class="card-checkbox" data-path="${escapeHtml(item.path || '')}" ${isSelected ? 'checked' : ''} />
                  <span class="custom-checkbox-box"></span>
                </label>
              </div>

              <!-- Top-Right Quick Delete Button -->
              <button class="card-quick-delete-btn" data-path="${escapeHtml(item.path || '')}" title="Delete Media" aria-label="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>

              <!-- Center Play Trigger Overlay -->
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
                <span>${formatBytes(item.length || 0)}</span>
                <span>${item.duration ? formatDuration(item.duration) : ''}</span>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    // Attach Grid Card Events
    this.grid.querySelectorAll('.poster-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        // Prevent play trigger if checkbox or delete button was clicked
        if (e.target.closest('.card-select-overlay') || e.target.closest('.card-quick-delete-btn')) return;
        const id = card.dataset.id;
        const item = this.items.find((i) => i.id === id);
        if (item) this.onPlayItem(item);
      });
    });

    this.grid.querySelectorAll('.card-checkbox').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const path = cb.dataset.path;
        this.toggleItemSelection(path, e);
      });
    });

    this.grid.querySelectorAll('.card-quick-delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = btn.dataset.path;
        if (path) this.openDeleteModal([path]);
      });
    });
  }

  renderList(items) {
    if (!this.list) return;
    this.list.hidden = false;
    if (this.grid) this.grid.hidden = true;

    this.list.innerHTML = `
      <div class="media-list-table">
        <div class="media-list-head">
          <div class="list-col col-check"></div>
          <div class="list-col col-thumb">Media</div>
          <div class="list-col col-title">Title & Path</div>
          <div class="list-col col-cat">Category</div>
          <div class="list-col col-size">Size</div>
          <div class="list-col col-duration">Duration</div>
          <div class="list-col col-actions">Actions</div>
        </div>
        <div class="media-list-body">
          ${items
            .map((item) => {
              const isSelected = item.path && this.selectedPaths.has(item.path);
              const prog = getMediaProgress(item);
              const progPct = prog ? (prog.percent * 100).toFixed(0) : 0;

              return `
                <div class="media-list-row ${isSelected ? 'selected' : ''}" data-id="${item.id}" data-path="${escapeHtml(item.path || '')}">
                  <div class="list-col col-check">
                    <label class="custom-checkbox-label">
                      <input type="checkbox" class="list-row-checkbox" data-path="${escapeHtml(item.path || '')}" ${isSelected ? 'checked' : ''} />
                      <span class="custom-checkbox-box"></span>
                    </label>
                  </div>

                  <div class="list-col col-thumb">
                    <div class="list-thumb-wrap" role="button" title="Play ${escapeHtml(item.name)}">
                      ${
                        item.posterUrl
                          ? `<img class="list-thumb-img" src="${item.posterUrl}" alt="${escapeHtml(item.name)}" loading="lazy" />`
                          : `<div class="list-thumb-fallback">${item.category === 'video' ? '🎬' : item.category === 'audio' ? '🎵' : '📄'}</div>`
                      }
                      <div class="list-thumb-play">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="6 3 20 12 6 21 6 3"></polygon>
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div class="list-col col-title">
                    <div class="list-title-text" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                    <div class="list-path-text" title="${escapeHtml(item.path || '')}">${escapeHtml(item.path || '')}</div>
                    ${progPct > 0 ? `<div class="list-progress-track"><div class="list-progress-bar" style="width: ${progPct}%;"></div></div>` : ''}
                  </div>

                  <div class="list-col col-cat">
                    <span class="category-pill-badge cat-${item.category || 'other'}">${(item.category || 'other').toUpperCase()}</span>
                  </div>

                  <div class="list-col col-size">
                    <span class="list-size-text">${formatBytes(item.length || 0)}</span>
                  </div>

                  <div class="list-col col-duration">
                    <span class="list-duration-text">${item.duration ? formatDuration(item.duration) : '—'}</span>
                  </div>

                  <div class="list-col col-actions">
                    <button class="btn-list-action btn-play-action" data-id="${item.id}" title="Stream / Play Media">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="6 3 20 12 6 21 6 3"></polygon>
                      </svg>
                      <span>Play</span>
                    </button>
                    <button class="btn-list-action btn-delete-action" data-path="${escapeHtml(item.path || '')}" title="Delete Media from Storage">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;

    // Attach List Row Events
    this.list.querySelectorAll('.list-row-checkbox').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const path = cb.dataset.path;
        this.toggleItemSelection(path, e);
      });
    });

    this.list.querySelectorAll('.list-thumb-wrap, .btn-play-action').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = el.closest('.media-list-row');
        const id = row?.dataset.id;
        const item = this.items.find((i) => i.id === id);
        if (item) this.onPlayItem(item);
      });
    });

    this.list.querySelectorAll('.btn-delete-action').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = btn.dataset.path;
        if (path) this.openDeleteModal([path]);
      });
    });
  }
}

export default LibraryView;


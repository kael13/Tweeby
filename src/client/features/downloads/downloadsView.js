'use strict';

import { api } from '../../services/apiService.js';
import { socketService } from '../../services/socketService.js';
import { formatBytes, formatSpeed } from '../../utils/formatters.js';
import { escapeHtml, showToast } from '../../utils/domHelpers.js';

export class DownloadsView {
  constructor(options = {}) {
    this.jobs = new Map(); // hash -> jobData
    this.initElements();
  }

  initElements() {
    this.drawer = document.getElementById('diagnostics-drawer');
    this.backdrop = document.getElementById('drawer-backdrop');
    this.btnToggle = document.getElementById('btn-toggle-diagnostics');
    this.btnClose = document.getElementById('drawer-close');
    this.badge = document.getElementById('active-tasks-badge');
    this.jobsList = document.getElementById('jobs');

    this.magnetPanel = document.getElementById('magnet-panel');
    this.btnToggleAdd = document.getElementById('btn-toggle-add');
    this.magnetPanelClose = document.getElementById('magnet-panel-close');
    this.magnetInput = document.getElementById('magnet');
    this.startBtn = document.getElementById('start');
    this.hintEl = document.getElementById('hint');

    this.attachEvents();
    this.setupSocketListeners();
    this.loadActiveTorrents();
  }

  attachEvents() {
    if (this.btnToggle) this.btnToggle.addEventListener('click', () => this.toggleDrawer());
    if (this.btnClose) this.btnClose.addEventListener('click', () => this.closeDrawer());
    if (this.backdrop) this.backdrop.addEventListener('click', () => this.closeDrawer());

    if (this.btnToggleAdd) {
      this.btnToggleAdd.addEventListener('click', () => {
        if (this.magnetPanel) this.magnetPanel.hidden = !this.magnetPanel.hidden;
      });
    }

    if (this.magnetPanelClose) {
      this.magnetPanelClose.addEventListener('click', () => {
        if (this.magnetPanel) this.magnetPanel.hidden = true;
      });
    }

    if (this.startBtn) {
      this.startBtn.addEventListener('click', () => this.handleAddMagnet());
    }
  }

  async loadActiveTorrents() {
    try {
      const list = await api.getActiveTorrents();
      if (Array.isArray(list)) {
        for (const t of list) {
          if (t.infoHash) {
            const h = t.infoHash.toLowerCase();
            const existing = this.jobs.get(h) || {};
            this.jobs.set(h, { ...existing, ...t, state: t.done ? 'complete' : 'downloading' });
          }
        }
        this.updateBadge();
        this.render();
      }
    } catch (_) {}
  }

  setupSocketListeners() {
    socketService.on('progress', (data) => {
      if (!data || !data.infoHash) return;
      const h = data.infoHash.toLowerCase();
      const existing = this.jobs.get(h) || {};
      this.jobs.set(h, { ...existing, ...data });
      this.updateBadge();
      this.render();
    });

    socketService.on('metadata', (data) => {
      if (!data || !data.infoHash) return;
      const h = data.infoHash.toLowerCase();
      const existing = this.jobs.get(h) || {};
      this.jobs.set(h, { ...existing, name: data.name || existing.name, numFiles: data.numFiles });
      this.render();
    });

    socketService.on('status', (data) => {
      if (!data || !data.infoHash) return;
      const h = data.infoHash.toLowerCase();
      const existing = this.jobs.get(h) || {};
      this.jobs.set(h, { ...existing, state: data.state || 'complete' });
      this.updateBadge();
      this.render();
    });
  }

  toggleDrawer() {
    if (this.drawer) {
      const isHidden = this.drawer.hidden;
      this.drawer.hidden = !isHidden;
      if (this.backdrop) this.backdrop.hidden = !isHidden;
      if (isHidden) this.loadActiveTorrents();
    }
  }

  closeDrawer() {
    if (this.drawer) this.drawer.hidden = true;
    if (this.backdrop) this.backdrop.hidden = true;
  }

  updateBadge() {
    if (!this.badge) return;
    const activeCount = Array.from(this.jobs.values()).filter((j) => j.state === 'downloading').length;
    this.badge.textContent = activeCount;
    this.badge.hidden = activeCount === 0;
  }

  async handleAddMagnet() {
    const magnet = this.magnetInput ? this.magnetInput.value.trim() : '';
    if (!magnet) {
      showToast('Please paste a valid magnet: URI', 'error');
      return;
    }

    const format = document.querySelector('input[name="format"]:checked')?.value || 'zip';

    try {
      showToast('Adding magnet to BitTorrent engine...', 'info');
      const res = await api.postDownload(magnet, format);
      if (res.infoHash) {
        socketService.join(res.infoHash);
        showToast('Torrent added successfully!', 'success');
        if (this.magnetInput) this.magnetInput.value = '';
        if (this.magnetPanel) this.magnetPanel.hidden = true;
      }
    } catch (err) {
      showToast(err.message || 'Failed to start download.', 'error');
    }
  }


  render() {
    if (!this.jobsList) return;
    const items = Array.from(this.jobs.values());
    if (items.length === 0) {
      this.jobsList.innerHTML = '<div class="drawer-empty-state"><p>No active torrent downloads in swarm.</p></div>';
      return;
    }

    this.jobsList.innerHTML = items
      .map(
        (job) => `
      <div class="job-card">
        <div class="job-header">
          <span class="job-title" title="${escapeHtml(job.name)}">${escapeHtml(job.name)}</span>
          <span class="job-status-pill ${job.state}">${job.state}</span>
        </div>
        <div class="job-progress-bar">
          <div class="job-progress-fill" style="width: ${job.progress || 0}%;"></div>
        </div>
        <div class="job-meta">
          <span>⚡ ${formatSpeed(job.downloadSpeed)}</span>
          <span>👥 ${job.numPeers || 0} peers</span>
          <span>📦 ${formatBytes(job.downloaded)} / ${formatBytes(job.length)}</span>
        </div>
      </div>
    `
      )
      .join('');
  }
}

export default DownloadsView;

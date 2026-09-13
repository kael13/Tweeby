'use strict';

/**
 * Tweeby Main Client Application Entry Point
 * Orchestrates domain features, navigation tabs, player stage, and real-time swarm telemetry.
 */

import { socketService } from './services/socketService.js';
import { api } from './services/apiService.js';
import { DiscoverView } from './features/discover/discoverView.js';
import { TmdbModal } from './features/discover/tmdbModal.js';
import { LibraryView } from './features/library/libraryView.js';
import { PlayerView } from './features/player/playerView.js';
import { DownloadsView } from './features/downloads/downloadsView.js';
import { CONSTANTS } from './config/constants.js';
import { showToast } from './utils/domHelpers.js';

class TweebyApp {
  constructor() {
    this.currentView = 'discover';
    this.searchTimeout = null;
    this.init();
  }

  async init() {
    // 1. Initialize WebSocket telemetry service
    socketService.init();

    // 2. Initialize Features
    this.player = new PlayerView();
    this.downloads = new DownloadsView({
      onStreamItem: (job) => {
        this.handleSwarmStream(job);
      },
    });

    this.tmdbModal = new TmdbModal({
      onStreamTorrent: (magnet, name, tmdbMeta) => {
        this.handleStreamAction(magnet, name, tmdbMeta);
      },
    });


    this.discover = new DiscoverView({
      onOpenDetails: (mediaType, id, autoplayTrailer) => {
        this.tmdbModal.open(mediaType, id, autoplayTrailer);
      },
    });

    this.library = new LibraryView({
      onPlayItem: (item) => {
        this.player.open(item);
      },
    });

    // 3. Attach Navigation & Search
    this.attachNavigation();
    this.attachSearch();

    // 4. Initial Fetch
    await this.discover.fetchFeed(1);
    this.library.load();

    console.log('🚀 Tweeby Client App initialized successfully.');
  }

  attachNavigation() {
    const tabDiscover = document.getElementById('tab-discover');
    const tabAvailable = document.getElementById('tab-available');
    const viewDiscover = document.getElementById('view-discover');
    const viewAvailable = document.getElementById('view-available');

    if (tabDiscover && tabAvailable) {
      tabDiscover.addEventListener('click', () => {
        this.currentView = 'discover';
        tabDiscover.classList.add('active');
        tabAvailable.classList.remove('active');
        if (viewDiscover) viewDiscover.hidden = false;
        if (viewAvailable) viewAvailable.hidden = true;
      });

      tabAvailable.addEventListener('click', () => {
        this.currentView = 'available';
        tabAvailable.classList.add('active');
        tabDiscover.classList.remove('active');
        if (viewDiscover) viewDiscover.hidden = true;
        if (viewAvailable) viewAvailable.hidden = false;
        this.library.load();
      });
    }
  }

  attachSearch() {
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value;
        if (searchClear) searchClear.hidden = !q;

        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(async () => {
          if (this.currentView === 'discover') {
            if (q.trim().length >= 2) {
              try {
                const results = await api.searchTmdbCatalog(q);
                this.discover.items = results.results || [];
                this.discover.render();
              } catch (_) {}
            } else if (!q.trim()) {
              this.discover.fetchFeed(1);
            }
          } else {
            this.library.setSearchQuery(q);
          }
        }, CONSTANTS.SEARCH_DEBOUNCE_MS);
      });
    }

    if (searchClear && searchInput) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.hidden = true;
        if (this.currentView === 'discover') this.discover.fetchFeed(1);
        else this.library.setSearchQuery('');
      });
    }
  }

  async handleStreamAction(magnet, name, tmdbMeta) {
    try {
      showToast('Connecting to BitTorrent swarm...', 'info');
      const res = await api.postDownload(magnet);
      if (res.infoHash) {
        socketService.join(res.infoHash);

        // Open Cinema player immediately with provisional info
        this.player.open({
          infoHash: res.infoHash,
          name: res.name || name || 'Streaming Video',
          fileIndex: 0,
          streamUrl: `/api/stream/${res.infoHash}/0`,
          isLocal: false,
          tmdb: tmdbMeta,
        });
      }
    } catch (err) {
      showToast(err.message || 'Failed to start stream.', 'error');
    }
  }

  handleSwarmStream(job) {
    if (!job || !job.infoHash) return;
    socketService.join(job.infoHash);
    showToast(`Streaming ${job.name || 'video'} from active swarm...`, 'info');
    this.player.open({
      infoHash: job.infoHash,
      name: job.name || 'Streaming Video',
      fileIndex: 0,
      streamUrl: `/api/stream/${job.infoHash}/0`,
      isLocal: false,
    });
  }
}

// Bootstrap once DOM content is ready
document.addEventListener('DOMContentLoaded', () => {
  window.__tweebyApp = new TweebyApp();
});

export default TweebyApp;


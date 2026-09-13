'use strict';

import { api } from '../../services/apiService.js';
import { socketService } from '../../services/socketService.js';
import { formatDuration } from '../../utils/formatters.js';
import { showToast } from '../../utils/domHelpers.js';
import { saveMediaProgress } from '../../utils/storage.js';

export class PlayerView {
  constructor(options = {}) {
    this.currentItem = null;
    this.currentSubtitles = [];
    this.activeSubtitleId = 'none';
    this.isTranscodeAac = true;
    this.transcodeStartOffset = 0;
    this.mediaDuration = null;
    this.syncOffset = 0;
    this.controlsTimeout = null;
    this.seekDebounceTimer = null;

    this.initElements();
  }

  getDuration() {
    if (this.mediaDuration && isFinite(this.mediaDuration) && this.mediaDuration > 0) {
      return this.mediaDuration;
    }
    const video = this.getVideoElement();
    if (video && isFinite(video.duration) && video.duration > 180) {
      return video.duration;
    }
    return 5400; // default 90 minutes
  }

  getEffectiveCurrentTime() {
    const video = this.getVideoElement();
    if (!video) return 0;
    if (this.isTranscodeAac) {
      return Math.max(0, this.transcodeStartOffset + (video.currentTime || 0));
    }
    return video.currentTime || 0;
  }

  initElements() {
    this.stage = document.getElementById('video-stage');
    this.stageContainer = this.stage ? this.stage.querySelector('.video-stage-container') : null;
    this.videoScreenWrap = document.getElementById('video-screen-wrap');
    this.titleEl = document.getElementById('video-stage-title');
    this.badgeEl = document.getElementById('video-stage-badge');
    this.btnClose = document.getElementById('btn-video-close');

    this.loader = document.getElementById('video-stream-loader');
    this.vloaderBackdrop = document.getElementById('vloader-backdrop');
    this.vloaderTitle = document.getElementById('vloader-title');
    this.vloaderYear = document.getElementById('vloader-meta-year');
    this.vloaderReleaseName = document.getElementById('vloader-release-name');
    this.vloaderPosterImg = document.getElementById('vloader-poster-img');
    this.vloaderPosterPlaceholder = document.getElementById('vloader-poster-placeholder');
    this.vloaderPeers = document.getElementById('vloader-peers-count');
    this.vloaderSize = document.getElementById('vloader-size-text');
    this.vloaderStatus = document.getElementById('vloader-status-text');
    this.vloaderProgressFill = document.getElementById('vloader-progress-fill');

    this.bufferingHud = document.getElementById('video-buffering-hud');
    this.vbuffTitle = document.getElementById('vbuff-title');
    this.vbuffSub = document.getElementById('vbuff-sub');

    this.progressBar = document.getElementById('video-progress-bar');
    this.bufferBar = document.getElementById('video-buffer-bar');
    this.scrubber = document.getElementById('video-scrubber');
    this.progressWrap = document.getElementById('video-progress-wrap');
    this.curTimeEl = document.getElementById('video-cur-time');
    this.durTimeEl = document.getElementById('video-dur-time');

    this.btnPlay = document.getElementById('btn-video-play');
    this.iconPlay = document.getElementById('icon-vplay');
    this.iconPause = document.getElementById('icon-vpause');
    this.btnRwd = document.getElementById('btn-video-rwd');
    this.btnFwd = document.getElementById('btn-video-fwd');
    this.btnFs = document.getElementById('btn-video-fs');
    this.btnCc = document.getElementById('btn-video-cc');
    this.ccMenu = document.getElementById('video-cc-menu');
    this.ccOptions = document.getElementById('video-cc-options');
    this.volSlider = document.getElementById('video-vol-slider');

    this.attachEvents();
    this.setupSocketListeners();
  }

  attachEvents() {
    if (this.btnClose) this.btnClose.addEventListener('click', () => this.close());
    if (this.btnPlay) this.btnPlay.addEventListener('click', () => this.togglePlay());
    if (this.btnRwd) this.btnRwd.addEventListener('click', () => this.seekDelta(-10));
    if (this.btnFwd) this.btnFwd.addEventListener('click', () => this.seekDelta(10));
    if (this.btnFs) this.btnFs.addEventListener('click', () => this.toggleFullscreen());

    // Fullscreen change listener to sync icons & schedule 1s auto-hide
    document.addEventListener('fullscreenchange', () => {
      this.showControls();
      const isFs = Boolean(document.fullscreenElement);
      if (this.btnFs) {
        this.btnFs.title = isFs ? 'Exit Fullscreen (F)' : 'Fullscreen (F)';
      }
      this.scheduleHideControls();
    });

    // Double-click to toggle fullscreen
    if (this.videoScreenWrap) {
      this.videoScreenWrap.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.toggleFullscreen();
      });
    }

    // PiP Button
    const btnPip = document.getElementById('btn-video-pip');
    if (btnPip) {
      btnPip.addEventListener('click', async () => {
        const v = this.getVideoElement();
        if (!v) return;
        try {
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else if (document.pictureInPictureEnabled && v.requestPictureInPicture) {
            await v.requestPictureInPicture();
          }
        } catch (_) {}
      });
    }

    // Volume Mute Button
    const btnVol = document.getElementById('btn-video-vol');
    const iconVol = document.getElementById('icon-vvol');
    const iconMute = document.getElementById('icon-vmute');
    if (btnVol) {
      btnVol.addEventListener('click', () => {
        const v = this.getVideoElement();
        if (!v) return;
        v.muted = !v.muted;
        if (iconVol) iconVol.hidden = v.muted;
        if (iconMute) iconMute.hidden = !v.muted;
      });
    }

    // Continue in background button
    const btnBg = document.getElementById('btn-vloader-background');
    if (btnBg) {
      btnBg.addEventListener('click', () => {
        this.close(false);
        showToast('Media is downloading in background. Check Swarm drawer.', 'info');
      });
    }

    // Subtitle sync buttons
    const btnSyncMinus = document.getElementById('btn-sub-sync-minus');
    const btnSyncPlus = document.getElementById('btn-sub-sync-plus');
    const syncVal = document.getElementById('sub-sync-val');
    if (btnSyncMinus && btnSyncPlus) {
      btnSyncMinus.addEventListener('click', () => {
        this.syncOffset -= 0.5;
        if (syncVal) syncVal.textContent = `${this.syncOffset > 0 ? '+' : ''}${this.syncOffset.toFixed(1)}s`;
      });
      btnSyncPlus.addEventListener('click', () => {
        this.syncOffset += 0.5;
        if (syncVal) syncVal.textContent = `${this.syncOffset > 0 ? '+' : ''}${this.syncOffset.toFixed(1)}s`;
      });
    }



    if (this.volSlider) {
      this.volSlider.addEventListener('input', () => {
        const v = this.getVideoElement();
        if (v) v.volume = parseFloat(this.volSlider.value);
      });
    }

    if (this.btnCc && this.ccMenu) {
      this.btnCc.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ccMenu.hidden = !this.ccMenu.hidden;
      });
      document.addEventListener('click', (e) => {
        if (!this.ccMenu.contains(e.target) && e.target !== this.btnCc) {
          this.ccMenu.hidden = true;
        }
      });
    }

    if (this.progressWrap) {
      this.progressWrap.addEventListener('click', (e) => {
        const video = this.getVideoElement();
        if (!video) return;
        const totalDur = this.getDuration();
        const rect = this.progressWrap.getBoundingClientRect();
        const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const pct = clickX / rect.width;
        const targetTime = Math.max(0, Math.min(totalDur, pct * totalDur));

        // Instant visual feedback on playhead
        if (this.progressBar) this.progressBar.style.width = `${pct * 100}%`;
        if (this.scrubber) this.scrubber.style.left = `${pct * 100}%`;
        if (this.curTimeEl) this.curTimeEl.textContent = formatDuration(targetTime);
        if (this.durTimeEl) this.durTimeEl.textContent = formatDuration(totalDur);

        if (this.bufferingHud && (!this.loader || this.loader.hidden)) {
          this.bufferingHud.hidden = false;
          if (this.vbuffTitle) this.vbuffTitle.textContent = 'Syncing A/V Swarm...';
          if (this.vbuffSub) this.vbuffSub.textContent = formatDuration(targetTime);
        }

        clearTimeout(this.seekDebounceTimer);
        this.seekDebounceTimer = setTimeout(() => {
          if (this.currentItem && !this.currentItem.isLocal) {
            api.prioritizeSeek(this.currentItem.infoHash, this.currentItem.fileIndex || 0, targetTime, totalDur);
          }
          if (this.isTranscodeAac && this.currentItem && !this.currentItem.isLocal) {
            this.transcodeStartOffset = targetTime;
            const finalIndex = this.currentItem.fileIndex !== undefined ? this.currentItem.fileIndex : 0;
            const newStreamUrl = `/api/stream/${this.currentItem.infoHash}/${finalIndex}?transcode=aac&start=${Math.floor(targetTime)}`;
            video.src = newStreamUrl;
            video.load();
            video.play().catch(() => {});
          } else {
            video.currentTime = targetTime;
          }
        }, 120);
      });
    }

    // Stage Activity Tracking for 1-second idle controls auto-hide
    if (this.stage) {
      this.stage.addEventListener('mousemove', () => this.showControls());
      this.stage.addEventListener('pointerdown', () => this.showControls());
      this.stage.addEventListener('touchstart', () => this.showControls(), { passive: true });
    }

    // Keyboard Shortcuts (Space, F, M, Arrow Keys, Esc)
    window.addEventListener('keydown', (e) => {
      if (!this.stage || this.stage.hidden) return;
      if (['input', 'textarea', 'select'].includes(document.activeElement?.tagName?.toLowerCase())) return;

      this.showControls();

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'KeyF' || e.key === 'f') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.seekDelta(-10);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.seekDelta(10);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  showControls() {
    if (this.stageContainer) {
      this.stageContainer.classList.remove('controls-hidden');
    }
    this.scheduleHideControls();
  }

  hideControls() {
    const video = this.getVideoElement();
    if (video && !video.paused && (!this.loader || this.loader.hidden)) {
      if (this.ccMenu && !this.ccMenu.hidden) return;
      if (this.stageContainer) {
        this.stageContainer.classList.add('controls-hidden');
      }
    }
  }

  scheduleHideControls() {
    clearTimeout(this.controlsTimeout);
    const video = this.getVideoElement();
    if (video && !video.paused && (!this.loader || this.loader.hidden)) {
      this.controlsTimeout = setTimeout(() => {
        this.hideControls();
      }, 1000); // 1-second inactivity timer
    }
  }

  setupSocketListeners() {
    socketService.on('progress', (data) => {
      if (!data || !this.currentItem || this.currentItem.isLocal) return;
      if (data.infoHash && data.infoHash.toLowerCase() === (this.currentItem.infoHash || '').toLowerCase()) {
        if (this.vloaderPeers) {
          this.vloaderPeers.textContent = `${data.numPeers || 0} peers`;
        }
        if (this.vloaderProgressFill && data.progress !== undefined) {
          this.vloaderProgressFill.style.width = `${Math.min(100, Math.max(2, data.progress)).toFixed(1)}%`;
        }
        if (this.vloaderStatus && (!this.loader || !this.loader.hidden)) {
          if (data.numPeers > 0) {
            const speed = data.downloadSpeed > 0 ? ` (${(data.downloadSpeed / (1024 * 1024)).toFixed(1)} MB/s)` : '';
            this.vloaderStatus.textContent = `Streaming from ${data.numPeers} peers${speed}...`;
          }
        }
      }
    });
  }

  getVideoElement() {
    return this.videoScreenWrap ? this.videoScreenWrap.querySelector('video') : null;
  }

  open(item, startTime = 0) {
    this.currentItem = item;
    this.isTranscodeAac = !item.isLocal;
    this.transcodeStartOffset = startTime;
    if (!this.stage) return;
    this.stage.hidden = false;
    document.body.style.overflow = 'hidden';

    // 1. Resolve initial authoritative media duration
    const initialDur = item.duration || (item.tmdb?.runtime ? item.tmdb.runtime * 60 : null) || (item.tmdb?.numberOfSeasons ? 2700 : null) || null;
    this.mediaDuration = initialDur;
    if (this.durTimeEl) {
      this.durTimeEl.textContent = formatDuration(this.getDuration());
    }

    // 2. Fetch authoritative duration asynchronously if not known
    if (!this.mediaDuration) {
      api.getMediaDuration({
        infoHash: item.infoHash,
        fileIndex: item.fileIndex || 0,
        title: item.tmdb?.title || item.name,
        path: item.path,
      }).then((data) => {
        if (data && data.duration && data.duration > 180 && this.currentItem === item) {
          this.mediaDuration = data.duration;
          if (this.durTimeEl) this.durTimeEl.textContent = formatDuration(this.mediaDuration);
        }
      }).catch(() => {});
    }

    // Hide seeking HUD during initial loader
    if (this.bufferingHud) this.bufferingHud.hidden = true;

    if (this.titleEl) this.titleEl.textContent = item.tmdb?.title || item.name || 'Video Player';

    // For local library files, bypass swarm loader and play instantly
    if (item.isLocal) {
      if (this.loader) this.loader.hidden = true;
      this.attachVideoSource(item.streamUrl, item.type || 'video/mp4', startTime);
      return;
    }

    // Show progressive loader for BitTorrent swarm streams
    if (this.loader) {
      this.loader.hidden = false;
      if (this.vloaderTitle) this.vloaderTitle.textContent = item.tmdb?.title || item.name || 'Loading Stream...';
      if (this.vloaderYear) this.vloaderYear.textContent = item.tmdb?.year || '';
      if (this.vloaderReleaseName) {
        this.vloaderReleaseName.textContent = item.name || '';
        this.vloaderReleaseName.hidden = !item.name;
      }
      if (this.vloaderStatus) this.vloaderStatus.textContent = 'Connecting to BitTorrent swarm...';
      if (this.vloaderProgressFill) this.vloaderProgressFill.style.width = '5%';

      const posterUrl = item.tmdb?.posterUrl || item.posterUrl || '';
      const backdropUrl = item.tmdb?.backdropUrl || item.backdropUrl || '';

      if (this.vloaderPosterImg) {
        if (posterUrl) {
          this.vloaderPosterImg.src = posterUrl;
          this.vloaderPosterImg.hidden = false;
          if (this.vloaderPosterPlaceholder) this.vloaderPosterPlaceholder.hidden = true;
          this.vloaderPosterImg.onerror = () => {
            this.vloaderPosterImg.hidden = true;
            if (this.vloaderPosterPlaceholder) this.vloaderPosterPlaceholder.hidden = false;
          };
        } else {
          this.vloaderPosterImg.removeAttribute('src');
          this.vloaderPosterImg.hidden = true;
          if (this.vloaderPosterPlaceholder) this.vloaderPosterPlaceholder.hidden = false;
        }
      }

      if (this.vloaderBackdrop && backdropUrl) {
        this.vloaderBackdrop.style.backgroundImage = `url('${backdropUrl}')`;
      }
    }

    this.resolveAndPlayStream(item, startTime);
  }

  async resolveAndPlayStream(item, startTime = 0) {
    if (item.isLocal) {
      this.attachVideoSource(item.streamUrl, item.type || 'video/mp4', startTime);
      return;
    }

    if (this.vloaderStatus) this.vloaderStatus.textContent = 'Fetching torrent metadata from swarm...';

    // Poll getTorrentFiles until metadata is ready
    let ready = false;
    let fileIndex = item.fileIndex !== undefined ? item.fileIndex : null;
    let mimeType = item.type || 'video/mp4';
    let fileLength = 0;

    const startPollTime = Date.now();
    while (!ready && this.currentItem === item && (Date.now() - startPollTime < 45000)) {
      try {
        const res = await api.getTorrentFiles(item.infoHash);
        if (res && res.ready && Array.isArray(res.files) && res.files.length > 0) {
          ready = true;
          // Find largest video file or largest overall file
          const videoFiles = res.files.filter((f) => (f.type || '').startsWith('video/'));
          const targetFile = videoFiles.length > 0
            ? videoFiles.reduce((max, f) => (f.length > (max?.length || 0) ? f : max), null)
            : res.files.reduce((max, f) => (f.length > (max?.length || 0) ? f : max), null);

          if (targetFile) {
            fileIndex = targetFile.index;
            mimeType = targetFile.type || 'video/mp4';
            fileLength = targetFile.length || 0;
            item.fileIndex = fileIndex;
            item.type = mimeType;
            if (targetFile.duration && targetFile.duration > 180 && !this.mediaDuration) {
              this.mediaDuration = targetFile.duration;
              if (this.durTimeEl) this.durTimeEl.textContent = formatDuration(this.mediaDuration);
            }
            if (targetFile.name && this.titleEl) {
              this.titleEl.textContent = targetFile.name;
            }
            if (this.vloaderSize && fileLength > 0) {
              this.vloaderSize.textContent = `${(fileLength / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            }
          }
          break;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 600));
    }

    if (this.currentItem !== item) return;

    if (this.vloaderStatus) this.vloaderStatus.textContent = 'Prioritizing stream pieces & buffering...';

    const finalIndex = fileIndex !== null ? fileIndex : 0;
    api.prioritizeFile(item.infoHash, finalIndex).catch(() => {});

    let streamUrl = `/api/stream/${item.infoHash}/${finalIndex}`;
    if (this.isTranscodeAac) {
      streamUrl += `?transcode=aac`;
      if (startTime > 0) streamUrl += `&start=${Math.floor(startTime)}`;
    }

    this.attachVideoSource(streamUrl, mimeType, startTime);
  }

  attachVideoSource(streamUrl, mimeType, startTime = 0) {
    this.videoScreenWrap.innerHTML = `
      <video id="cinema-video" playsinline preload="auto" crossorigin="anonymous" src="${streamUrl}">
      </video>
    `;

    const video = this.getVideoElement();
    if (!video) return;

    const updatePlayState = (isPlaying) => {
      if (this.btnPlay) {
        this.btnPlay.classList.toggle('is-playing', isPlaying);
        this.btnPlay.title = isPlaying ? 'Pause (Space)' : 'Play (Space)';
        this.btnPlay.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      }
      if (this.iconPlay) this.iconPlay.hidden = isPlaying;
      if (this.iconPause) this.iconPause.hidden = !isPlaying;
    };

    const updateBufferBar = () => {
      const totalDur = this.getDuration();
      if (!totalDur || !video.buffered || video.buffered.length === 0) return;
      const cur = this.getEffectiveCurrentTime();
      let bufferEnd = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        const start = this.isTranscodeAac ? this.transcodeStartOffset + video.buffered.start(i) : video.buffered.start(i);
        const end = this.isTranscodeAac ? this.transcodeStartOffset + video.buffered.end(i) : video.buffered.end(i);
        if (start <= cur + 0.5 && cur <= end) {
          bufferEnd = end;
          break;
        }
      }
      if (bufferEnd === 0) {
        for (let i = 0; i < video.buffered.length; i++) {
          const end = this.isTranscodeAac ? this.transcodeStartOffset + video.buffered.end(i) : video.buffered.end(i);
          if (end > cur) {
            bufferEnd = Math.max(bufferEnd, end);
          }
        }
      }
      if (this.bufferBar && bufferEnd > 0) {
        const pct = Math.min(100, Math.max(0, (bufferEnd / totalDur) * 100));
        this.bufferBar.style.width = `${pct.toFixed(2)}%`;
      }
    };

    const onMetaDuration = () => {
      if (!this.isTranscodeAac && !this.mediaDuration && video.duration && isFinite(video.duration) && video.duration > 180) {
        this.mediaDuration = video.duration;
      }
      if (this.durTimeEl) {
        this.durTimeEl.textContent = formatDuration(this.getDuration());
      }
      updateBufferBar();
    };

    const onPlayReady = () => {
      if (this.loader) this.loader.hidden = true;
      if (this.bufferingHud) this.bufferingHud.hidden = true;
      updatePlayState(!video.paused);
      updateBufferBar();
    };

    video.addEventListener('loadedmetadata', onMetaDuration);
    video.addEventListener('durationchange', onMetaDuration);
    video.addEventListener('loadeddata', onPlayReady);

    video.addEventListener('playing', () => {
      onPlayReady();
      updatePlayState(true);
      this.showPlayPulse(true);
      this.scheduleHideControls();
    });

    video.addEventListener('canplay', () => {
      onPlayReady();
      const p = video.play();
      if (p !== undefined) {
        p.then(() => onPlayReady()).catch(() => {
          onPlayReady();
          updatePlayState(false);
        });
      }
    });

    video.addEventListener('seeking', () => {
      if (this.bufferingHud && (!this.loader || this.loader.hidden)) {
        this.bufferingHud.hidden = false;
        if (this.vbuffTitle) this.vbuffTitle.textContent = 'Syncing A/V Swarm...';
        if (this.vbuffSub) this.vbuffSub.textContent = formatDuration(this.getEffectiveCurrentTime());
      }
    });

    video.addEventListener('seeked', () => {
      if (this.bufferingHud) this.bufferingHud.hidden = true;
      updateBufferBar();
    });

    video.addEventListener('progress', updateBufferBar);

    video.addEventListener('pause', () => {
      updatePlayState(false);
      this.showPlayPulse(false);
      this.showControls();
      clearTimeout(this.controlsTimeout);
    });

    video.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePlay();
    });

    video.addEventListener('waiting', () => {
      if (this.bufferingHud && (!this.loader || this.loader.hidden)) {
        this.bufferingHud.hidden = false;
        if (this.vbuffTitle) this.vbuffTitle.textContent = 'Buffering Swarm...';
        if (this.vbuffSub) this.vbuffSub.textContent = formatDuration(this.getEffectiveCurrentTime());
      }
    });

    video.addEventListener('timeupdate', () => {
      if (this.loader && !this.loader.hidden) {
        this.loader.hidden = true;
      }
      const totalDur = this.getDuration();
      const curTime = this.getEffectiveCurrentTime();
      const pct = Math.min(100, Math.max(0, (curTime / totalDur) * 100));
      if (this.progressBar) this.progressBar.style.width = `${pct}%`;
      if (this.scrubber) this.scrubber.style.left = `${pct}%`;
      if (this.curTimeEl) this.curTimeEl.textContent = formatDuration(curTime);
      if (this.durTimeEl) this.durTimeEl.textContent = formatDuration(totalDur);

      updateBufferBar();
      saveMediaProgress(this.currentItem, curTime, totalDur);
    });

    video.addEventListener('error', (e) => {
      const err = video.error;
      console.warn('[CinemaVideo] Video element error:', err ? `${err.code} - ${err.message}` : e);
    });

    if (startTime > 0 && !this.isTranscodeAac) {
      video.currentTime = startTime;
    }

    const initPlay = video.play();
    if (initPlay !== undefined) {
      initPlay.then(() => onPlayReady()).catch(() => {
        onPlayReady();
        updatePlayState(false);
      });
    }

    this.loadSubtitles(this.currentItem);
  }

  async loadSubtitles(item) {
    try {
      const params = item.isLocal ? { path: item.path } : { infoHash: item.infoHash, fileIndex: item.fileIndex || 0 };
      const data = await api.getSubtitlesList(params);
      this.currentSubtitles = data.subtitles || [];
      this.renderSubtitleMenu();
    } catch (err) {
      console.warn('[PlayerView] Subtitles error:', err);
    }
  }

  renderSubtitleMenu() {
    if (!this.ccOptions) return;
    this.ccOptions.innerHTML = `
      <div class="cc-option ${this.activeSubtitleId === 'none' ? 'active' : ''}" data-id="none">Off</div>
      ${this.currentSubtitles
        .map(
          (s) =>
            `<div class="cc-option ${this.activeSubtitleId === String(s.id) ? 'active' : ''}" data-id="${s.id}">${s.label} (${s.lang.toUpperCase()})</div>`
        )
        .join('')}
    `;

    this.ccOptions.querySelectorAll('.cc-option').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectSubtitle(el.dataset.id);
        if (this.ccMenu) this.ccMenu.hidden = true;
      });
    });
  }

  selectSubtitle(id) {
    this.activeSubtitleId = id;
    const v = this.getVideoElement();
    if (!v) return;

    v.querySelectorAll('track').forEach((t) => t.remove());

    if (id === 'none') {
      if (this.btnCc) this.btnCc.classList.remove('active');
      this.renderSubtitleMenu();
      return;
    }

    const sub = this.currentSubtitles.find((s) => String(s.id) === String(id));
    if (sub) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = sub.label;
      track.srclang = sub.lang;
      track.src = sub.src;
      track.default = true;
      v.appendChild(track);
      track.track.mode = 'showing';
      if (this.btnCc) this.btnCc.classList.add('active');
    }
    this.renderSubtitleMenu();
  }

  showPlayPulse(isPlaying) {
    if (!this.stage || (this.loader && !this.loader.hidden)) return;
    let pulseEl = document.getElementById('video-play-pulse');
    if (!pulseEl && this.videoScreenWrap) {
      pulseEl = document.createElement('div');
      pulseEl.id = 'video-play-pulse';
      pulseEl.className = 'video-play-pulse';
      this.videoScreenWrap.appendChild(pulseEl);
    }
    if (!pulseEl) return;
    pulseEl.innerHTML = isPlaying
      ? `<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`
      : `<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.5"></rect><rect x="14" y="4" width="4" height="16" rx="1.5"></rect></svg>`;
    pulseEl.classList.remove('pulse-animate');
    void pulseEl.offsetWidth; // trigger CSS reflow
    pulseEl.classList.add('pulse-animate');
  }

  togglePlay() {
    const v = this.getVideoElement();
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  seekDelta(sec) {
    const video = this.getVideoElement();
    if (!video) return;
    const totalDur = this.getDuration();
    const cur = this.getEffectiveCurrentTime();
    const targetTime = Math.max(0, Math.min(totalDur, cur + sec));
    const pct = (targetTime / totalDur) * 100;

    if (this.progressBar) this.progressBar.style.width = `${pct}%`;
    if (this.scrubber) this.scrubber.style.left = `${pct}%`;
    if (this.curTimeEl) this.curTimeEl.textContent = formatDuration(targetTime);
    if (this.durTimeEl) this.durTimeEl.textContent = formatDuration(totalDur);

    if (this.bufferingHud && (!this.loader || this.loader.hidden)) {
      this.bufferingHud.hidden = false;
      if (this.vbuffTitle) this.vbuffTitle.textContent = 'Syncing A/V Swarm...';
      if (this.vbuffSub) this.vbuffSub.textContent = formatDuration(targetTime);
    }

    clearTimeout(this.seekDebounceTimer);
    this.seekDebounceTimer = setTimeout(() => {
      if (this.currentItem && !this.currentItem.isLocal) {
        api.prioritizeSeek(this.currentItem.infoHash, this.currentItem.fileIndex || 0, targetTime, totalDur);
      }
      if (this.isTranscodeAac && this.currentItem && !this.currentItem.isLocal) {
        this.transcodeStartOffset = targetTime;
        const finalIndex = this.currentItem.fileIndex !== undefined ? this.currentItem.fileIndex : 0;
        const newStreamUrl = `/api/stream/${this.currentItem.infoHash}/${finalIndex}?transcode=aac&start=${Math.floor(targetTime)}`;
        video.src = newStreamUrl;
        video.load();
        video.play().catch(() => {});
      } else {
        video.currentTime = targetTime;
      }
    }, 120);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.stage.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  close(closeBackend = true) {
    clearTimeout(this.controlsTimeout);
    clearTimeout(this.seekDebounceTimer);
    if (this.stageContainer) {
      this.stageContainer.classList.remove('controls-hidden');
    }
    const v = this.getVideoElement();
    if (v) {
      v.pause();
      v.src = '';
    }
    if (closeBackend && this.currentItem && !this.currentItem.isLocal) {
      api.closeStream(this.currentItem.infoHash);
    }
    if (this.loader) this.loader.hidden = true;
    if (this.bufferingHud) this.bufferingHud.hidden = true;
    if (this.stage) this.stage.hidden = true;
    document.body.style.overflow = '';
    this.currentItem = null;
    this.mediaDuration = null;
    this.transcodeStartOffset = 0;
  }
}

export default PlayerView;

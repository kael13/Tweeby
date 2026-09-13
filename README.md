# ⚡ Tweeby

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)

> **Self-hosted media streaming & BitTorrent client with a modern cinema UI.**

Stream torrents on-the-fly directly to your browser across your local network (LAN) — no waiting for full downloads.

---

## ✨ Features

- ⚡ **Instant Streaming**: Start watching immediately with dynamic piece prioritization and timeline seeking.
- 🏠 **Local Network (LAN) Ready**: Host on your PC, Mac, NAS, or home server and stream to any device on your Wi-Fi.
- 🎬 **Catalog Discovery**: Browse trending movies and TV series with trailers, cast info, and details powered by TMDB.
- 🔊 **Auto Audio Transcoding**: Real-time conversion of multi-channel audio (DTS, AC3, EAC3) to browser-compatible AAC.
- 💬 **Smart Subtitles**: Automatic extraction of embedded subtitle tracks to WebVTT with offset adjustment.
- 💾 **Local Storage**: Save media directly to host disk (`public/downloads/`) with optional ZIP/RAR archiving.

---

## 🛠️ Technology Stack

### Backend & Media Server
- **Runtime**: [Node.js](https://nodejs.org/) (`>= 20.0.0`, ES Modules)
- **Web Framework**: [Express.js](https://expressjs.com/) (REST routing, static streaming, and HTTP Range request handling)
- **Real-Time Communication**: [Socket.IO](https://socket.io/) (Live peer telemetry, swarm download speeds, and status broadcasting)
- **P2P Torrent Engine**: [WebTorrent](https://webtorrent.io/) (v3+ high-performance BitTorrent streaming & selective piece fetching)
- **Media Transcoding & Probing**: [FFmpeg & FFprobe](https://ffmpeg.org/) (Native child-process pipeline for universal AAC audio remuxing, subtitle conversion to WebVTT, and media duration analysis)
- **Archiving**: [Archiver](https://www.npmjs.com/package/archiver) (ZIP/RAR compression for completed downloads)

### Frontend & UI
- **Core**: Vanilla JavaScript (ES6+ modular architecture — no heavy framework bloat)
- **Styling**: Vanilla CSS (Custom dark glassmorphic cinema design system, GPU-accelerated micro-animations, responsive 10-foot TV & mobile layouts)
- **Player**: Custom HTML5 `<video>` engine with buffer visualization, seeking HUD, subtitle picker, and audio track selectors

### Infrastructure & Deployment
- **Containerization**: [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/) (Pre-bundled with FFmpeg and Node.js)

---

## 🔌 APIs & Services Used

- **[TheMovieDB (TMDB) API](https://developer.themoviedb.org/docs)** (v3 / v4):
  - Trending & popular feeds (all, movies, TV series)
  - Genre taxonomies & filtered discovery
  - Comprehensive media metadata (synopsis, ratings, release dates, runtime)
  - Official YouTube trailers and high-definition backdrop / poster art
- **BitTorrent Release Indexers & Trackers**:
  - Live release aggregation (1337x mirrors & Apibay index)
  - Public BitTorrent Trackers (UDP / HTTP / WebRTC announce network for decentralized peer discovery)
- **Tweeby Internal REST & WebSocket API**:
  - `GET /api/tmdb/*` — Catalog, discovery feeds, genre listings, and trailers
  - `POST /api/download` — Start streaming & downloading magnet link
  - `GET /api/torrents` — List active swarm tasks with peer counts and speed telemetry
  - `POST /api/torrents/remove` — Stop and unregister torrent from swarm
  - `GET /api/files/:infoHash` — Non-blocking file metadata & streamable media index
  - `GET /api/torrent/prioritize-seek` — Dynamic two-tier lookahead piece pre-buffering
  - `GET /api/stream/:infoHash/:fileIndex` — Live HTTP range streaming & AAC remuxing pipeline
  - `GET /api/library` — Local and downloaded media catalog
  - `POST /api/media/delete` — Single and batch media file deletion with disk cleanup
  - `GET /api/subtitles/list` — Extract embedded tracks and format to WebVTT
  - `POST /api/archive` — Compress downloaded media into ZIP/RAR packages
  - `WebSocket Events` — Real-time telemetry (`progress`, `metadata`, `status`, `torrentRemoved`)

---

## 📋 Prerequisites

- **Node.js**: `v20.0.0` or higher
- **FFmpeg & FFprobe**: Required for real-time audio transcoding (AAC) and subtitle extraction
  - **macOS**: `brew install ffmpeg`
  - **Ubuntu / Debian / Raspberry Pi OS**: `sudo apt update && sudo apt install -y ffmpeg`
  - **Fedora / RHEL / CentOS**: `sudo dnf install -y ffmpeg`
  - **Windows**: `winget install Gyan.FFmpeg` *(or download from [ffmpeg.org](https://ffmpeg.org/))*
- *(Alternative)* **Docker & Docker Compose** (bundles FFmpeg, Node.js, and all dependencies automatically — no host installation needed)

---

## 🚀 Quick Start

### Option 1: Native (Node.js & npm)

1. **Install FFmpeg on your host system:**
   ```bash
   # macOS
   brew install ffmpeg

   # Ubuntu / Debian
   sudo apt update && sudo apt install -y ffmpeg

   # Windows (PowerShell)
   winget install Gyan.FFmpeg
   ```
   Verify installation:
   ```bash
   ffmpeg -version && ffprobe -version
   ```

2. **Clone the repository and install npm packages:**
   ```bash
   git clone https://github.com/yourusername/tweeby.git
   cd Tweeby
   npm install
   ```

3. **Configure environment (`.env`):**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and paste your free **TheMovieDB (TMDB)** API Token ([get one here](https://www.themoviedb.org/settings/api)):
   ```env
   TMDB_READ_ACCESS_TOKEN=your_tmdb_bearer_token_here
   ```

4. **Start the server:**
   ```bash
   npm start
   ```
   Open **`http://localhost:3000`** in your browser.

---

### Option 2: Docker Compose (FFmpeg Included Automatically)

Docker automatically downloads and packages FFmpeg inside the container, so you don't need to install FFmpeg on your host machine:

```bash
cp .env.example .env
# Edit .env and add your TMDB_READ_ACCESS_TOKEN

docker compose up -d --build
```
Access the web UI at **`http://localhost:3000`**.

---

### 📖 Full Deployment Guide (Raspberry Pi, Portable Drives, PM2 & Smart TVs)
For complete guides on running Tweeby on **Raspberry Pi**, **external USB/SD card storage**, **PM2 background services**, and **Smart TVs**, see [**`DEPLOYMENT.md`**](DEPLOYMENT.md).

---


## 🌐 Local Network (LAN) Streaming

Tweeby binds to `0.0.0.0:3000` by default. You can open it on your phone, tablet, or smart TV connected to the same Wi-Fi:

```
http://<HOST_IP_ADDRESS>:3000
# Example: http://192.168.1.50:3000
```

> **Note**: Make sure port `3000` is allowed through your host machine's firewall.

---

## ⚙️ Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Server listening port |
| `HOST` | `0.0.0.0` | Bind address (`0.0.0.0` for LAN access) |
| `TMDB_READ_ACCESS_TOKEN` | — | TMDB v4 Bearer Token (recommended) |
| `TMDB_API_KEY` | — | TMDB v3 API Key fallback |
| `DOWNLOAD_DIR` | `./public/downloads` | Path where media files are saved |
| `ARCHIVE_DIR` | `./public/archives` | Path where generated archives are saved |
| `MAX_CONNS` | `200` | Max BitTorrent peer connections |

---

## ⌨️ Player Shortcuts

| Key | Action |
| :---: | :--- |
| <kbd>Space</kbd> / <kbd>K</kbd> | Play / Pause |
| <kbd>F</kbd> | Fullscreen |
| <kbd>M</kbd> | Mute / Unmute |
| <kbd>C</kbd> | Subtitles & Audio tracks |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek -10s / +10s |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Volume Up / Down |
| <kbd>Esc</kbd> | Close player / modal |

---

## ⚖️ Disclaimer

*Tweeby is a peer-to-peer streaming tool using BitTorrent technology. Users are solely responsible for ensuring they only stream content they have the legal right to access.*

---

## 📄 License

Distributed under the [MIT License](LICENSE). See [`LICENSE`](LICENSE) for more information.



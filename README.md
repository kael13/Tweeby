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

## 📋 Prerequisites

- **Node.js**: `v20.0.0` or higher
- **FFmpeg & FFprobe**: Installed and available in your `PATH` (used for audio transcoding & subtitles)
  - **macOS**: `brew install ffmpeg`
  - **Ubuntu/Debian**: `sudo apt update && sudo apt install ffmpeg`
  - **Windows**: Install via `winget install Gyan.FFmpeg` or download from [ffmpeg.org](https://ffmpeg.org/)
- *(Alternative)* **Docker & Docker Compose** (bundles all prerequisites automatically)

---

## 🚀 Quick Start

### Option 1: Native (Node.js)

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/yourusername/tweeby.git
   cd Tweeby
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and paste your free **TheMovieDB (TMDB)** API Token ([get one here](https://www.themoviedb.org/settings/api)):
   ```env
   TMDB_READ_ACCESS_TOKEN=your_tmdb_bearer_token_here
   ```

3. **Start the server:**
   ```bash
   npm start
   ```
   Open **`http://localhost:3000`** in your browser.

---

### Option 2: Docker Compose

```bash
cp .env.example .env
# Edit .env and add your TMDB_READ_ACCESS_TOKEN

docker compose up -d --build
```
Access the web UI at **`http://localhost:3000`**.

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



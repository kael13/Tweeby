# 🚀 Tweeby Deployment Guide

This guide covers deploying **Tweeby** across various environments, with a focus on **Raspberry Pi**, **Home Servers (NAS/Unraid/Synology)**, **Docker**, and **Portable External Storage (SD Cards, USB SSDs/HDDs)**.

---

## 📑 Table of Contents
1. [Deployment Architecture](#-deployment-architecture)
2. [Raspberry Pi Deployment (Portable Storage / SD Card)](#-raspberry-pi-deployment)
   - [Method A: 100% Self-Contained on External Storage (Recommended)](#method-a-100-self-contained-on-external-storage-zero-config)
   - [Method B: Code on OS + Media on Separate Mount](#method-b-code-on-internal-os--media-on-separate-mount)
3. [Docker & Docker Compose Deployment](#-docker--docker-compose-deployment)
4. [Native Node.js + PM2 Deployment (Service Daemon)](#-native-nodejs--pm2-service-deployment)
5. [Connecting Smart TVs & Home Network Devices](#-connecting-smart-tvs--home-network-devices)
6. [Drive Auto-Mounting on Linux (`/etc/fstab`)](#-drive-auto-mounting-on-linux-etcfstab)
7. [Maintenance & Updates](#-maintenance--updates)

---

## 🏗️ Deployment Architecture

Tweeby is architected to be **lightweight, portable, and zero-configuration**:
- **Automatic Path Resolution**: If no custom storage paths are set in `.env`, Tweeby automatically stores downloads in `./public/downloads` and archives in `./public/archives` relative to the repository folder.
- **Port Auto-Adjustment**: If port `3000` is already in use by another service or container, the server automatically finds and binds to the next available port (`3001`, `3002`, ...).
- **Universal AAC Remuxing**: Multi-channel audio (DTS, TrueHD, EAC3) is transcoded on-the-fly to stereo AAC with zero-CPU video copy (`-c:v copy`), making it performant on low-power ARM devices like Raspberry Pi 4 / 5.

---

## 🍓 Raspberry Pi Deployment

### Method A: 100% Self-Contained on External Storage (Zero Config)

Clone the repository directly onto your external storage drive (SD Card, USB SSD, or External Hard Drive). The entire app, database index, and all downloaded movies/shows will stay completely self-contained on that drive.

```bash
# 1. Navigate to your storage mount point
cd /media/pi/YOUR_DRIVE_NAME/   # or /mnt/storage/

# 2. Clone the repository directly onto the drive
git clone https://github.com/yourusername/tweeby.git
cd Tweeby

# 3. Create your environment file
cp .env.example .env
nano .env   # Add your TMDB_READ_ACCESS_TOKEN

# 4. Start with Docker (Recommended)
docker compose up -d --build
```

> **Why this is great**: If you unplug the storage drive and plug it into another Raspberry Pi, Mac, or PC, your entire media library and Tweeby installation are immediately ready to run without reconfiguring paths.

---

### Method B: Code on Internal OS + Media on Separate Mount

If you prefer keeping the codebase on the Pi's internal SD card (`/home/pi/Tweeby`) while storing large video files on an external hard drive:

1. Clone Tweeby to your home directory:
   ```bash
   cd ~
   git clone https://github.com/yourusername/tweeby.git
   cd Tweeby
   cp .env.example .env
   ```

2. Edit `.env` and specify the custom absolute paths:
   ```env
   DOWNLOAD_DIR=/media/pi/ExternalDrive/tweeby_downloads
   ARCHIVE_DIR=/media/pi/ExternalDrive/tweeby_archives
   ```

3. Launch with Docker or Node.js:
   ```bash
   docker compose up -d --build
   ```

---

## 🐳 Docker & Docker Compose Deployment

Docker is the recommended deployment method because it automatically packages **FFmpeg**, **Node.js 20+**, and all system libraries inside an isolated container.

### Step 1: Install Docker on your host (Raspberry Pi OS / Ubuntu / Debian)
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

### Step 2: Configure and Start
```bash
cp .env.example .env
# Set your TMDB_READ_ACCESS_TOKEN in .env

# Build and start container in the background
docker compose up -d --build
```

### Useful Docker Commands:
```bash
# View live streaming and swarm logs
docker compose logs -f

# Check container status
docker compose ps

# Restart container
docker compose restart

# Stop container
docker compose down
```

### Custom Port with Docker:
To run on a different port (e.g. `8080`), either set `PORT=8080` in `.env` or pass it in the CLI:
```bash
PORT=8080 docker compose up -d --build
```

---

## 🟢 Native Node.js + PM2 Service Deployment

If running directly on the host without Docker:

### 1. Install Node.js 20+, FFmpeg, and PM2
```bash
# Install FFmpeg & Node.js
sudo apt update
sudo apt install -y ffmpeg nodejs npm

# Install PM2 process manager globally
sudo npm install -g pm2
```

### 2. Install Project Dependencies
```bash
cd Tweeby
npm install
```

### 3. Start Tweeby with PM2 (Auto-Restart on Boot)
```bash
# Start background process
pm2 start src/server/server.js --name tweeby

# Configure PM2 to automatically restart on system boot
pm2 startup
pm2 save
```

### PM2 Monitoring Commands:
```bash
# View live telemetry logs
pm2 logs tweeby

# Monitor CPU and memory usage
pm2 monit

# Restart / Stop
pm2 restart tweeby
pm2 stop tweeby
```

---

## 📺 Connecting Smart TVs & Home Network Devices

Tweeby listens on `0.0.0.0` to allow any device on your local Wi-Fi / Ethernet to connect:

1. **Find your server's local IP address**:
   ```bash
   hostname -I
   # Example output: 192.168.1.150
   ```

2. **Open the browser on your Smart TV / Phone / Tablet**:
   ```
   http://192.168.1.150:3000
   ```

3. **Smart TV Compatibility**:
   - **LG webOS / Samsung Tizen**: Open the built-in TV browser and bookmark the URL.
   - **Android TV / Google TV / Fire TV**: Open Chrome / Silk browser, or create a home screen shortcut.
   - **Remote Control Navigation**: Use the TV remote D-pad (<kbd>Enter</kbd> to play/pause, <kbd>←</kbd> / <kbd>→</kbd> to seek, <kbd>F</kbd> for fullscreen).

4. **Firewall Rule (if applicable)**:
   If you have a firewall active (UFW), allow port 3000:
   ```bash
   sudo ufw allow 3000/tcp
   ```

---

## 💾 Drive Auto-Mounting on Linux (`/etc/fstab`)

If using an external USB drive on a Raspberry Pi or Linux home server, ensure the drive mounts automatically on reboot:

1. Identify the drive's **UUID** and **Filesystem**:
   ```bash
   sudo blkid
   # Example: /dev/sda1: UUID="a1b2c3d4-e5f6-7890" TYPE="ext4"
   ```

2. Create a permanent mount directory:
   ```bash
   sudo mkdir -p /mnt/storage
   ```

3. Edit `/etc/fstab`:
   ```bash
   sudo nano /etc/fstab
   ```
   Add the following line at the bottom:
   ```
   UUID=a1b2c3d4-e5f6-7890  /mnt/storage  ext4  defaults,noatime,nofail  0  2
   ```
   *(Replace `UUID` and `TYPE` with your drive's values)*.

4. Test mount without rebooting:
   ```bash
   sudo mount -a
   ```

---

## 🔄 Maintenance & Updates

### Updating Tweeby to the Latest Version

#### With Docker:
```bash
cd Tweeby
git pull
docker compose up -d --build
```

#### With PM2 / Native:
```bash
cd Tweeby
git pull
npm install
pm2 restart tweeby
```

---

## 📄 License
Distributed under the [MIT License](LICENSE).

# Multi-arch base image with Node.js 20 (Debian Bookworm slim)
# Fully compatible with Apple Silicon (ARM64), Linux x86_64, and Raspberry Pi 5
FROM node:20-bookworm-slim

# -----------------------------------------------------------------------------
# System Dependencies:
# - FFmpeg & FFprobe: Required for real-time audio remuxing (AAC) & WebVTT subtitles
# - curl & ca-certificates: Used for container healthchecks and secure connections
# -----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package descriptors first to take advantage of Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source files
COPY . .

# Ensure download and archive directories exist
RUN mkdir -p public/downloads public/archives public/downloads/.subtitles_cache

# Expose default HTTP port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/torrents || exit 1

# Start Tweeby server
CMD ["npm", "start"]


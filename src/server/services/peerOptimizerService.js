'use strict';

/**
 * PeerOptimizer
 * ---------------
 * Samples download rate per peer over sliding time windows and disconnects
 * lagging peers so the client favors faster/optimized peers.
 */
export class PeerOptimizer {
  constructor(options = {}) {
    this.sampleMs = options.sampleMs || 1000;      // sampling interval
    this.graceMs = options.graceMs || 8000;        // min time before judging a peer
    this.minRatio = options.minRatio || 0.05;      // peer must sustain >= 5% of top rate
    this.minPeersToPrune = options.minPeersToPrune || 3; // don't prune until we have this many

    // torrentId -> Map<peerId, PeerStats>
    this.stats = new Map();
  }

  /** Initialize tracking for a torrent. */
  attach(torrentId) {
    if (!this.stats.has(torrentId)) {
      this.stats.set(torrentId, new Map());
    }
  }

  /** Remove a torrent's tracking data (e.g. after completion). */
  detach(torrentId) {
    this.stats.delete(torrentId);
  }

  /**
   * Call when a new peer (wire) is connected.
   */
  addPeer(torrentId, wire) {
    const map = this.stats.get(torrentId);
    if (!map) return;
    if (map.has(wire.peerId)) return;
    map.set(wire.peerId, {
      wire,
      startedAt: Date.now(),
      lastDownloaded: wire.downloaded || 0,
      samples: [],           // recent instantaneous rates
      avgRate: 0,
      address: wire.remoteAddress || wire.peerExtendedHandshake?.yourip || 'unknown',
    });
  }

  /** Call when a peer disconnects. */
  removePeer(torrentId, wire) {
    const map = this.stats.get(torrentId);
    if (!map) return;
    map.delete(wire.peerId);
  }

  /**
   * Periodic tick — should be invoked every sampleMs via a timer in the server.
   * Returns an object describing current peer stats (for the UI) and performs
   * pruning of slow peers.
   */
  tick(torrentId) {
    const map = this.stats.get(torrentId);
    if (!map || map.size === 0) {
      return { peers: [] };
    }

    const now = Date.now();
    const snapshot = [];

    for (const [peerId, s] of map) {
      const downloaded = s.wire.downloaded || 0;
      const delta = Math.max(0, downloaded - s.lastDownloaded);
      const dtSec = this.sampleMs / 1000;
      const rate = delta / dtSec; // bytes/sec

      s.lastDownloaded = downloaded;

      // Rolling average: keep last N samples
      s.samples.push(rate);
      if (s.samples.length > 8) s.samples.shift();
      s.avgRate = s.samples.reduce((a, b) => a + b, 0) / s.samples.length;

      snapshot.push({
        peerId, // full id used for pruning lookups
        shortId: peerId.slice(0, 8),
        address: s.address,
        rate: Math.round(rate),
        avgRate: Math.round(s.avgRate),
        downloaded: downloaded,
        age: now - s.startedAt,
      });
    }

    // --- Pruning pass ---
    const matured = snapshot.filter((p) => p.age >= this.graceMs);
    if (matured.length >= this.minPeersToPrune) {
      const maxRate = Math.max(...matured.map((p) => p.avgRate), 1);
      for (const p of matured) {
        // Disconnect peers that are essentially stalling compared to the best.
        if (p.avgRate < this.minRatio * maxRate) {
          const s = map.get(p.peerId);
          if (s) {
            try {
              if (s.wire && typeof s.wire.destroy === 'function') {
                s.wire.destroy();
              }
            } catch (_) {
              /* ignore destroy errors */
            }
          }
        }
      }
    }

    return {
      peers: snapshot.map((p) => ({
        peerId: p.shortId,
        address: p.address,
        rate: p.rate,
        avgRate: p.avgRate,
        downloaded: p.downloaded,
        age: p.age,
      })),
    };
  }

  /** Human-readable summary used in logs / UI. */
  summary(torrentId) {
    const map = this.stats.get(torrentId);
    if (!map) return { active: 0, topRate: 0, avgRate: 0 };
    const peers = [...map.values()].map((s) => s.avgRate);
    const active = peers.length;
    const topRate = active ? Math.round(Math.max(...peers)) : 0;
    const avgRate = active ? Math.round(peers.reduce((a, b) => a + b, 0) / active) : 0;
    return { active, topRate, avgRate };
  }
}

export default PeerOptimizer;

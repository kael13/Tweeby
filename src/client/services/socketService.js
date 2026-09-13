'use strict';

/**
 * Singleton Socket.IO Client Manager.
 */
class SocketService {
  constructor() {
    this.socket = null;
    this.callbacks = new Map();
  }

  init() {
    if (typeof io !== 'undefined' && !this.socket) {
      this.socket = io();

      this.socket.on('progress', (data) => {
        this._dispatch('progress', data);
      });

      this.socket.on('peers', (data) => {
        this._dispatch('peers', data);
      });

      this.socket.on('metadata', (data) => {
        this._dispatch('metadata', data);
      });

      this.socket.on('status', (data) => {
        this._dispatch('status', data);
      });

      this.socket.on('archive', (data) => {
        this._dispatch('archive', data);
      });
    }
    return this.socket;
  }

  join(infoHash) {
    if (this.socket && infoHash) {
      this.socket.emit('join', infoHash.toLowerCase());
    }
  }

  on(event, callback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set());
    }
    this.callbacks.get(event).add(callback);
  }

  off(event, callback) {
    if (this.callbacks.has(event)) {
      this.callbacks.get(event).delete(callback);
    }
  }

  _dispatch(event, data) {
    const listeners = this.callbacks.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[Socket Error: ${event}]`, err);
        }
      }
    }
  }
}

export const socketService = new SocketService();
export default socketService;

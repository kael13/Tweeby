'use strict';

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import archiver from 'archiver';

/**
 * Compress a downloaded folder into a single archive.
 * Supported formats: 'zip' (built-in, always works) and 'rar' (uses the
 * system `rar` binary when available; falls back to zip otherwise).
 */
export class ArchiverService {
  /**
   * @param {string} sourceDir  absolute path to the downloaded folder
   * @param {string} outDir     destination directory
   * @param {string} format     'zip' | 'rar'
   * @returns {Promise<{path:string, format:string}>}
   */
  static async compress(sourceDir, outDir, format = 'zip') {
    fs.mkdirSync(outDir, { recursive: true });
    const baseName = path.basename(sourceDir) || 'download';

    if (format === 'rar') {
      const rar = await ArchiverService._rarAvailable();
      if (rar) {
        return ArchiverService._compressRar(sourceDir, outDir, baseName, rar);
      }
      // Fall back to zip if rar binary is missing.
      format = 'zip';
    }

    return ArchiverService._compressZip(sourceDir, outDir, baseName);
  }

  static _compressZip(sourceDir, outDir, baseName) {
    return new Promise((resolve, reject) => {
      const outPath = path.join(outDir, `${baseName}.zip`);
      const output = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', () => resolve({ path: outPath, format: 'zip' }));
      archive.on('error', reject);
      output.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, baseName);
      archive.finalize();
    });
  }

  static _compressRar(sourceDir, outDir, baseName, rarBin) {
    return new Promise((resolve, reject) => {
      const outPath = path.join(outDir, `${baseName}.rar`);
      // rar a -r -ep1 out.rar sourceDir/*
      const args = ['a', '-r', '-ep1', '-idq', outPath, path.join(sourceDir, '*')];
      execFile(rarBin, args, { timeout: 0 }, (err) => {
        if (err) return reject(err);
        resolve({ path: outPath, format: 'rar' });
      });
    });
  }

  static _rarAvailable() {
    return new Promise((resolve) => {
      execFile('rar', ['-?'], (err) => {
        if (!err) return resolve('rar');
        // Check common macOS Homebrew path for `rar`.
        execFile('/usr/local/bin/rar', ['-?'], (err2) => {
          if (!err2) return resolve('/usr/local/bin/rar');
          execFile('/opt/homebrew/bin/rar', ['-?'], (err3) => {
            if (!err3) return resolve('/opt/homebrew/bin/rar');
            resolve(null);
          });
        });
      });
    });
  }
}

export default ArchiverService;

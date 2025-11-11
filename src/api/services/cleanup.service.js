/**
 * Cleanup Service
 * Handles automatic cleanup of old jobs, temporary files, and disk space management
 */

const fs = require('fs').promises;
const path = require('path');
const storageConfig = require('../../config/storage.config');

class CleanupService {
  constructor() {
    this.cleanupInterval = null;
    this.isRunning = false;

    // Configurable retention periods (in milliseconds)
    this.retentionPolicies = {
      completedJobs: 7 * 24 * 60 * 60 * 1000,      // 7 days
      failedJobs: 3 * 24 * 60 * 60 * 1000,         // 3 days
      tempFiles: 24 * 60 * 60 * 1000,              // 1 day
      testCrawls: 2 * 24 * 60 * 60 * 1000,         // 2 days
      batchJobs: 7 * 24 * 60 * 60 * 1000,          // 7 days
      exports: 1 * 60 * 60 * 1000                  // 1 hour
    };

    // Disk space thresholds
    this.diskSpaceThresholds = {
      warning: 0.80,  // 80% usage
      critical: 0.90  // 90% usage
    };
  }

  /**
   * Start the cleanup scheduler
   * @param {number} intervalMs - Cleanup interval in milliseconds (default: 1 hour)
   */
  start(intervalMs = 60 * 60 * 1000) {
    if (this.isRunning) {
      console.log('[CleanupService] Already running');
      return;
    }

    console.log('[CleanupService] Starting cleanup scheduler (interval: %dms)', intervalMs);
    this.isRunning = true;

    // Run initial cleanup
    this.runCleanup().catch(err => {
      console.error('[CleanupService] Initial cleanup error:', err);
    });

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.runCleanup();
      } catch (error) {
        console.error('[CleanupService] Scheduled cleanup error:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop the cleanup scheduler
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.isRunning = false;
      console.log('[CleanupService] Stopped');
    }
  }

  /**
   * Run all cleanup tasks
   */
  async runCleanup() {
    const startTime = Date.now();
    console.log('[CleanupService] Running cleanup tasks...');

    const results = {
      tempFiles: 0,
      exports: 0,
      testCrawls: 0,
      totalSize: 0,
      errors: []
    };

    try {
      // Clean temporary files
      const tempResult = await this.cleanTempFiles();
      results.tempFiles = tempResult.count;
      results.totalSize += tempResult.size;

      // Clean export files
      const exportResult = await this.cleanExportFiles();
      results.exports = exportResult.count;
      results.totalSize += exportResult.size;

      // Clean old test crawls
      const crawlResult = await this.cleanTestCrawls();
      results.testCrawls = crawlResult.count;

      // Check disk space
      const diskSpace = await this.checkDiskSpace();
      if (diskSpace.percentUsed > this.diskSpaceThresholds.warning) {
        console.warn('[CleanupService] Disk space warning: %d% used',
          Math.round(diskSpace.percentUsed * 100));

        if (diskSpace.percentUsed > this.diskSpaceThresholds.critical) {
          console.error('[CleanupService] CRITICAL: Disk space at %d%!',
            Math.round(diskSpace.percentUsed * 100));
          // Could trigger aggressive cleanup here
        }
      }

      const duration = Date.now() - startTime;
      console.log('[CleanupService] Cleanup complete in %dms:', duration);
      console.log('  - Temp files removed: %d (%s)', results.tempFiles, this.formatBytes(results.totalSize));
      console.log('  - Export files removed: %d', results.exports);
      console.log('  - Test crawls cleaned: %d', results.testCrawls);

    } catch (error) {
      console.error('[CleanupService] Cleanup error:', error);
      results.errors.push(error.message);
    }

    return results;
  }

  /**
   * Clean temporary files older than retention period
   */
  async cleanTempFiles() {
    const tempDir = storageConfig.tempDir;
    const maxAge = this.retentionPolicies.tempFiles;
    let count = 0;
    let totalSize = 0;

    try {
      const files = await fs.readdir(tempDir);
      const now = Date.now();

      for (const file of files) {
        // Skip directories and special files
        if (file.startsWith('.') || file === 'exports' || file === 'test-crawls') {
          continue;
        }

        const filePath = path.join(tempDir, file);

        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            const size = stats.size;

            if (stats.isDirectory()) {
              await this.removeDirectory(filePath);
            } else {
              await fs.unlink(filePath);
            }

            count++;
            totalSize += size;
          }
        } catch (error) {
          console.warn('[CleanupService] Failed to clean temp file %s:', file, error.message);
        }
      }

    } catch (error) {
      console.error('[CleanupService] Failed to read temp directory:', error);
    }

    return { count, size: totalSize };
  }

  /**
   * Clean export files older than retention period
   */
  async cleanExportFiles() {
    const exportsDir = path.join(storageConfig.tempDir, 'exports');
    const maxAge = this.retentionPolicies.exports;
    let count = 0;
    let totalSize = 0;

    try {
      // Create exports directory if it doesn't exist
      await fs.mkdir(exportsDir, { recursive: true });

      const files = await fs.readdir(exportsDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(exportsDir, file);

        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            const size = stats.size;
            await fs.unlink(filePath);
            count++;
            totalSize += size;
          }
        } catch (error) {
          console.warn('[CleanupService] Failed to clean export file %s:', file, error.message);
        }
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[CleanupService] Failed to read exports directory:', error);
      }
    }

    return { count, size: totalSize };
  }

  /**
   * Clean old test crawl data
   */
  async cleanTestCrawls() {
    const crawlsDir = path.join(storageConfig.tempDir, 'test-crawls');
    const maxAge = this.retentionPolicies.testCrawls;
    let count = 0;

    try {
      // Create test-crawls directory if it doesn't exist
      await fs.mkdir(crawlsDir, { recursive: true });

      const files = await fs.readdir(crawlsDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(crawlsDir, file);

        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            await fs.unlink(filePath);
            count++;
          }
        } catch (error) {
          console.warn('[CleanupService] Failed to clean test crawl %s:', file, error.message);
        }
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[CleanupService] Failed to read test-crawls directory:', error);
      }
    }

    return { count };
  }

  /**
   * Check disk space usage
   */
  async checkDiskSpace() {
    try {
      // Use df command on Unix-like systems
      const { execSync } = require('child_process');
      const output = execSync(`df -k "${storageConfig.capturesDir}"`).toString();
      const lines = output.trim().split('\n');

      if (lines.length < 2) {
        throw new Error('Unexpected df output');
      }

      const parts = lines[1].split(/\s+/);
      const total = parseInt(parts[1]) * 1024; // Convert KB to bytes
      const used = parseInt(parts[2]) * 1024;
      const available = parseInt(parts[3]) * 1024;
      const percentUsed = used / total;

      return {
        total,
        used,
        available,
        percentUsed
      };

    } catch (error) {
      console.warn('[CleanupService] Failed to check disk space:', error.message);
      return {
        total: 0,
        used: 0,
        available: 0,
        percentUsed: 0
      };
    }
  }

  /**
   * Get current storage statistics
   */
  async getStorageStats() {
    const stats = {
      tempFiles: await this.getDirectorySize(storageConfig.tempDir),
      captures: await this.getDirectorySize(storageConfig.capturesDir),
      exports: await this.getDirectorySize(path.join(storageConfig.tempDir, 'exports')),
      diskSpace: await this.checkDiskSpace()
    };

    stats.total = stats.tempFiles + stats.captures;

    return stats;
  }

  /**
   * Calculate directory size recursively
   */
  async getDirectorySize(dirPath) {
    let totalSize = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        try {
          if (entry.isDirectory()) {
            totalSize += await this.getDirectorySize(fullPath);
          } else {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          }
        } catch (error) {
          // Skip files we can't read
          console.warn('[CleanupService] Failed to stat %s:', fullPath, error.message);
        }
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[CleanupService] Failed to read directory %s:', dirPath, error.message);
      }
    }

    return totalSize;
  }

  /**
   * Remove directory recursively
   */
  async removeDirectory(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.removeDirectory(fullPath);
        } else {
          await fs.unlink(fullPath);
        }
      }

      await fs.rmdir(dirPath);
    } catch (error) {
      console.warn('[CleanupService] Failed to remove directory %s:', dirPath, error.message);
    }
  }

  /**
   * Format bytes to human-readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Update retention policy
   */
  setRetentionPolicy(type, durationMs) {
    if (this.retentionPolicies.hasOwnProperty(type)) {
      this.retentionPolicies[type] = durationMs;
      console.log('[CleanupService] Updated %s retention to %dms', type, durationMs);
    } else {
      throw new Error(`Unknown retention policy type: ${type}`);
    }
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new CleanupService();
  }
  return instance;
}

module.exports = {
  CleanupService,
  getInstance
};

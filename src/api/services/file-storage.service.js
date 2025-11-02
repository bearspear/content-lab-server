/**
 * File Storage Service
 * Handles file uploads, storage, and cleanup
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const storageConfig = require('../../config/storage.config');
const { sanitizeFilename } = require('../utils/validation');

class FileStorageService {
  constructor() {
    this.config = storageConfig;
    this.initialized = false;
  }

  /**
   * Initialize storage directories
   */
  async init() {
    if (this.initialized) return;

    await this.config.init();
    this.initialized = true;

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Save uploaded EPUB file
   */
  async saveUpload(file) {
    await this.init();

    const fileId = uuidv4();
    const sanitized = sanitizeFilename(file.originalname);
    const filepath = this.config.getUploadPath(fileId, sanitized);

    try {
      // Move file from temp location
      await fs.rename(file.path, filepath);

      return {
        fileId,
        filename: sanitized,
        originalName: file.originalname,
        size: file.size,
        path: filepath,
        uploadedAt: new Date()
      };
    } catch (error) {
      console.error('Error saving upload:', error);
      throw new Error('Failed to save uploaded file');
    }
  }

  /**
   * Get file by ID
   */
  async getFile(fileId) {
    try {
      const files = await fs.readdir(this.config.uploadsDir);
      const file = files.find(f => f.startsWith(fileId));

      if (!file) {
        return null;
      }

      const filepath = path.join(this.config.uploadsDir, file);
      const stats = await fs.stat(filepath);

      return {
        fileId,
        filename: file.substring(fileId.length + 1),
        path: filepath,
        size: stats.size,
        uploadedAt: stats.birthtime
      };
    } catch (error) {
      console.error('Error getting file:', error);
      return null;
    }
  }

  /**
   * Delete file by ID
   */
  async deleteFile(fileId) {
    try {
      const files = await fs.readdir(this.config.uploadsDir);
      const file = files.find(f => f.startsWith(fileId));

      if (file) {
        await fs.unlink(path.join(this.config.uploadsDir, file));
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  /**
   * Save PDF output
   */
  async saveOutput(jobId, filename, buffer) {
    await this.init();

    const sanitized = sanitizeFilename(filename);
    const filepath = this.config.getOutputPath(jobId, sanitized);

    try {
      await fs.writeFile(filepath, buffer);

      return {
        filename: sanitized,
        path: filepath,
        size: buffer.length
      };
    } catch (error) {
      console.error('Error saving output:', error);
      throw new Error('Failed to save PDF output');
    }
  }

  /**
   * Get output file
   */
  async getOutput(jobId) {
    try {
      const files = await fs.readdir(this.config.outputDir);
      const file = files.find(f => f.startsWith(jobId));

      if (!file) {
        return null;
      }

      const filepath = path.join(this.config.outputDir, file);

      return {
        filename: file.substring(jobId.length + 1),
        path: filepath
      };
    } catch (error) {
      console.error('Error getting output:', error);
      return null;
    }
  }

  /**
   * Delete output file
   */
  async deleteOutput(jobId) {
    try {
      const files = await fs.readdir(this.config.outputDir);
      const file = files.find(f => f.startsWith(jobId));

      if (file) {
        await fs.unlink(path.join(this.config.outputDir, file));
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error deleting output:', error);
      return false;
    }
  }

  /**
   * Create extraction directory for EPUB
   */
  async createExtractionDir(fileId) {
    const dirPath = this.config.getExtractedPath(fileId);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  /**
   * Delete extraction directory
   */
  async deleteExtractionDir(fileId) {
    try {
      const dirPath = this.config.getExtractedPath(fileId);
      await fs.rm(dirPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error('Error deleting extraction dir:', error);
      return false;
    }
  }

  /**
   * Cleanup old files
   */
  async cleanupOldFiles() {
    const maxAge = this.config.maxFileAge;
    const now = Date.now();
    let cleaned = 0;

    // Cleanup uploads
    try {
      const uploads = await fs.readdir(this.config.uploadsDir);
      for (const file of uploads) {
        const filepath = path.join(this.config.uploadsDir, file);
        const stats = await fs.stat(filepath);

        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filepath);
          cleaned++;
        }
      }
    } catch (error) {
      console.error('Error cleaning uploads:', error);
    }

    // Cleanup extracted
    try {
      const extracted = await fs.readdir(this.config.extractedDir);
      for (const dir of extracted) {
        const dirPath = path.join(this.config.extractedDir, dir);
        const stats = await fs.stat(dirPath);

        if (now - stats.mtimeMs > maxAge) {
          await fs.rm(dirPath, { recursive: true, force: true });
          cleaned++;
        }
      }
    } catch (error) {
      console.error('Error cleaning extracted:', error);
    }

    // Cleanup outputs
    try {
      const outputs = await fs.readdir(this.config.outputDir);
      for (const file of outputs) {
        const filepath = path.join(this.config.outputDir, file);
        const stats = await fs.stat(filepath);

        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filepath);
          cleaned++;
        }
      }
    } catch (error) {
      console.error('Error cleaning outputs:', error);
    }

    if (cleaned > 0) {
      console.log(`[FileStorage] Cleaned up ${cleaned} old files/directories`);
    }

    return cleaned;
  }

  /**
   * Start automatic cleanup interval
   */
  startCleanupInterval() {
    const interval = this.config.cleanupInterval;

    setInterval(() => {
      this.cleanupOldFiles();
    }, interval);

    // Run initial cleanup
    setTimeout(() => this.cleanupOldFiles(), 5000);
  }

  /**
   * Delete all files for a job
   */
  async deleteJobFiles(jobId, fileId) {
    const promises = [
      this.deleteFile(fileId),
      this.deleteOutput(jobId),
      this.deleteExtractionDir(fileId)
    ];

    await Promise.all(promises);
  }
}

// Export singleton instance
module.exports = new FileStorageService();

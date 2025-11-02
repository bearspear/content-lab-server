/**
 * Storage Configuration
 * Defines paths and settings for file storage
 */

const path = require('path');
const fs = require('fs').promises;

const TEMP_DIR = process.env.TEMP_DIR || './temp';

const config = {
  // Base temp directory
  tempDir: TEMP_DIR,

  // Subdirectories
  uploadsDir: path.join(TEMP_DIR, 'uploads'),
  extractedDir: path.join(TEMP_DIR, 'extracted'),
  outputDir: path.join(TEMP_DIR, 'output'),

  // File size limits
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600'), // 100MB

  // Cleanup settings
  cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL || '3600000'), // 1 hour
  maxFileAge: 24 * 60 * 60 * 1000, // 24 hours

  /**
   * Initialize storage directories
   */
  async init() {
    const dirs = [
      this.tempDir,
      this.uploadsDir,
      this.extractedDir,
      this.outputDir
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create directory ${dir}:`, error);
      }
    }
  },

  /**
   * Get job directory path
   */
  getJobDir(jobId) {
    return path.join(this.tempDir, 'jobs', jobId);
  },

  /**
   * Get upload path for file
   */
  getUploadPath(fileId, filename) {
    return path.join(this.uploadsDir, `${fileId}_${filename}`);
  },

  /**
   * Get extraction path for EPUB
   */
  getExtractedPath(fileId) {
    return path.join(this.extractedDir, fileId);
  },

  /**
   * Get output path for PDF
   */
  getOutputPath(jobId, filename) {
    return path.join(this.outputDir, `${jobId}_${filename}`);
  }
};

module.exports = config;

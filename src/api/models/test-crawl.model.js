/**
 * Test Crawl Model
 *
 * Data structures for test crawl (discovery-only) functionality
 * Allows users to preview pages before capturing them
 */

const crypto = require('crypto');

class TestCrawl {
  constructor(url, options = {}) {
    this.crawlId = `crawl_${crypto.randomBytes(8).toString('hex')}`;
    this.url = url;
    this.status = 'crawling'; // 'crawling' | 'completed' | 'failed'
    this.progress = 0; // 0-100
    this.startTime = new Date();
    this.endTime = null;
    this.options = this.normalizeOptions(options);
    this.discovered = {
      totalPages: 0,
      totalEstimatedSize: '0 B',
      byDepth: {},
      pages: []
    };
    this.error = null;
  }

  /**
   * Normalize and validate crawl options
   */
  normalizeOptions(options) {
    const multiPage = options.multiPage || {};

    return {
      depth: Math.min(Math.max(multiPage.depth || 1, 1), 10),
      maxPages: multiPage.maxPages || 100,
      sameDomainOnly: multiPage.sameDomainOnly !== false,
      timeout: options.timeout || 30000
    };
  }

  /**
   * Add discovered page
   */
  addPage(pageData) {
    this.discovered.pages.push(pageData);
    this.discovered.totalPages = this.discovered.pages.length;

    // Update depth counts
    if (!this.discovered.byDepth[pageData.depth]) {
      this.discovered.byDepth[pageData.depth] = 0;
    }
    this.discovered.byDepth[pageData.depth]++;
  }

  /**
   * Update progress
   */
  updateProgress(percent) {
    this.progress = Math.min(Math.max(percent, 0), 100);
  }

  /**
   * Mark as completed
   */
  complete() {
    this.status = 'completed';
    this.progress = 100;
    this.endTime = new Date();

    // Calculate total estimated size
    const totalBytes = this.discovered.pages.reduce((sum, page) => {
      return sum + (page.estimatedSizeBytes || 0);
    }, 0);
    this.discovered.totalEstimatedSize = this.formatBytes(totalBytes);
  }

  /**
   * Mark as failed
   */
  fail(error) {
    this.status = 'failed';
    this.endTime = new Date();
    this.error = error.message || 'Unknown error';
  }

  /**
   * Format bytes to human-readable size
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get crawl summary (for API response)
   */
  toJSON() {
    return {
      crawlId: this.crawlId,
      url: this.url,
      status: this.status,
      progress: this.progress,
      startTime: this.startTime,
      endTime: this.endTime,
      discovered: this.discovered,
      error: this.error
    };
  }
}

/**
 * Discovered Page Model
 */
class DiscoveredPage {
  constructor(data) {
    this.url = data.url;
    this.title = data.title || 'Untitled';
    this.description = data.description || null;
    this.depth = data.depth || 0;
    this.estimatedSize = data.estimatedSize || '0 KB';
    this.estimatedSizeBytes = data.estimatedSizeBytes || 0;
    this.links = data.links || 0;
    this.images = data.images || 0;
    this.css = data.css || 0;
    this.js = data.js || 0;
    this.fonts = data.fonts || 0;
    this.selected = data.selected !== false; // Default: selected
    this.metadata = {
      contentType: data.metadata?.contentType || 'text/html',
      lastModified: data.metadata?.lastModified || null,
      statusCode: data.metadata?.statusCode || 200
    };
  }

  /**
   * Convert to hierarchical structure with children
   */
  toHierarchical(children = []) {
    return {
      ...this,
      children
    };
  }
}

module.exports = {
  TestCrawl,
  DiscoveredPage
};

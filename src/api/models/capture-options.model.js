/**
 * Capture Options Model
 *
 * Validates and normalizes capture configuration options
 */

class CaptureOptions {
  constructor(options = {}) {
    // Inline styles (merge CSS into HTML)
    this.inlineStyles = options.inlineStyles !== false; // Default: true

    // Include PDF links (attempt to download PDFs)
    this.includePDFs = options.includePDFs || false; // Default: false

    // Page load timeout in milliseconds
    this.timeout = Math.min(
      Math.max(options.timeout || 30000, 5000), // Min: 5s
      120000 // Max: 2 minutes
    );

    // Multi-page capture configuration
    this.multiPage = {
      enabled: options.multiPage?.enabled || false,

      // Crawl depth (1 = linked pages only, 2 = links from links)
      depth: Math.min(
        Math.max(options.multiPage?.depth || 1, 1), // Min: 1
        3 // Max: 3 (prevent excessive crawling)
      ),

      // Maximum pages to capture
      maxPages: Math.min(
        Math.max(options.multiPage?.maxPages || 10, 1), // Min: 1
        100 // Max: 100 (prevent server overload)
      ),

      // Only follow links on same domain
      sameDomainOnly: options.multiPage?.sameDomainOnly !== false // Default: true
    };

    // User agent (for HTTP requests)
    // Use realistic browser UAs instead of bot-identifying default
    const DEFAULT_USER_AGENTS = [
      // Chrome on Windows
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Chrome on macOS
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Firefox on Windows
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      // Safari on macOS
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];

    this.userAgent = options.userAgent ||
      DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)];

    // Custom headers
    this.headers = options.headers || {};

    // Screenshot (capture page screenshot)
    this.includeScreenshot = options.includeScreenshot || false;
  }

  /**
   * Validate options
   */
  validate() {
    const errors = [];

    if (this.timeout < 5000 || this.timeout > 120000) {
      errors.push('Timeout must be between 5000ms and 120000ms');
    }

    if (this.multiPage.enabled) {
      if (this.multiPage.depth < 1 || this.multiPage.depth > 3) {
        errors.push('Multi-page depth must be between 1 and 3');
      }

      if (this.multiPage.maxPages < 1 || this.multiPage.maxPages > 100) {
        errors.push('Multi-page maxPages must be between 1 and 100');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get options summary
   */
  toJSON() {
    return {
      inlineStyles: this.inlineStyles,
      includePDFs: this.includePDFs,
      timeout: this.timeout,
      multiPage: this.multiPage,
      userAgent: this.userAgent,
      includeScreenshot: this.includeScreenshot
    };
  }
}

module.exports = CaptureOptions;

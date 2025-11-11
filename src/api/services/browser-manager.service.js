/**
 * Browser Manager Service
 *
 * Manages a shared Puppeteer browser instance for web capture
 * Lazy initialization - browser is only launched when needed
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerConfig = require('../../config/puppeteer.config');

// Apply stealth plugin to evade bot detection
puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor() {
    this.browser = null;
    this.initializing = false;
  }

  /**
   * Get browser instance (lazy initialization)
   */
  async getBrowser() {
    if (this.browser) {
      return this.browser;
    }

    // Prevent concurrent initialization
    if (this.initializing) {
      // Wait for initialization to complete
      while (this.initializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.browser;
    }

    // Initialize browser
    this.initializing = true;

    try {
      console.log('[BrowserManager] Launching Puppeteer browser for web capture...');

      this.browser = await puppeteer.launch({
        ...puppeteerConfig.launch,
        headless: true, // Use old headless mode (new mode causes WebSocket issues)
        args: [
          ...(puppeteerConfig.launch.args || []),
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // Removed --disable-web-security (too suspicious for bot detection)
          // Resource downloads bypass CORS via server-side Axios anyway
        ]
      });

      console.log('[BrowserManager] Puppeteer browser launched successfully');

      this.initializing = false;
      return this.browser;

    } catch (error) {
      this.initializing = false;
      console.error('[BrowserManager] Failed to launch browser:', error);
      throw new Error('Failed to initialize browser for web capture');
    }
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      console.log('[BrowserManager] Closing Puppeteer browser...');
      await this.browser.close();
      this.browser = null;
      console.log('[BrowserManager] Browser closed');
    }
  }

  /**
   * Check if browser is running
   */
  isRunning() {
    return this.browser !== null;
  }
}

// Export singleton instance
module.exports = new BrowserManager();

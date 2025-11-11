/**
 * Rate Limiter Utility
 *
 * Implements domain-level rate limiting to prevent IP bans and respect server resources
 */

class RateLimiter {
  constructor(options = {}) {
    // Map of domain -> last request timestamp
    this.lastRequestTime = new Map();

    // Minimum delay between requests to same domain (default 1 second)
    this.minDelay = options.minDelay || 1000;

    // Whether rate limiting is enabled
    this.enabled = options.enabled !== false; // Default: true
  }

  /**
   * Wait for rate limit before making request to domain
   * @param {string} url - Full URL to extract domain from
   * @returns {Promise<void>}
   */
  async waitForDomain(url) {
    if (!this.enabled) {
      return;
    }

    try {
      const domain = new URL(url).hostname;
      const now = Date.now();
      const lastRequest = this.lastRequestTime.get(domain) || 0;
      const timeSinceLastRequest = now - lastRequest;

      if (timeSinceLastRequest < this.minDelay) {
        const delay = this.minDelay - timeSinceLastRequest;
        console.log(`[RateLimiter] Waiting ${delay}ms for ${domain}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Update last request time for this domain
      this.lastRequestTime.set(domain, Date.now());
    } catch (error) {
      console.warn('[RateLimiter] Invalid URL, skipping rate limit:', url);
    }
  }

  /**
   * Handle Retry-After header from 429 responses
   * @param {string|number} retryAfterHeader - Value from Retry-After header
   * @returns {Promise<void>}
   */
  async handleRetryAfter(retryAfterHeader) {
    if (!retryAfterHeader) {
      return;
    }

    // Retry-After can be in seconds (number) or HTTP date string
    let delay;

    if (!isNaN(retryAfterHeader)) {
      // Number of seconds
      delay = parseInt(retryAfterHeader) * 1000;
    } else {
      // HTTP date string - calculate difference from now
      try {
        const retryDate = new Date(retryAfterHeader);
        delay = retryDate.getTime() - Date.now();
        if (delay < 0) delay = 0; // Don't wait if date is in the past
      } catch (e) {
        console.warn('[RateLimiter] Invalid Retry-After date:', retryAfterHeader);
        delay = 60000; // Default 60 seconds
      }
    }

    // Cap maximum wait time at 5 minutes
    delay = Math.min(delay, 300000);

    console.log(`[RateLimiter] Retry-After header detected, waiting ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Reset rate limiter state (clear all tracked domains)
   */
  reset() {
    this.lastRequestTime.clear();
    console.log('[RateLimiter] Reset - cleared all domain tracking');
  }

  /**
   * Get statistics about rate limiting
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      domainsTracked: this.lastRequestTime.size,
      enabled: this.enabled,
      minDelay: this.minDelay
    };
  }
}

module.exports = RateLimiter;

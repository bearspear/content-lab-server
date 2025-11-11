/**
 * Resource Downloader Utility
 *
 * Downloads web resources (images, CSS, JS, fonts, PDFs) to local storage
 * No CORS restrictions since running server-side!
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const RateLimiter = require('./rate-limiter');

class ResourceDownloader {
  constructor(tempDir, baseUrl = null) {
    this.tempDir = tempDir;
    this.baseUrl = baseUrl; // Base URL for resolving relative URLs
    this.downloadedResources = new Map(); // URL -> local path
    this.rateLimiter = new RateLimiter({ minDelay: 1000 }); // 1 second between requests to same domain
  }

  /**
   * Download a resource from URL
   */
  async downloadResource(url, subfolder = 'resources') {
    try {
      // Normalize protocol-relative URLs
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }

      // Resolve relative URLs using base URL
      if (url.startsWith('/') && this.baseUrl) {
        try {
          const baseUrlObj = new URL(this.baseUrl);
          url = new URL(url, baseUrlObj.origin).href;
          console.log(`[ResourceDownloader] Resolved relative URL to: ${url}`);
        } catch (e) {
          console.warn(`[ResourceDownloader] Failed to resolve relative URL: ${url}`, e.message);
          throw new Error(`Cannot resolve relative URL without valid base URL: ${url}`);
        }
      } else if (url.startsWith('/')) {
        // No base URL available, cannot download
        console.warn(`[ResourceDownloader] Skipping relative URL (no base URL): ${url}`);
        throw new Error(`Cannot download relative URL without base URL: ${url}`);
      }

      // Check if already downloaded
      if (this.downloadedResources.has(url)) {
        return this.downloadedResources.get(url);
      }

      console.log(`[ResourceDownloader] Downloading: ${url}`);

      // Apply rate limiting before request
      await this.rateLimiter.waitForDomain(url);

      // Make request
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ContentLabWebCapture/1.0)'
        },
        maxRedirects: 5
      });

      // Generate local filename
      const filename = this.generateFilename(url, response.headers['content-type']);
      const localPath = path.join(this.tempDir, subfolder, filename);

      // Ensure directory exists
      await fs.mkdir(path.dirname(localPath), { recursive: true });

      // Write file
      await fs.writeFile(localPath, response.data);

      // Store mapping
      this.downloadedResources.set(url, localPath);

      console.log(`[ResourceDownloader] Downloaded to: ${localPath}`);

      return {
        url,
        localPath,
        filename,
        size: response.data.length,
        contentType: response.headers['content-type']
      };

    } catch (error) {
      // Handle 429 Too Many Requests with Retry-After header
      if (error.response && error.response.status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        console.warn(`[ResourceDownloader] Rate limited (429) for ${url}, Retry-After: ${retryAfter}`);

        if (retryAfter) {
          await this.rateLimiter.handleRetryAfter(retryAfter);
          // Retry the download once after waiting
          try {
            return await this.downloadResource(url, subfolder);
          } catch (retryError) {
            console.warn(`[ResourceDownloader] Retry failed for ${url}:`, retryError.message);
            throw retryError;
          }
        }
      }

      console.warn(`[ResourceDownloader] Failed to download ${url}:`, error.message);
      throw error;
    }
  }

  /**
   * Download multiple resources in parallel
   */
  async downloadResources(urls, subfolder = 'resources', maxConcurrent = 5) {
    const results = {
      succeeded: [],
      failed: []
    };

    // Process in batches
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);

      const promises = batch.map(url =>
        this.downloadResource(url, subfolder)
          .then(result => {
            results.succeeded.push(result);
            return { success: true, url, result };
          })
          .catch(error => {
            results.failed.push({ url, error: error.message });
            return { success: false, url, error };
          })
      );

      await Promise.all(promises);
    }

    return results;
  }

  /**
   * Generate a safe filename from URL
   */
  generateFilename(url, contentType) {
    try {
      const urlObj = new URL(url);
      let filename = path.basename(urlObj.pathname);

      // Remove hash but check if there's a query string
      const hasQueryString = urlObj.search && urlObj.search.length > 1;
      filename = filename.split('#')[0];

      // If filename is generic (like load.php) and has query string, use hash to make it unique
      const genericFilenames = ['load.php', 'index.php', 'api.php', 'script.php'];
      if (hasQueryString && genericFilenames.includes(filename.toLowerCase())) {
        const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
        // Use MIME type for extension, not the URL extension
        const ext = this.getExtensionFromContentType(contentType) || path.extname(filename);
        const baseName = path.basename(filename, path.extname(filename));
        filename = `${baseName}_${hash}${ext}`;
      } else {
        // Remove query string for normal files
        filename = filename.split('?')[0];
      }

      // If no filename or extension, generate one
      if (!filename || !filename.includes('.')) {
        const ext = this.getExtensionFromContentType(contentType);
        const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
        filename = `resource_${hash}${ext}`;
      }

      // Sanitize filename
      filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

      // Limit length
      if (filename.length > 100) {
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
        filename = name.substring(0, 100 - ext.length) + ext;
      }

      return filename;

    } catch (error) {
      // Fallback: hash-based filename
      const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
      const ext = this.getExtensionFromContentType(contentType);
      return `resource_${hash}${ext}`;
    }
  }

  /**
   * Get file extension from content type
   */
  getExtensionFromContentType(contentType) {
    if (!contentType) return '';

    const mimeMap = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'image/webp': '.webp',
      'text/css': '.css',
      'application/javascript': '.js',
      'text/javascript': '.js',
      'application/pdf': '.pdf',
      'font/woff': '.woff',
      'font/woff2': '.woff2',
      'font/ttf': '.ttf',
      'font/otf': '.otf',
      'application/font-woff': '.woff',
      'application/font-woff2': '.woff2'
    };

    const type = contentType.split(';')[0].trim().toLowerCase();
    return mimeMap[type] || '';
  }

  /**
   * Download resource with retry
   */
  async downloadResourceWithRetry(url, subfolder = 'resources', maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.downloadResource(url, subfolder);
      } catch (error) {
        lastError = error;
        console.warn(`[ResourceDownloader] Attempt ${attempt}/${maxRetries} failed for ${url}`);

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * Get downloaded resource path
   */
  getResourcePath(url) {
    return this.downloadedResources.get(url);
  }

  /**
   * Clear downloaded resources
   */
  clear() {
    this.downloadedResources.clear();
  }

  /**
   * Get download statistics
   */
  getStats() {
    return {
      total: this.downloadedResources.size,
      urls: Array.from(this.downloadedResources.keys())
    };
  }
}

module.exports = ResourceDownloader;

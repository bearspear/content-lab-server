/**
 * Test Crawl Service
 *
 * Discovery-only web crawling service
 * Fetches pages and extracts metadata WITHOUT downloading resources
 * Allows users to preview and curate pages before full capture
 */

const { TestCrawl, DiscoveredPage } = require('../models/test-crawl.model');
const browserManager = require('./browser-manager.service');

class TestCrawlService {
  constructor() {
    this.activeCrawls = new Map(); // crawlId -> TestCrawl instance
    this.browserManager = browserManager;
  }

  /**
   * Start a test crawl (discovery-only)
   */
  async startTestCrawl(url, options = {}) {
    const testCrawl = new TestCrawl(url, options);
    this.activeCrawls.set(testCrawl.crawlId, testCrawl);

    console.log(`[TestCrawlService] Starting test crawl ${testCrawl.crawlId} for ${url}`);
    console.log(`[TestCrawlService] Options:`, testCrawl.options);

    // Run crawl in background (don't await)
    this.executeCrawl(testCrawl).catch(error => {
      console.error(`[TestCrawlService] Crawl ${testCrawl.crawlId} failed:`, error);
      testCrawl.fail(error);
    });

    return testCrawl.toJSON();
  }

  /**
   * Execute the crawl using BFS algorithm
   */
  async executeCrawl(testCrawl) {
    let browser = null;

    try {
      // Initialize browser
      browser = await this.browserManager.getBrowser();

      // BFS queue: [url, depth, parentUrl]
      const queue = [[testCrawl.url, 0, null]];
      const visited = new Set();
      const discoveredPages = [];

      // Parse base domain for same-domain checks
      const baseDomain = new URL(testCrawl.url).hostname;

      while (queue.length > 0 && discoveredPages.length < testCrawl.options.maxPages) {
        const [currentUrl, depth, parentUrl] = queue.shift();

        // Skip if already visited
        if (visited.has(currentUrl)) {
          continue;
        }

        // Skip if depth exceeds limit
        if (depth > testCrawl.options.depth) {
          continue;
        }

        // Skip if different domain and sameDomainOnly is true
        if (testCrawl.options.sameDomainOnly) {
          try {
            const currentDomain = new URL(currentUrl).hostname;
            if (currentDomain !== baseDomain) {
              console.log(`[TestCrawlService] Skipping different domain: ${currentUrl}`);
              continue;
            }
          } catch (e) {
            console.warn(`[TestCrawlService] Invalid URL, skipping: ${currentUrl}`);
            continue;
          }
        }

        visited.add(currentUrl);

        console.log(`[TestCrawlService] Discovering page (depth ${depth}): ${currentUrl}`);

        // Discover page metadata
        try {
          const pageData = await this.discoverPage(browser, currentUrl, depth);
          discoveredPages.push(pageData);
          testCrawl.addPage(pageData);

          // Update progress
          const progress = Math.min(
            (discoveredPages.length / testCrawl.options.maxPages) * 100,
            100
          );
          testCrawl.updateProgress(progress);

          // Add discovered links to queue for next depth level
          if (depth < testCrawl.options.depth && pageData.links > 0) {
            const links = pageData.discoveredLinks || [];
            for (const link of links) {
              if (!visited.has(link) && discoveredPages.length < testCrawl.options.maxPages) {
                queue.push([link, depth + 1, currentUrl]);
              }
            }
          }

        } catch (error) {
          console.warn(`[TestCrawlService] Failed to discover ${currentUrl}:`, error.message);
          // Continue with next URL instead of failing entire crawl
          continue;
        }
      }

      // Mark as completed
      testCrawl.complete();
      console.log(`[TestCrawlService] Crawl ${testCrawl.crawlId} completed. Discovered ${discoveredPages.length} pages.`);

    } catch (error) {
      console.error(`[TestCrawlService] Crawl execution failed:`, error);
      testCrawl.fail(error);
      throw error;
    }
  }

  /**
   * Discover a single page's metadata (without downloading resources)
   */
  async discoverPage(browser, url, depth) {
    const page = await browser.newPage();

    try {
      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Abort resource downloads to speed up discovery
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        // Only allow document and script (need JS for SPAs), abort everything else
        if (['document', 'script'].includes(resourceType)) {
          request.continue();
        } else {
          request.abort();
        }
      });

      // Navigate to page
      await page.goto(url, {
        waitUntil: ['domcontentloaded', 'networkidle2'],
        timeout: 30000
      });

      // Extract metadata
      const metadata = await page.evaluate(() => {
        // Get title
        const title = document.title || document.querySelector('h1')?.textContent || 'Untitled';

        // Get description
        const metaDesc = document.querySelector('meta[name="description"]');
        const description = metaDesc ? metaDesc.getAttribute('content') : null;

        // Count resources
        const images = document.querySelectorAll('img').length;
        const css = document.querySelectorAll('link[rel="stylesheet"]').length;
        const js = document.querySelectorAll('script[src]').length;
        const fonts = document.querySelectorAll('link[rel="preload"][as="font"]').length +
                      document.querySelectorAll('style, link[rel="stylesheet"]').length; // Estimate

        // Get all links
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => {
            try {
              const href = a.getAttribute('href');
              if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
                return null;
              }
              // Resolve relative URLs
              return new URL(href, window.location.href).href;
            } catch (e) {
              return null;
            }
          })
          .filter(link => link !== null);

        // Estimate page size (rough approximation)
        const htmlSize = document.documentElement.outerHTML.length;
        const estimatedSizeBytes = htmlSize +
          (images * 50000) + // Avg 50KB per image
          (css * 20000) +     // Avg 20KB per CSS file
          (js * 30000) +      // Avg 30KB per JS file
          (fonts * 15000);    // Avg 15KB per font

        // Get status code and content type from meta
        const contentType = document.contentType || 'text/html';

        return {
          title: title.trim().substring(0, 200),
          description: description ? description.trim().substring(0, 300) : null,
          links: links.length,
          discoveredLinks: links.slice(0, 100), // Limit to first 100 links
          images,
          css,
          js,
          fonts,
          estimatedSizeBytes,
          metadata: {
            contentType,
            statusCode: 200 // Assume 200 if we got here
          }
        };
      });

      // Format estimated size
      const estimatedSize = this.formatBytes(metadata.estimatedSizeBytes);

      // Create discovered page
      const discoveredPage = new DiscoveredPage({
        url,
        title: metadata.title,
        description: metadata.description,
        depth,
        estimatedSize,
        estimatedSizeBytes: metadata.estimatedSizeBytes,
        links: metadata.links,
        images: metadata.images,
        css: metadata.css,
        js: metadata.js,
        fonts: metadata.fonts,
        selected: true,
        metadata: metadata.metadata
      });

      // Store discovered links for BFS (not part of DiscoveredPage model)
      discoveredPage.discoveredLinks = metadata.discoveredLinks;

      return discoveredPage;

    } finally {
      await page.close();
    }
  }

  /**
   * Get test crawl status
   */
  getCrawlStatus(crawlId) {
    const testCrawl = this.activeCrawls.get(crawlId);
    if (!testCrawl) {
      throw new Error(`Test crawl ${crawlId} not found`);
    }
    return testCrawl.toJSON();
  }

  /**
   * Get discovered pages in hierarchical structure
   */
  getDiscoveredPagesHierarchical(crawlId) {
    const testCrawl = this.activeCrawls.get(crawlId);
    if (!testCrawl) {
      throw new Error(`Test crawl ${crawlId} not found`);
    }

    const pages = testCrawl.discovered.pages;

    // Build parent-child relationships
    const pagesByUrl = new Map();
    pages.forEach(page => pagesByUrl.set(page.url, { ...page, children: [] }));

    // Organize by depth
    const root = [];
    pages.forEach(page => {
      const pageNode = pagesByUrl.get(page.url);
      if (page.depth === 0) {
        root.push(pageNode);
      }
    });

    // For now, return flat list grouped by depth
    // TODO: Build true hierarchical tree based on parent-child links
    return {
      crawlId,
      status: testCrawl.status,
      tree: root,
      byDepth: testCrawl.discovered.byDepth,
      totalPages: testCrawl.discovered.totalPages,
      totalEstimatedSize: testCrawl.discovered.totalEstimatedSize
    };
  }

  /**
   * Cancel a running test crawl
   */
  cancelCrawl(crawlId) {
    const testCrawl = this.activeCrawls.get(crawlId);
    if (!testCrawl) {
      throw new Error(`Test crawl ${crawlId} not found`);
    }

    if (testCrawl.status === 'crawling') {
      testCrawl.fail(new Error('Cancelled by user'));
      console.log(`[TestCrawlService] Crawl ${crawlId} cancelled`);
    }

    return testCrawl.toJSON();
  }

  /**
   * Clean up old crawls
   */
  cleanup(maxAge = 3600000) { // Default: 1 hour
    const now = Date.now();
    const toDelete = [];

    for (const [crawlId, testCrawl] of this.activeCrawls.entries()) {
      const age = now - testCrawl.startTime.getTime();
      if (age > maxAge && testCrawl.status !== 'crawling') {
        toDelete.push(crawlId);
      }
    }

    toDelete.forEach(crawlId => {
      this.activeCrawls.delete(crawlId);
      console.log(`[TestCrawlService] Cleaned up old crawl: ${crawlId}`);
    });

    return { cleaned: toDelete.length };
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
}

// Singleton instance
let instance = null;

module.exports = {
  getInstance: () => {
    if (!instance) {
      instance = new TestCrawlService();
    }
    return instance;
  },
  TestCrawlService
};

/**
 * Multi-Page Crawler Service
 *
 * Crawls multiple pages using BFS algorithm with parallel processing
 * Ported from Chrome extension background.js with improvements
 */

const ContentDetector = require('../utils/content-detector');

class MultiPageCrawlerService {
  constructor(browser, resourceExtractor) {
    this.browser = browser;
    this.resourceExtractor = resourceExtractor;
    this.maxConcurrent = 3; // Process up to 3 pages in parallel
  }

  /**
   * Crawl multiple pages using BFS algorithm
   * Returns array of captured pages with resources
   */
  async crawl(startUrl, options, job) {
    const { depth, maxPages, sameDomainOnly } = options.multiPage;
    const startDomain = new URL(startUrl).hostname;

    console.log(`[MultiPageCrawler] Starting crawl:
      - Start URL: ${startUrl}
      - Max depth: ${depth}
      - Max pages: ${maxPages}
      - Same domain only: ${sameDomainOnly}`);

    const pageQueue = [{ url: startUrl, depth: 0, parent: null }];
    const visited = new Set();
    const pages = [];
    const active = new Set(); // Track active page captures

    while (pageQueue.length > 0 && pages.length < maxPages) {
      // Process up to maxConcurrent pages in parallel
      const batch = [];

      while (
        batch.length < this.maxConcurrent &&
        pageQueue.length > 0 &&
        pages.length + active.size + batch.length < maxPages
      ) {
        const current = pageQueue.shift();

        // Skip if already visited
        if (visited.has(current.url)) continue;

        visited.add(current.url);
        active.add(current.url);

        // Capture page in parallel
        batch.push(
          this.capturePage(current, startUrl, sameDomainOnly, depth, pageQueue, options)
        );
      }

      if (batch.length === 0) break;

      // Wait for batch to complete
      const results = await Promise.allSettled(batch);

      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          const pageData = result.value;
          active.delete(pageData.url);

          if (pageData.success) {
            pages.push(pageData);

            // Update job progress
            if (job) {
              job.stats.pagesProcessed = pages.length;
              job.stats.totalPages = Math.min(maxPages, pages.length + pageQueue.length);
              job.updateProgress(
                `Processing pages (${pages.length}/${maxPages})`,
                (pages.length / maxPages) * 50 // First 50% is page capture
              );
            }

            console.log(`[MultiPageCrawler] Captured page ${pages.length}/${maxPages}: ${pageData.url}`);
          }
        } else if (result.status === 'rejected') {
          console.error(`[MultiPageCrawler] Page capture rejected:`, result.reason);
        }
      });
    }

    console.log(`[MultiPageCrawler] Crawl complete. Captured ${pages.length} pages.`);

    return pages;
  }

  /**
   * Capture a single page and extract links
   */
  async capturePage(pageInfo, startUrl, sameDomainOnly, maxDepth, queue, options) {
    const { url, depth } = pageInfo;
    let page;

    try {
      page = await this.browser.newPage();

      // Set user agent if provided
      if (options.userAgent) {
        await page.setUserAgent(options.userAgent);
      }

      // Navigate with timeout
      console.log(`[MultiPageCrawler] Navigating to: ${url} (depth: ${depth})`);

      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: options.timeout || 30000
      });

      // Extract resources
      const resources = await this.resourceExtractor.extract(page, url);

      // Extract page title
      const title = await page.title();

      // Extract links if not at max depth
      let links = [];
      if (depth < maxDepth) {
        links = await this.extractContentLinks(page, sameDomainOnly, url, startUrl);

        // Add links to queue
        links.forEach(link => {
          queue.push({ url: link, depth: depth + 1, parent: url });
        });

        console.log(`[MultiPageCrawler] Found ${links.length} links at depth ${depth}`);
      }

      // Get HTML content
      const html = await page.content();

      return {
        url,
        depth,
        title,
        html,
        resources,
        links,
        success: true
      };

    } catch (error) {
      console.error(`[MultiPageCrawler] Failed to capture ${url}:`, error.message);

      return {
        url,
        depth,
        error: error.message,
        success: false
      };

    } finally {
      // Always close page
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Extract links from content areas (exclude navigation)
   * Ported from extension content.js
   */
  async extractContentLinks(page, sameDomainOnly, pageUrl, startUrl) {
    try {
      // Execute link extraction in page context
      const result = await page.evaluate(
        ContentDetector.getExtractLinksScript(),
        ContentDetector.CONTENT_SELECTORS,
        ContentDetector.EXCLUDE_SELECTORS
      );

      let links = result.links;

      // Filter by domain if needed
      if (sameDomainOnly) {
        const startDomain = new URL(startUrl).hostname;
        links = ContentDetector.filterLinksByDomain(links, startDomain);
      }

      // Deduplicate links
      links = ContentDetector.deduplicateLinks(links);

      return links;

    } catch (error) {
      console.error(`[MultiPageCrawler] Failed to extract links from ${pageUrl}:`, error.message);
      return [];
    }
  }
}

module.exports = MultiPageCrawlerService;

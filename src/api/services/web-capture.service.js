/**
 * Web Capture Service
 *
 * Main orchestrator for web page capture
 * Coordinates Puppeteer, resource extraction, downloading, and ZIP creation
 */

const path = require('path');
const fs = require('fs').promises;
const ResourceExtractorService = require('./resource-extractor.service');
const MultiPageCrawlerService = require('./multi-page-crawler.service');
const ZipBuilderService = require('./zip-builder.service');
const CaptureStorageService = require('./capture-storage.service');
const ResourceDownloader = require('../utils/resource-downloader');

class WebCaptureService {
  constructor(browser, tempDir) {
    this.browser = browser;
    this.tempDir = tempDir;
    this.resourceExtractor = new ResourceExtractorService();
    this.multiPageCrawler = new MultiPageCrawlerService(browser, this.resourceExtractor);
    this.zipBuilder = new ZipBuilderService();
    this.captureStorage = new CaptureStorageService();
  }

  /**
   * Initialize storage
   */
  async initialize() {
    await this.captureStorage.initialize();
    console.log('[WebCaptureService] Storage initialized');
  }

  /**
   * Capture webpage (async wrapper)
   */
  async captureWebpageAsync(job) {
    try {
      console.log(`[WebCaptureService] Starting capture job ${job.id} for ${job.url}`);

      job.updateProgress('Starting capture...', 0);
      job.status = 'processing';

      if (job.options.multiPage?.enabled) {
        await this.captureMultiPage(job);
      } else {
        await this.captureSinglePage(job);
      }

      console.log(`[WebCaptureService] Job ${job.id} completed successfully`);

    } catch (error) {
      console.error(`[WebCaptureService] Job ${job.id} failed:`, error);
      job.fail(error);
    }
  }

  /**
   * Capture single page
   */
  async captureSinglePage(job) {
    const { url, options } = job;
    let page;

    try {
      // Step 1: Launch page
      job.updateProgress('Launching browser page...', 5);
      page = await this.browser.newPage();

      if (options.userAgent) {
        await page.setUserAgent(options.userAgent);
      }

      // Step 2: Navigate to URL
      job.updateProgress(`Navigating to ${url}...`, 10);

      // Wait for both DOM content loaded AND network idle for better SPA support
      await page.goto(url, {
        waitUntil: ['domcontentloaded', 'networkidle2'],
        timeout: options.timeout
      });

      // Optional: Wait for content-specific selectors if provided
      if (options.contentSelector) {
        try {
          await page.waitForSelector(options.contentSelector, {
            timeout: 5000
          });
          console.log(`[WebCaptureService] Content selector ${options.contentSelector} found`);
        } catch (e) {
          console.warn(`[WebCaptureService] Content selector ${options.contentSelector} not found, continuing...`);
        }
      }

      job.completeStep('Navigate to page');

      // Step 2.5: Trigger lazy loading (scroll to load images)
      job.updateProgress('Triggering lazy-loaded content...', 15);
      await this.triggerLazyLoading(page);

      // Step 3: Extract resources
      job.updateProgress('Extracting resources...', 20);
      const resources = await this.resourceExtractor.extract(page, url);

      job.stats.totalResources =
        resources.images.length +
        resources.stylesheets.length +
        resources.scripts.length +
        resources.fonts.length;

      job.completeStep('Extract resources');

      // Step 4: Download resources
      job.updateProgress('Downloading resources...', 30);
      const downloadedResources = await this.downloadResources(resources, job, url);

      job.completeStep('Download resources');

      // Step 5: Get HTML content
      job.updateProgress('Processing HTML...', 70);
      const html = await page.content();

      // Step 6: Get page title
      const title = await page.title();

      // Step 7: Rewrite paths in HTML
      const processedHtml = await this.processHtml(html, downloadedResources, url);

      job.completeStep('Process HTML');

      // Step 8: Save to persistent storage
      job.updateProgress('Saving capture to storage...', 80);

      const captureResult = await this.captureStorage.saveCapture(
        url,
        title,
        downloadedResources,
        processedHtml,
        options
      );

      job.completeStep('Save capture');

      // Complete job with capture info
      job.complete(captureResult.path, {
        captureId: captureResult.id,
        metadata: captureResult.metadata
      });

    } catch (error) {
      throw error;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Capture multiple pages
   */
  async captureMultiPage(job) {
    const { url, options } = job;

    try {
      // Step 1: Crawl pages
      job.updateProgress('Crawling pages...', 5);

      const pages = await this.multiPageCrawler.crawl(url, options, job);

      console.log(`[WebCaptureService] Crawled ${pages.length} pages`);

      if (pages.length === 0) {
        throw new Error('No pages captured');
      }

      job.stats.pagesProcessed = pages.length;
      job.stats.totalPages = pages.length;
      job.completeStep('Crawl pages');

      // Step 2: Merge and download resources
      job.updateProgress('Downloading resources from all pages...', 50);

      // Merge resources from all pages
      const allResources = this.mergePageResources(pages);

      job.stats.totalResources =
        allResources.images.length +
        allResources.stylesheets.length +
        allResources.scripts.length +
        allResources.fonts.length;

      // Download merged resources
      const downloadedResources = await this.downloadResources(allResources, job);

      job.completeStep('Download resources');

      // Step 3: Update pages with downloaded resource paths
      pages.forEach(page => {
        this.updatePageResourcePaths(page, downloadedResources);
      });

      // Step 4: Process and save to persistent storage
      job.updateProgress('Saving multi-page capture to storage...', 85);

      // Use the first page's HTML and title
      const mainPage = pages[0];
      const processedHtml = mainPage.html;
      const title = mainPage.title || url;

      const captureResult = await this.captureStorage.saveCapture(
        url,
        title,
        downloadedResources,
        processedHtml,
        {
          ...options,
          pages: pages.map(p => ({ url: p.url, title: p.title }))
        }
      );

      job.completeStep('Save capture');

      // Complete job with capture info
      job.complete(captureResult.path, {
        captureId: captureResult.id,
        metadata: captureResult.metadata
      });

    } catch (error) {
      throw error;
    }
  }

  /**
   * Trigger lazy-loaded images by scrolling through the page
   */
  async triggerLazyLoading(page) {
    try {
      console.log('[WebCaptureService] Triggering lazy-loaded content...');

      // Count lazy-loaded images before scrolling
      const lazyImageCount = await page.evaluate(() => {
        return document.querySelectorAll('img[loading="lazy"], img[data-src], img[data-lazy]').length;
      });

      if (lazyImageCount === 0) {
        console.log('[WebCaptureService] No lazy-loaded images detected, skipping scroll');
        return;
      }

      console.log(`[WebCaptureService] Found ${lazyImageCount} lazy-loaded images, scrolling to trigger loading...`);

      // Scroll through page in chunks to trigger lazy loading
      await page.evaluate(async () => {
        const scrollDelay = 200; // ms between scrolls
        const scrollStep = 500; // pixels per scroll

        const totalHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );

        for (let scrollY = 0; scrollY < totalHeight; scrollY += scrollStep) {
          window.scrollTo(0, scrollY);
          await new Promise(resolve => setTimeout(resolve, scrollDelay));
        }

        // Scroll back to top
        window.scrollTo(0, 0);
      });

      // Wait a bit for images to start loading
      await page.waitForTimeout(1000);

      console.log('[WebCaptureService] Lazy loading triggered successfully');
    } catch (error) {
      console.warn('[WebCaptureService] Error triggering lazy loading:', error.message);
      // Don't fail the whole capture if lazy loading fails
    }
  }

  /**
   * Download resources to local storage
   */
  async downloadResources(resources, job, baseUrl) {
    const downloader = new ResourceDownloader(this.tempDir, baseUrl);
    const downloaded = {
      images: [],
      stylesheets: [],
      scripts: [],
      fonts: []
    };

    // Download images
    if (resources.images && resources.images.length > 0) {
      console.log(`[WebCaptureService] Downloading ${resources.images.length} images...`);

      for (const image of resources.images) {
        try {
          const result = await downloader.downloadResource(image.url, 'images');
          downloaded.images.push({
            ...image,
            url: result.url, // Use normalized URL from downloader (fixes protocol-relative URLs)
            localPath: result.localPath,
            filename: result.filename
          });
          job.stats.succeeded.images++;
          job.stats.resourcesDownloaded++;
        } catch (error) {
          job.stats.failed.images.push({ url: image.url, error: error.message });
        }
      }
    }

    // Download stylesheets
    if (resources.stylesheets && resources.stylesheets.length > 0) {
      for (const css of resources.stylesheets) {
        if (css.inline) {
          downloaded.stylesheets.push(css); // Keep inline CSS as-is
          job.stats.succeeded.stylesheets++;
        } else {
          try {
            const result = await downloader.downloadResource(css.url, 'css');
            downloaded.stylesheets.push({
              ...css,
              url: result.url, // Use normalized URL from downloader
              localPath: result.localPath,
              filename: result.filename
            });
            job.stats.succeeded.stylesheets++;
            job.stats.resourcesDownloaded++;
          } catch (error) {
            job.stats.failed.stylesheets.push({ url: css.url, error: error.message });
          }
        }
      }
    }

    // Download scripts
    if (resources.scripts && resources.scripts.length > 0) {
      for (const script of resources.scripts) {
        try {
          const result = await downloader.downloadResource(script.url, 'js');
          downloaded.scripts.push({
            ...script,
            url: result.url, // Use normalized URL from downloader
            localPath: result.localPath,
            filename: result.filename
          });
          job.stats.succeeded.scripts++;
          job.stats.resourcesDownloaded++;
        } catch (error) {
          job.stats.failed.scripts.push({ url: script.url, error: error.message });
        }
      }
    }

    // Download fonts
    if (resources.fonts && resources.fonts.length > 0) {
      console.log(`[WebCaptureService] Downloading ${resources.fonts.length} fonts...`);

      for (const font of resources.fonts) {
        try {
          const result = await downloader.downloadResource(font.url, 'fonts');
          downloaded.fonts.push({
            ...font,
            url: result.url, // Use normalized URL from downloader
            localPath: result.localPath,
            filename: result.filename
          });
          job.stats.succeeded.fonts++;
          job.stats.resourcesDownloaded++;
        } catch (error) {
          job.stats.failed.fonts.push({ url: font.url, error: error.message });
        }
      }
    }

    // Download favicon
    if (resources.favicon) {
      try {
        const result = await downloader.downloadResource(resources.favicon.url, '.');
        downloaded.favicon = {
          ...resources.favicon,
          url: result.url, // Use normalized URL from downloader
          localPath: result.localPath,
          filename: result.filename
        };
      } catch (error) {
        console.warn('[WebCaptureService] Failed to download favicon:', error.message);
      }
    }

    console.log(`[WebCaptureService] Downloaded ${job.stats.resourcesDownloaded} resources`);

    // Process CSS files to rewrite url() references
    await this.processCssFiles(downloaded);

    return downloaded;
  }

  /**
   * Process downloaded CSS files to rewrite url() references
   */
  async processCssFiles(resources) {
    const fs = require('fs').promises;

    // Build URL map for quick lookups
    const urlMap = new Map();
    [
      ...(resources.images || []),
      ...(resources.fonts || [])
    ].forEach(resource => {
      if (resource.url && resource.localPath) {
        urlMap.set(resource.url, resource.localPath);
      }
    });

    // Process each CSS file
    for (const css of resources.stylesheets || []) {
      if (css.inline || !css.localPath) continue;

      try {
        // Read CSS file
        let cssContent = await fs.readFile(css.localPath, 'utf8');
        let modified = false;

        // Find all url() references
        cssContent = cssContent.replace(/url\(['"]?([^'")]+)['"]?\)/gi, (match, urlPath) => {
          // Skip data URLs
          if (urlPath.startsWith('data:')) return match;

          try {
            // Convert to absolute URL
            const absoluteUrl = new URL(urlPath, css.url).href;

            // Check if we have this resource
            if (urlMap.has(absoluteUrl)) {
              const localPath = urlMap.get(absoluteUrl);
              // Get relative path from css/ to the resource
              // CSS is in temp/css/file.css, resource is in temp/images/img.jpg
              // We need: ../images/img.jpg
              const parts = localPath.split('/');
              const relativePath = '../' + parts.slice(-2).join('/');
              modified = true;
              return `url("${relativePath}")`;
            }
          } catch (e) {
            // Invalid URL, keep original
          }

          return match;
        });

        // Write back if modified
        if (modified) {
          await fs.writeFile(css.localPath, cssContent, 'utf8');
          console.log(`[WebCaptureService] Rewrote CSS file: ${css.localPath}`);
        }
      } catch (error) {
        console.warn(`[WebCaptureService] Failed to process CSS file ${css.localPath}:`, error.message);
      }
    }
  }

  /**
   * Process HTML (path rewriting, etc.)
   * Rewrite src/href attributes to point to local downloaded resources
   */
  async processHtml(html, resources, url) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // Detect and handle <base> tag for URL resolution
    const baseTag = $('base[href]');
    let baseUrl = url; // Default to original URL
    if (baseTag.length > 0) {
      const baseHref = baseTag.attr('href');
      try {
        // Resolve base href against original URL
        baseUrl = new URL(baseHref, url).href;
        console.log(`[ProcessHTML] Found <base href="${baseHref}">, using ${baseUrl} for URL resolution`);
        // Remove base tag after we've captured it (prevents issues in captured HTML)
        baseTag.remove();
      } catch (error) {
        console.warn(`[ProcessHTML] Invalid base href "${baseHref}", ignoring:`, error.message);
      }
    }

    // Create a map of original URLs to local paths
    const urlToLocalPath = new Map();

    // Flatten all resources into a single array
    const allResources = [
      ...(resources.images || []),
      ...(resources.stylesheets || []),
      ...(resources.scripts || []),
      ...(resources.fonts || [])
    ];

    // Add favicon if present
    if (resources.favicon) {
      allResources.push(resources.favicon);
    }

    allResources.forEach(resource => {
      if (resource && resource.url && resource.localPath) {
        // Extract just the filename and subfolder from localPath
        // localPath is like: temp/images/filename.png
        // We want: images/filename.png
        const parts = resource.localPath.split('/');
        const relativePath = parts.slice(-2).join('/'); // Get last 2 parts
        urlToLocalPath.set(resource.url, relativePath);
      }
    });

    console.log(`[ProcessHTML] Built urlToLocalPath map with ${urlToLocalPath.size} resources`);
    // Show first 5 image URLs as examples
    const imageUrls = Array.from(urlToLocalPath.keys()).filter(url => url.includes('upload.wikimedia.org')).slice(0, 5);
    imageUrls.forEach(url => {
      console.log(`[ProcessHTML] Map entry: ${url.substring(0, 80)}... -> ${urlToLocalPath.get(url)}`);
    });

    // Rewrite image src and srcset attributes
    let srcsetCount = 0;
    let srcsetRewritten = 0;

    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        const absoluteUrl = new URL(src, baseUrl).href;
        if (urlToLocalPath.has(absoluteUrl)) {
          $(el).attr('src', urlToLocalPath.get(absoluteUrl));
        }
      }

      // Handle srcset attribute (responsive images)
      const srcset = $(el).attr('srcset');
      if (srcset) {
        srcsetCount++;
        console.log(`[ProcessHTML] Processing srcset #${srcsetCount}: ${srcset.substring(0, 100)}...`);

        const rewrittenSrcset = srcset
          .split(',')
          .map(entry => {
            const parts = entry.trim().split(/\s+/);
            const imageUrl = parts[0];
            const descriptor = parts.slice(1).join(' '); // e.g., "250w" or "2x"

            try {
              const absoluteUrl = new URL(imageUrl, baseUrl).href;
              console.log(`[ProcessHTML] Checking srcset URL: ${imageUrl} -> ${absoluteUrl}`);

              if (urlToLocalPath.has(absoluteUrl)) {
                const localPath = urlToLocalPath.get(absoluteUrl);
                console.log(`[ProcessHTML] ✓ Found in map, rewriting to: ${localPath}`);
                srcsetRewritten++;
                return descriptor ? `${localPath} ${descriptor}` : localPath;
              } else {
                console.log(`[ProcessHTML] ✗ NOT found in urlToLocalPath map`);
              }
            } catch (e) {
              console.log(`[ProcessHTML] Error converting URL: ${e.message}`);
            }

            return entry.trim();
          })
          .join(', ');

        $(el).attr('srcset', rewrittenSrcset);
      }
    });

    console.log(`[ProcessHTML] Processed ${srcsetCount} srcset attributes, rewrote ${srcsetRewritten} URLs`);

    // Rewrite picture source srcset attributes
    $('picture source[srcset]').each((i, el) => {
      const srcset = $(el).attr('srcset');
      if (srcset) {
        const rewrittenSrcset = srcset
          .split(',')
          .map(entry => {
            const parts = entry.trim().split(/\s+/);
            const imageUrl = parts[0];
            const descriptor = parts.slice(1).join(' ');

            try {
              const absoluteUrl = new URL(imageUrl, baseUrl).href;
              if (urlToLocalPath.has(absoluteUrl)) {
                const localPath = urlToLocalPath.get(absoluteUrl);
                return descriptor ? `${localPath} ${descriptor}` : localPath;
              }
            } catch (e) {
              // Invalid URL, keep original
            }

            return entry.trim();
          })
          .join(', ');

        $(el).attr('srcset', rewrittenSrcset);
      }
    });

    // Rewrite link href attributes (stylesheets)
    $('link[rel="stylesheet"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        const absoluteUrl = new URL(href, baseUrl).href;
        if (urlToLocalPath.has(absoluteUrl)) {
          $(el).attr('href', urlToLocalPath.get(absoluteUrl));
        }
      }
    });

    // Rewrite script src attributes
    $('script[src]').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        const absoluteUrl = new URL(src, baseUrl).href;
        if (urlToLocalPath.has(absoluteUrl)) {
          $(el).attr('src', urlToLocalPath.get(absoluteUrl));
        }
      }
    });

    // Remove integrity and crossorigin attributes from scripts and links
    // These break when resources are served locally since hashes won't match
    $('script[integrity], link[integrity]').each((i, el) => {
      $(el).removeAttr('integrity');
      $(el).removeAttr('crossorigin');
      console.log(`[ProcessHTML] Removed integrity/crossorigin from ${el.tagName}`);
    });

    // Remove Content Security Policy meta tags
    // CSP headers can block local resources from loading
    const cspTags = $('meta[http-equiv="Content-Security-Policy"]');
    if (cspTags.length > 0) {
      console.log(`[ProcessHTML] Removing ${cspTags.length} CSP meta tag(s)`);
      cspTags.remove();
    }

    // Rewrite anchor href attributes that link to images
    let imageLinksRewritten = 0;
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;

          // Check if this link points to an image we downloaded
          if (urlToLocalPath.has(absoluteUrl)) {
            const localPath = urlToLocalPath.get(absoluteUrl);

            // Only rewrite if it looks like an image link
            if (localPath.match(/\.(jpg|jpeg|png|gif|svg|webp)/i)) {
              $(el).attr('href', localPath);
              imageLinksRewritten++;
            }
          } else if (href.match(/\/wiki\/File:/i)) {
            // Handle Wikipedia file page links like /wiki/File:Image.jpg
            // Extract the base filename and find the largest local version

            const fileMatch = href.match(/\/wiki\/File:(.+?)(?:\?|#|$)/i);
            if (fileMatch) {
              const baseFilename = decodeURIComponent(fileMatch[1]);

              // Find all downloaded images that match this base filename
              const matchingImages = [];
              urlToLocalPath.forEach((localPath, imageUrl) => {
                if (localPath.match(/\.(jpg|jpeg|png|gif|svg|webp)/i)) {
                  // Check if the URL contains the base filename
                  if (imageUrl.includes(baseFilename)) {
                    // Extract size from filename (e.g., 250px, 500px, 960px)
                    const sizeMatch = localPath.match(/(\d+)px-/);
                    const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
                    matchingImages.push({ localPath, size });
                  }
                }
              });

              // Use the largest version
              if (matchingImages.length > 0) {
                matchingImages.sort((a, b) => b.size - a.size);
                $(el).attr('href', matchingImages[0].localPath);
                imageLinksRewritten++;
              }
            }
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }
    });

    console.log(`[ProcessHTML] Rewrote ${imageLinksRewritten} image links`);

    // Absolutize all other links (non-local, non-resource links)
    let linksAbsolutized = 0;
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');

      // Skip if already absolute, internal anchor, or javascript
      if (!href ||
          href.startsWith('http://') ||
          href.startsWith('https://') ||
          href.startsWith('#') ||
          href.startsWith('javascript:') ||
          href.startsWith('mailto:') ||
          href.startsWith('tel:')) {
        return;
      }

      // Skip if it's a local resource path (already rewritten)
      if (href.startsWith('images/') ||
          href.startsWith('css/') ||
          href.startsWith('js/') ||
          href.startsWith('fonts/')) {
        return;
      }

      try {
        // Convert to absolute URL
        const absoluteUrl = new URL(href, baseUrl).href;
        $(el).attr('href', absoluteUrl);
        linksAbsolutized++;
      } catch (e) {
        // Invalid URL, keep original
      }
    });

    console.log(`[ProcessHTML] Absolutized ${linksAbsolutized} external links`);

    return $.html();
  }

  /**
   * Merge resources from multiple pages
   */
  mergePageResources(pages) {
    const merged = {
      images: [],
      stylesheets: [],
      scripts: [],
      fonts: []
    };

    const imageUrls = new Set();
    const cssUrls = new Set();
    const jsUrls = new Set();
    const fontUrls = new Set();

    pages.forEach(page => {
      if (!page.resources) return;

      // Merge images
      if (page.resources.images) {
        page.resources.images.forEach(img => {
          if (!imageUrls.has(img.url)) {
            imageUrls.add(img.url);
            merged.images.push(img);
          }
        });
      }

      // Merge stylesheets
      if (page.resources.stylesheets) {
        page.resources.stylesheets.forEach(css => {
          const key = css.url || `inline_${css.index}`;
          if (!cssUrls.has(key)) {
            cssUrls.add(key);
            merged.stylesheets.push(css);
          }
        });
      }

      // Merge scripts
      if (page.resources.scripts) {
        page.resources.scripts.forEach(js => {
          if (!jsUrls.has(js.url)) {
            jsUrls.add(js.url);
            merged.scripts.push(js);
          }
        });
      }

      // Merge fonts
      if (page.resources.fonts) {
        page.resources.fonts.forEach(font => {
          if (!fontUrls.has(font.url)) {
            fontUrls.add(font.url);
            merged.fonts.push(font);
          }
        });
      }
    });

    return merged;
  }

  /**
   * Update page resources with downloaded paths
   */
  updatePageResourcePaths(page, downloadedResources) {
    // Update image paths
    if (page.resources && page.resources.images && downloadedResources.images) {
      page.resources.images = downloadedResources.images;
    }

    // Update CSS paths
    if (page.resources && page.resources.stylesheets && downloadedResources.stylesheets) {
      page.resources.stylesheets = downloadedResources.stylesheets;
    }

    // Update JS paths
    if (page.resources && page.resources.scripts && downloadedResources.scripts) {
      page.resources.scripts = downloadedResources.scripts;
    }

    // Update font paths
    if (page.resources && page.resources.fonts && downloadedResources.fonts) {
      page.resources.fonts = downloadedResources.fonts;
    }
  }
}

module.exports = WebCaptureService;

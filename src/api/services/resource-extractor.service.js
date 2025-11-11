/**
 * Resource Extractor Service
 *
 * Extracts resources (images, CSS, JS, fonts) from web pages using Puppeteer
 * Ported from Chrome extension content.js
 */

const axios = require('axios');

class ResourceExtractorService {
  constructor() {
    // Resource tracking
    this.wikipediaThumbnailUrls = {};
  }

  /**
   * Extract all resources from a Puppeteer page
   */
  async extract(page, url) {
    console.log(`[ResourceExtractor] Extracting resources from: ${url}`);

    // Execute extraction in page context
    const resources = await page.evaluate(() => {
      const result = {
        images: [],
        stylesheets: [],
        scripts: [],
        links: []
      };

      // Extract images
      document.querySelectorAll('img').forEach(img => {
        if (img.src) {
          result.images.push({
            url: img.src,
            alt: img.alt || '',
            width: img.naturalWidth || 0,
            height: img.naturalHeight || 0
          });
        }

        // Handle srcset
        if (img.srcset) {
          const srcsetUrls = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
          srcsetUrls.forEach(url => {
            if (url && !result.images.find(i => i.url === url)) {
              result.images.push({ url, alt: img.alt || '', srcset: true });
            }
          });
        }
      });

      // Extract picture sources
      document.querySelectorAll('picture source').forEach(source => {
        if (source.srcset) {
          const srcsetUrls = source.srcset.split(',').map(s => s.trim().split(' ')[0]);
          srcsetUrls.forEach(url => {
            if (url && !result.images.find(i => i.url === url)) {
              result.images.push({ url, srcset: true });
            }
          });
        }
      });

      // Extract background images from inline styles
      document.querySelectorAll('[style*="background"]').forEach(el => {
        const style = el.getAttribute('style');
        const urlMatches = style.match(/url\(['"]?([^'"()]+)['"]?\)/gi);
        if (urlMatches) {
          urlMatches.forEach(match => {
            let url = match.replace(/url\(['"]?|['"]?\)/gi, '');
            if (url && !url.startsWith('data:')) {
              // Convert relative URLs to absolute
              try {
                url = new URL(url, window.location.href).href;
              } catch (e) {
                // If URL is already absolute or invalid, use as-is
              }
              result.images.push({ url, background: true });
            }
          });
        }
      });

      // Extract external stylesheets
      document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        if (link.href) {
          result.stylesheets.push({
            url: link.href,
            media: link.media || 'all'
          });
        }
      });

      // Extract inline stylesheets
      document.querySelectorAll('style').forEach((style, index) => {
        result.stylesheets.push({
          content: style.textContent,
          inline: true,
          index
        });
      });

      // Extract scripts
      document.querySelectorAll('script[src]').forEach(script => {
        if (script.src) {
          result.scripts.push({
            url: script.src,
            type: script.type || 'text/javascript',
            async: script.async,
            defer: script.defer
          });
        }
      });

      // Extract favicon
      const favicon = document.querySelector('link[rel*="icon"]');
      if (favicon && favicon.href) {
        result.favicon = {
          url: favicon.href,
          type: favicon.type || ''
        };
      }

      return result;
    });

    // Extract fonts from stylesheets (server-side)
    const fonts = await this.extractFontsFromStylesheets(resources.stylesheets, url);
    resources.fonts = fonts;

    // Handle Wikipedia thumbnail mapping
    this.mapWikipediaThumbnails(resources.images);

    console.log(`[ResourceExtractor] Extracted:
      - ${resources.images.length} images
      - ${resources.stylesheets.length} stylesheets
      - ${resources.scripts.length} scripts
      - ${resources.fonts.length} fonts`);

    return resources;
  }

  /**
   * Extract font URLs from CSS files
   * Ported from extension background.js
   */
  async extractFontsFromStylesheets(stylesheets, baseUrl) {
    const allFonts = new Set();

    for (const stylesheet of stylesheets) {
      try {
        let cssText;

        if (stylesheet.inline) {
          // Inline style tag
          cssText = stylesheet.content;
        } else {
          // External stylesheet - download and parse
          console.log(`[ResourceExtractor] Fetching stylesheet: ${stylesheet.url}`);
          const response = await axios.get(stylesheet.url, {
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ContentLabWebCapture/1.0)'
            }
          });
          cssText = response.data;
        }

        // Extract font URLs from CSS
        const fonts = this.extractFontUrlsFromCss(cssText, stylesheet.url || baseUrl);
        fonts.forEach(font => allFonts.add(font));

      } catch (error) {
        console.warn(`[ResourceExtractor] Failed to extract fonts from stylesheet:`, error.message);
      }
    }

    return Array.from(allFonts).map(url => ({ url }));
  }

  /**
   * Extract font URLs from CSS text using regex
   * Direct port from extension background.js
   */
  extractFontUrlsFromCss(cssText, baseUrl) {
    const fontUrls = new Set();

    // Match @font-face blocks
    const fontFaceRegex = /@font-face\s*{([^}]*)}/g;
    let match;

    while ((match = fontFaceRegex.exec(cssText)) !== null) {
      const fontFaceBlock = match[1];

      // Extract URLs from src property
      const srcRegex = /src:\s*([^;]+);/g;
      const srcMatch = srcRegex.exec(fontFaceBlock);

      if (srcMatch) {
        const srcValue = srcMatch[1];

        // Extract url() values
        const urlRegex = /url\(['"]?([^'"()]+)['"]?\)/g;
        let urlMatch;

        while ((urlMatch = urlRegex.exec(srcValue)) !== null) {
          const fontUrl = urlMatch[1];

          // Skip data URLs
          if (fontUrl.startsWith('data:')) continue;

          // Resolve relative URLs
          try {
            const absoluteUrl = new URL(fontUrl, baseUrl).href;
            fontUrls.add(absoluteUrl);
          } catch (error) {
            console.warn(`[ResourceExtractor] Invalid font URL: ${fontUrl}`);
          }
        }
      }
    }

    return Array.from(fontUrls);
  }

  /**
   * Map Wikipedia thumbnail URLs to full-size images
   * Ported from extension content.js
   */
  mapWikipediaThumbnails(images) {
    images.forEach(image => {
      const url = image.url;

      // Check if it's a Wikipedia thumbnail
      if (url.includes('wikipedia.org') && url.includes('/thumb/')) {
        // Extract full-size URL
        // Pattern: /wikipedia/commons/thumb/a/ab/Example.jpg/220px-Example.jpg
        // Full: /wikipedia/commons/a/ab/Example.jpg
        const fullSizeUrl = url.replace(/\/thumb(\/[^/]+\/[^/]+\/[^/]+)\/[^/]+$/, '$1');

        this.wikipediaThumbnailUrls[url] = fullSizeUrl;

        console.log(`[ResourceExtractor] Mapped Wikipedia thumbnail: ${url} -> ${fullSizeUrl}`);
      }
    });
  }

  /**
   * Get Wikipedia thumbnail mapping
   */
  getWikipediaThumbnailMapping() {
    return this.wikipediaThumbnailUrls;
  }

  /**
   * Clear state
   */
  clear() {
    this.wikipediaThumbnailUrls = {};
  }
}

module.exports = ResourceExtractorService;

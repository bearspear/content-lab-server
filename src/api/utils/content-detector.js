/**
 * Content Detector Utility
 *
 * Provides selectors and logic for detecting content areas
 * and filtering out navigation/header/footer elements
 *
 * Ported from Chrome extension content.js
 */

class ContentDetector {
  /**
   * Selectors for finding main content areas
   * Priority order: most specific to least specific
   */
  static CONTENT_SELECTORS = [
    'main',                  // HTML5 main content
    'article',               // Article content
    '[role="main"]',         // ARIA main role
    '.main-content',         // Common class patterns
    '.content',
    '#content',
    '#main-content',
    '#main',
    '.post-content',         // Blog/CMS patterns
    '.article-content',
    '.entry-content',
    '[id*="content"]',       // Fuzzy ID matching
    '[class*="content"]'
  ];

  /**
   * Selectors for excluding navigation/UI elements
   */
  static EXCLUDE_SELECTORS = [
    'header',                // Semantic elements
    'nav',
    'footer',
    'aside',
    '[role="navigation"]',   // ARIA roles
    '[role="banner"]',
    '[role="complementary"]',
    '[role="contentinfo"]',
    '.nav',                  // Common navigation classes
    '.navigation',
    '.navbar',
    '.nav-bar',
    '.menu',
    '.sidebar',
    '.side-bar',
    '.breadcrumb',
    '.breadcrumbs',
    '.toc',                  // Table of contents
    '.table-of-contents',
    '#nav',                  // Common navigation IDs
    '#navbar',
    '#navigation',
    '#menu',
    '#sidebar',
    '#header',
    '#footer',
    '[class*="menu"]',       // Fuzzy class matching
    '[class*="nav"]',
    '[id*="menu"]',
    '[id*="nav"]'
  ];

  /**
   * Get script to inject into page for link extraction
   * Returns a function that can be executed in page.evaluate()
   */
  static getExtractLinksScript() {
    return (contentSelectors, excludeSelectors) => {
      // Find content container
      let container = null;
      for (const selector of contentSelectors) {
        try {
          container = document.querySelector(selector);
          if (container) {
            console.log(`[ContentDetector] Found content container: ${selector}`);
            break;
          }
        } catch (e) {
          // Invalid selector, skip
        }
      }

      // Get all links from content area (or whole document if no content found)
      const searchArea = container || document;
      const allLinks = searchArea.querySelectorAll('a[href]');

      const links = new Set();
      let filteredCount = 0;

      allLinks.forEach(link => {
        const href = link.href;

        // Skip non-HTTP links
        if (!href || !href.startsWith('http')) {
          return;
        }

        // Check if link is inside an excluded element
        let isExcluded = false;
        for (const selector of excludeSelectors) {
          try {
            if (link.closest(selector)) {
              isExcluded = true;
              filteredCount++;
              break;
            }
          } catch (e) {
            // Invalid selector, skip
          }
        }

        if (!isExcluded) {
          links.add(href);
        }
      });

      console.log(`[ContentDetector] Filtered out ${filteredCount} navigation links`);
      console.log(`[ContentDetector] Extracted ${links.size} content links`);

      return {
        links: Array.from(links),
        containerFound: !!container,
        filteredCount
      };
    };
  }

  /**
   * Get script to detect if page has significant content
   */
  static getHasContentScript() {
    return (contentSelectors) => {
      for (const selector of contentSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            const text = element.textContent || '';
            // Has content if more than 100 characters
            return text.trim().length > 100;
          }
        } catch (e) {
          // Invalid selector, skip
        }
      }

      // Fallback: check body text length
      const bodyText = document.body.textContent || '';
      return bodyText.trim().length > 200;
    };
  }

  /**
   * Filter links by domain (for same-domain-only option)
   */
  static filterLinksByDomain(links, baseDomain) {
    return links.filter(link => {
      try {
        const linkDomain = new URL(link).hostname;
        return linkDomain === baseDomain;
      } catch (e) {
        return false;
      }
    });
  }

  /**
   * Deduplicate links (remove fragments, trailing slashes)
   */
  static deduplicateLinks(links) {
    const normalized = new Map();

    links.forEach(link => {
      try {
        const url = new URL(link);
        // Remove fragment
        url.hash = '';
        // Normalize trailing slash
        let normalized_url = url.href.replace(/\/$/, '');

        if (!normalized.has(normalized_url)) {
          normalized.set(normalized_url, link);
        }
      } catch (e) {
        // Invalid URL, skip
      }
    });

    return Array.from(normalized.values());
  }
}

module.exports = ContentDetector;

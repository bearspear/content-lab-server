/**
 * ZIP Builder Service
 *
 * Creates ZIP archives with proper structure and path rewriting
 * Ported from Chrome extension background.js
 */

const JSZip = require('jszip');
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');

class ZipBuilderService {
  /**
   * Build single-page ZIP archive
   */
  async buildSinglePageZip(html, resources, outputPath, url) {
    const zip = new JSZip();

    console.log(`[ZipBuilder] Creating single-page ZIP...`);

    // Create folders
    const imagesFolder = zip.folder('images');
    const cssFolder = zip.folder('css');
    const jsFolder = zip.folder('js');
    const fontsFolder = zip.folder('fonts');

    // Add HTML file
    zip.file('index.html', html);

    // Add resources
    await this.addResourcesToZip(resources, {
      images: imagesFolder,
      css: cssFolder,
      js: jsFolder,
      fonts: fontsFolder,
      zip
    });

    // Generate ZIP and write to disk
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    await fs.writeFile(outputPath, buffer);

    console.log(`[ZipBuilder] Single-page ZIP created: ${outputPath} (${buffer.length} bytes)`);

    return outputPath;
  }

  /**
   * Build multi-page ZIP archive
   * Ported from extension createMultiPageZip
   */
  async buildMultiPageZip(pages, outputPath) {
    const zip = new JSZip();

    console.log(`[ZipBuilder] Creating multi-page ZIP for ${pages.length} pages...`);

    // Create folders
    const imagesFolder = zip.folder('images');
    const cssFolder = zip.folder('css');
    const jsFolder = zip.folder('js');
    const fontsFolder = zip.folder('fonts');
    const pagesFolder = zip.folder('pages');

    // Merge resources from all pages
    const mergedResources = this.mergeResources(pages);

    // Add resources
    await this.addResourcesToZip(mergedResources, {
      images: imagesFolder,
      css: cssFolder,
      js: jsFolder,
      fonts: fontsFolder,
      zip
    });

    // Create page mapping (URL -> filename)
    const pageMap = new Map();
    pages.forEach((page, index) => {
      const filename = index === 0
        ? 'index.html' // Starting page at root
        : `pages/page_${index}.html`; // Additional pages in subfolder

      pageMap.set(page.url, filename);
    });

    // Add HTML pages with rewritten paths
    pages.forEach((page, index) => {
      const filename = index === 0 ? 'index.html' : `page_${index}.html`;
      const folder = index === 0 ? zip : pagesFolder;

      // Adjust resource paths for subfolders
      let html = page.html;
      if (index > 0) {
        html = this.adjustResourcePathsForSubfolder(html);
      }

      // Rewrite inter-page links
      html = this.rewriteInterPageLinks(html, page.url, pageMap.get(page.url), pageMap);

      folder.file(filename, html);
    });

    // Add page index metadata
    const pageIndex = pages.map((page, index) => ({
      index,
      url: page.url,
      title: page.title || '',
      depth: page.depth || 0,
      filename: pageMap.get(page.url)
    }));

    zip.file('_page_index.json', JSON.stringify(pageIndex, null, 2));

    // Generate ZIP and write to disk
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    await fs.writeFile(outputPath, buffer);

    console.log(`[ZipBuilder] Multi-page ZIP created: ${outputPath} (${buffer.length} bytes)`);

    return outputPath;
  }

  /**
   * Add resources to ZIP folders
   */
  async addResourcesToZip(resources, folders) {
    const { images, css, js, fonts, zip } = folders;

    // Add images
    if (resources.images) {
      for (const image of resources.images) {
        if (image.localPath) {
          try {
            const buffer = await fs.readFile(image.localPath);
            images.file(image.filename, buffer);
          } catch (error) {
            console.warn(`[ZipBuilder] Failed to add image: ${image.filename}`);
          }
        }
      }
    }

    // Add stylesheets
    if (resources.stylesheets) {
      for (const stylesheet of resources.stylesheets) {
        if (stylesheet.inline) {
          // Inline stylesheet - save as CSS file
          css.file(`inline_${stylesheet.index || 0}.css`, stylesheet.content);
        } else if (stylesheet.localPath) {
          try {
            const buffer = await fs.readFile(stylesheet.localPath);
            css.file(stylesheet.filename, buffer);
          } catch (error) {
            console.warn(`[ZipBuilder] Failed to add CSS: ${stylesheet.filename}`);
          }
        }
      }
    }

    // Add scripts
    if (resources.scripts) {
      for (const script of resources.scripts) {
        if (script.localPath) {
          try {
            const buffer = await fs.readFile(script.localPath);
            js.file(script.filename, buffer);
          } catch (error) {
            console.warn(`[ZipBuilder] Failed to add JS: ${script.filename}`);
          }
        }
      }
    }

    // Add fonts
    if (resources.fonts) {
      for (const font of resources.fonts) {
        if (font.localPath) {
          try {
            const buffer = await fs.readFile(font.localPath);
            fonts.file(font.filename, buffer);
          } catch (error) {
            console.warn(`[ZipBuilder] Failed to add font: ${font.filename}`);
          }
        }
      }
    }

    // Add favicon
    if (resources.favicon && resources.favicon.localPath) {
      try {
        const buffer = await fs.readFile(resources.favicon.localPath);
        zip.file(resources.favicon.filename, buffer);
      } catch (error) {
        console.warn(`[ZipBuilder] Failed to add favicon`);
      }
    }
  }

  /**
   * Merge resources from multiple pages
   * Deduplicates resources across pages
   */
  mergeResources(pages) {
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

    console.log(`[ZipBuilder] Merged resources:
      - ${merged.images.length} unique images
      - ${merged.stylesheets.length} unique stylesheets
      - ${merged.scripts.length} unique scripts
      - ${merged.fonts.length} unique fonts`);

    return merged;
  }

  /**
   * Adjust resource paths for pages in subfolders
   * Ported from extension background.js
   */
  adjustResourcePathsForSubfolder(html) {
    const $ = cheerio.load(html);

    // Adjust image paths
    $('img[src^="images/"]').each((i, el) => {
      const $img = $(el);
      const src = $img.attr('src');
      $img.attr('src', `../${src}`);
    });

    // Adjust CSS paths
    $('link[href^="css/"]').each((i, el) => {
      const $link = $(el);
      const href = $link.attr('href');
      $link.attr('href', `../${href}`);
    });

    // Adjust script paths
    $('script[src^="js/"]').each((i, el) => {
      const $script = $(el);
      const src = $script.attr('src');
      $script.attr('src', `../${src}`);
    });

    // Adjust inline styles with url()
    $('style').each((i, el) => {
      let css = $(el).html();
      css = css.replace(/url\(["']?images\//gi, 'url(../images/');
      css = css.replace(/url\(["']?fonts\//gi, 'url(../fonts/');
      $(el).html(css);
    });

    return $.html();
  }

  /**
   * Rewrite inter-page links for local navigation
   * Ported from extension background.js
   */
  rewriteInterPageLinks(html, currentUrl, currentFile, pageMap) {
    const $ = cheerio.load(html);

    $('a[href]').each((i, el) => {
      const $a = $(el);
      const href = $a.attr('href');

      if (!href || !href.startsWith('http')) return;

      try {
        // Get absolute URL without fragment
        const absoluteHref = new URL(href, currentUrl).href.split('#')[0];

        if (pageMap.has(absoluteHref)) {
          const targetFile = pageMap.get(absoluteHref);
          let relativePath;

          if (currentFile === 'index.html') {
            // From root to either root or pages/
            relativePath = targetFile;
          } else if (currentFile.startsWith('pages/')) {
            if (targetFile === 'index.html') {
              relativePath = '../index.html';
            } else {
              // Both in pages/ folder
              relativePath = targetFile.replace('pages/', '');
            }
          }

          $a.attr('href', relativePath);
        }
      } catch (e) {
        // Invalid URL, skip
      }
    });

    return $.html();
  }
}

module.exports = ZipBuilderService;

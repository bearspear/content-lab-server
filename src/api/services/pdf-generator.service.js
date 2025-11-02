/**
 * PDF Generator Service
 * Generates high-quality PDFs from EPUB content using Puppeteer
 */

const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const cheerio = require('cheerio');
const path = require('path');
const puppeteerConfig = require('../../config/puppeteer.config');

class PdfGeneratorService {
  constructor() {
    this.browser = null;
  }

  /**
   * Initialize Puppeteer browser
   */
  async init() {
    if (this.browser) return;

    try {
      this.browser = await puppeteer.launch(puppeteerConfig.launch);
      console.log('[PdfGenerator] Puppeteer browser launched');
    } catch (error) {
      console.error('[PdfGenerator] Failed to launch browser:', error);
      throw new Error('Failed to initialize PDF generator');
    }
  }

  /**
   * Close Puppeteer browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[PdfGenerator] Puppeteer browser closed');
    }
  }

  /**
   * Generate PDF from EPUB content
   */
  async generatePdf(epubData, options, progressCallback) {
    await this.init();

    try {
      // Step 1: Build HTML document
      if (progressCallback) progressCallback('Processing styles', 10);
      const html = await this.buildHtmlDocument(epubData, options);

      // Step 2: Render to PDF with Puppeteer
      if (progressCallback) progressCallback('Generating pages', 30);
      const pdfBuffer = await this.renderToPdf(html, options, progressCallback);

      // Step 3: Add bookmarks and metadata
      if (progressCallback) progressCallback('Creating bookmarks', 80);
      const finalPdf = await this.enhancePdf(pdfBuffer, epubData, options);

      if (progressCallback) progressCallback('Optimizing PDF', 95);

      return finalPdf;
    } catch (error) {
      console.error('[PdfGenerator] Error generating PDF:', error);
      throw error;
    }
  }

  /**
   * Build complete HTML document from EPUB content
   */
  async buildHtmlDocument(epubData, options) {
    const { metadata, tableOfContents } = epubData;
    const contents = await this.getAllChapterContent(epubData);

    console.log('[PdfGenerator] TOC has', tableOfContents.length, 'items');
    console.log('[PdfGenerator] Processing', contents.length, 'chapters');

    // Build HTML structure with high quality settings
    let html = `
<!DOCTYPE html>
<html lang="${metadata.language || 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${metadata.title}</title>
  <style>${this.generateCss(options)}</style>
</head>
<body>
`;

    // Add cover page if cover image exists
    if (metadata.cover) {
      html += this.buildCoverPage(metadata);
    }

    // Add printed TOC if requested
    if (options.tableOfContents.includePrintedToc && tableOfContents.length > 0) {
      html += this.buildTocHtml(tableOfContents, options);
    }

    // Add chapter content with image embedding
    for (let i = 0; i < contents.length; i++) {
      const chapter = contents[i];
      console.log(`[PdfGenerator] Processing chapter ${i}: ${chapter.href}`);
      const chapterHtml = await this.processChapterContent(chapter, options, i, epubData);
      html += chapterHtml;
    }

    html += `
</body>
</html>
`;

    // Save HTML for debugging
    const fs = require('fs').promises;
    try {
      await fs.writeFile('/tmp/epub-debug.html', html);
      console.log('[PdfGenerator] Debug HTML saved to /tmp/epub-debug.html');
    } catch (err) {
      console.warn('[PdfGenerator] Could not save debug HTML:', err.message);
    }

    return html;
  }

  /**
   * Get all chapter content from EPUB
   */
  async getAllChapterContent(epubData) {
    const { zip, spine } = epubData;
    const contents = [];

    for (const item of spine) {
      if (item.href && item.linear) {
        try {
          const content = await zip.file(item.href).async('string');
          contents.push({
            href: item.href,
            content
          });
        } catch (error) {
          console.warn(`[PdfGenerator] Could not load ${item.href}:`, error.message);
        }
      }
    }

    return contents;
  }

  /**
   * Process chapter content
   */
  async processChapterContent(chapter, options, index, epubData) {
    const $ = cheerio.load(chapter.content, { xmlMode: true });

    // Remove script tags
    $('script').remove();

    // For multi-column layouts: Remove style/link tags only (not inline styles - too slow)
    if (options.layout.columns > 1) {
      // Remove all style and link tags
      $('style').remove();
      $('link[rel="stylesheet"]').remove();
    } else {
      $('style').each((i, styleTag) => {
        const $styleTag = $(styleTag);
        let css = $styleTag.html() || '';

        // Remove column-related CSS from inline style tags
        css = css
          .replace(/(-webkit-)?column-count\s*:\s*[^;]+;?/gi, '')
          .replace(/(-webkit-)?column-gap\s*:\s*[^;]+;?/gi, '')
          .replace(/(-webkit-)?column-width\s*:\s*[^;]+;?/gi, '')
          .replace(/(-webkit-)?column-fill\s*:\s*[^;]+;?/gi, '')
          .replace(/(-webkit-)?column-span\s*:\s*[^;]+;?/gi, '')
          .replace(/(-webkit-)?columns\s*:\s*[^;]+;?/gi, '');

        if (css.trim()) {
          $styleTag.html(css);
        } else {
          $styleTag.remove();
        }
      });
    }

    // Process images - convert to base64 for embedding
    if (!options.layout.includeImages) {
      $('img').remove();
    } else {
      const imgPromises = [];
      $('img').each((i, img) => {
        const $img = $(img);
        const src = $img.attr('src');

        if (src) {
          // Resolve relative image path
          const imgPath = this.resolveAssetPath(src, chapter.href);
          imgPromises.push(
            this.embedImageAsBase64(imgPath, epubData.zip, $img, options)
          );
        }
      });

      await Promise.all(imgPromises);
    }

    // Extract and preserve CSS from stylesheet links
    // Skip CSS preservation for multi-column layouts to prevent conflicts
    const stylesheets = [];
    if (options.layout.columns === 1 && options.layout.preserveCss) {
      $('link[rel="stylesheet"]').each((i, link) => {
        const href = $(link).attr('href');
        if (href) {
          const cssPath = this.resolveAssetPath(href, chapter.href);
          stylesheets.push(this.extractStylesheet(cssPath, epubData.zip));
        }
      });
    }

    const inlineStyles = await Promise.all(stylesheets);

    // Extract body content
    let content = $('body').html() || $.html();

    // Add chapter wrapper with embedded styles
    const pageBreak = (options.layout.chapterPageBreaks && index > 0) ? 'page-break-before: always;' : '';
    const chapterStyles = inlineStyles.filter(s => s).join('\n');

    // Generate anchor ID for TOC linking (use same normalization as TOC links)
    const anchorId = `chapter-${this.normalizeHrefForAnchor(chapter.href)}`;
    console.log(`[PdfGenerator] Chapter anchor: id="${anchorId}" for href="${chapter.href}"`);

    return `
${chapterStyles ? `<style>${chapterStyles}</style>` : ''}
<div class="chapter" id="${anchorId}" style="${pageBreak}">
  ${content}
</div>
`;
  }

  /**
   * Resolve asset path relative to chapter
   */
  resolveAssetPath(assetPath, chapterHref) {
    const path = require('path');
    const chapterDir = path.dirname(chapterHref);
    return path.normalize(path.join(chapterDir, assetPath));
  }

  /**
   * Embed image as base64 data URL
   */
  async embedImageAsBase64(imgPath, zip, $img, options) {
    try {
      const imgFile = zip.file(imgPath);
      if (!imgFile) {
        console.warn(`[PdfGenerator] Image not found: ${imgPath}`);
        return;
      }

      const imgData = await imgFile.async('base64');
      const ext = imgPath.split('.').pop().toLowerCase();

      // Map file extensions to MIME types
      const mimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'webp': 'image/webp'
      };

      const mimeType = mimeTypes[ext] || 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${imgData}`;

      $img.attr('src', dataUrl);
      $img.css({
        'max-width': `${options.layout.imageMaxWidth}%`,
        'height': 'auto',
        'display': 'block',
        'margin': '1em auto'
      });
    } catch (error) {
      console.warn(`[PdfGenerator] Failed to embed image ${imgPath}:`, error.message);
    }
  }

  /**
   * Extract stylesheet content from EPUB
   */
  async extractStylesheet(cssPath, zip) {
    try {
      const cssFile = zip.file(cssPath);
      if (!cssFile) {
        return '';
      }

      const cssContent = await cssFile.async('string');
      // Clean up CSS and remove problematic rules
      return cssContent
        .replace(/@import[^;]+;/g, '') // Remove imports
        .replace(/@font-face\s*{[^}]+}/g, '') // Remove font-face (we'll handle separately)
        .replace(/url\([^)]+\)/g, '') // Remove external URLs
        .replace(/(-webkit-)?column-count\s*:\s*[^;]+;/gi, '') // Remove column-count
        .replace(/(-webkit-)?column-gap\s*:\s*[^;]+;/gi, '') // Remove column-gap
        .replace(/(-webkit-)?column-width\s*:\s*[^;]+;/gi, '') // Remove column-width
        .replace(/(-webkit-)?column-fill\s*:\s*[^;]+;/gi, '') // Remove column-fill
        .replace(/(-webkit-)?column-span\s*:\s*[^;]+;/gi, '') // Remove column-span
        .replace(/(-webkit-)?columns\s*:\s*[^;]+;/gi, ''); // Remove columns shorthand
    } catch (error) {
      console.warn(`[PdfGenerator] Failed to extract stylesheet ${cssPath}:`, error.message);
      return '';
    }
  }

  /**
   * Build cover page HTML
   */
  buildCoverPage(metadata) {
    const escapedTitle = (metadata.title || 'Untitled').replace(/"/g, '&quot;');
    const author = metadata.creator || 'Unknown Author';
    const publisher = metadata.publisher || '';
    const pubDate = metadata.date || '';

    return `
<div class="cover-page" style="page-break-after: always; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh;">
  <div class="cover-image-wrapper" style="margin-bottom: 2em;">
    <img src="${metadata.cover}" alt="${escapedTitle} Cover" style="max-width: 80%; max-height: 70vh; height: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
  </div>
  <div class="cover-metadata" style="text-align: center;">
    <h1 style="font-size: 2.5em; margin: 0.5em 0;">${escapedTitle}</h1>
    ${author ? `<h2 style="font-size: 1.5em; font-weight: normal; margin: 0.5em 0; color: #666;">${author}</h2>` : ''}
    ${publisher ? `<p style="margin-top: 1em; color: #888;">${publisher}</p>` : ''}
    ${pubDate ? `<p style="color: #888;">${pubDate}</p>` : ''}
  </div>
</div>
`;
  }

  /**
   * Normalize href to create consistent anchor ID
   * Removes directory paths and fragment identifiers
   */
  normalizeHrefForAnchor(href) {
    if (!href) return '';

    // Remove fragment identifier (everything after #)
    let normalized = href.split('#')[0];

    // Remove directory path (keep only filename)
    normalized = normalized.split('/').pop();

    // Replace non-alphanumeric characters with dashes
    normalized = normalized.replace(/[^a-zA-Z0-9]/g, '-');

    return normalized;
  }

  /**
   * Build TOC HTML
   */
  buildTocHtml(toc, options) {
    console.log('[PdfGenerator] Building TOC...');

    let html = `
<div class="toc-page" style="page-break-after: always;">
  <h1 class="toc-title">${options.tableOfContents.tocTitle}</h1>
  <nav class="toc">
`;

    const buildTocItems = (items, depth = 0) => {
      if (depth >= options.tableOfContents.tocDepth) return '';

      let itemsHtml = '<ul class="toc-list">';

      for (const item of items) {
        // Generate anchor ID from href or item ID
        const anchorId = item.href
          ? `chapter-${this.normalizeHrefForAnchor(item.href)}`
          : `chapter-${item.id}`;

        console.log(`[PdfGenerator] TOC Link: "${item.label}" -> #${anchorId} (href: ${item.href || 'none'})`);

        itemsHtml += `
          <li class="toc-item toc-level-${item.level}">
            <a href="#${anchorId}" class="toc-label">${item.label}</a>
            ${options.tableOfContents.tocPageNumbers ? '<span class="toc-page-num"></span>' : ''}
`;

        if (item.children && item.children.length > 0) {
          itemsHtml += buildTocItems(item.children, depth + 1);
        }

        itemsHtml += '</li>';
      }

      itemsHtml += '</ul>';
      return itemsHtml;
    };

    html += buildTocItems(toc);

    html += `
  </nav>
</div>
`;

    return html;
  }

  /**
   * Generate CSS for PDF
   */
  generateCss(options) {
    const { pageSettings, typography, layout, headerFooter } = options;

    // DEBUG: Log column settings
    console.log(`[PdfGenerator] Column settings: columns=${layout.columns}, columnGap=${layout.columnGap}`);

    return `
/* Page setup */
@page {
  size: ${pageSettings.size};
  margin-top: ${pageSettings.margins.top}${pageSettings.unit};
  margin-right: ${pageSettings.margins.right}${pageSettings.unit};
  margin-bottom: ${pageSettings.margins.bottom}${pageSettings.unit};
  margin-left: ${pageSettings.margins.left}${pageSettings.unit};
}

/* Typography - Enhanced for print quality */
body {
  font-family: ${typography.fontFamily}, "Georgia", "Times New Roman", serif;
  font-size: ${typography.fontSize}pt;
  line-height: ${typography.lineHeight};
  text-align: ${typography.textAlign};
  ${typography.hyphenation ? 'hyphens: auto; -webkit-hyphens: auto;' : 'hyphens: none;'}
  color: #000;
  margin: 0;
  padding: 0;
  font-kerning: normal;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  /* Force single column by default */
  column-count: 1 !important;
  -webkit-column-count: 1 !important;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
  page-break-after: avoid;
  margin-top: 1.5em;
  margin-bottom: 0.75em;
}

h1 { font-size: 2em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.17em; }
h4 { font-size: 1em; }
h5 { font-size: 0.83em; }
h6 { font-size: 0.67em; }

/* Paragraphs */
p {
  margin-top: 0;
  margin-bottom: ${typography.paragraphSpacing}pt;
  ${typography.indentFirstLine ? 'text-indent: 1.5em;' : ''}
}

p:first-child {
  text-indent: 0;
}

/* Lists */
ul, ol {
  margin: 0.5em 0;
  padding-left: 2em;
}

li {
  margin: 0.25em 0;
}

/* Images - High quality rendering */
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
  page-break-inside: avoid;
}

/* SVG - Preserve quality */
svg {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}

/* Cover Page */
.cover-page {
  page-break-after: always;
  text-align: center;
  padding: 2em;
}

.cover-image-wrapper {
  margin: 2em auto;
  text-align: center;
}

.cover-image-wrapper img {
  max-width: 80%;
  max-height: 70vh;
  height: auto;
  box-shadow: 0 8px 16px rgba(0,0,0,0.15);
  border-radius: 4px;
}

.cover-metadata h1 {
  font-size: 2.5em;
  margin: 1em 0 0.5em 0;
  font-weight: bold;
  color: #000;
}

.cover-metadata h2 {
  font-size: 1.5em;
  font-weight: normal;
  margin: 0.5em 0;
  color: #555;
}

.cover-metadata p {
  margin: 0.5em 0;
  color: #777;
  font-size: 1em;
}

/* Columns */
${layout.columns > 1 ? `
/* Reset body to single column */
body {
  column-count: 1 !important;
  -webkit-column-count: 1 !important;
}

/* Ensure cover and TOC are single column */
.cover-page,
.toc-page {
  column-count: 1 !important;
  -webkit-column-count: 1 !important;
}

/* ONLY .chapter gets multi-column layout */
.chapter {
  column-count: 2 !important;
  -webkit-column-count: 2 !important;
  column-gap: 15pt !important;
  -webkit-column-gap: 15pt !important;
  column-fill: balance !important;
  -webkit-column-fill: balance !important;
  orphans: 3;
  widows: 3;
}

/* Force ALL child elements to NOT have column properties */
.chapter * {
  column-count: auto !important;
  -webkit-column-count: auto !important;
}

/* Headings span all columns in multi-column layout */
.chapter h1,
.chapter h2 {
  column-span: all;
  break-after: avoid;
}

.chapter h3,
.chapter h4,
.chapter h5,
.chapter h6 {
  break-after: avoid;
  break-inside: avoid;
}

/* Images and figures in columns */
.chapter img {
  max-width: 100%;
  height: auto;
  break-inside: avoid;
  page-break-inside: avoid;
}

.chapter figure {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Tables and blockquotes */
.chapter table {
  break-inside: avoid;
  page-break-inside: avoid;
  column-span: all;
}

.chapter blockquote {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Lists */
.chapter ul,
.chapter ol {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Paragraphs */
.chapter p {
  orphans: 3;
  widows: 3;
}
` : ''}

/* Table of Contents */
.toc-page {
  margin-bottom: 2em;
}

.toc-title {
  text-align: center;
  margin-bottom: 2em;
}

.toc-list {
  list-style: none;
  padding-left: 0;
}

.toc-item {
  display: flex;
  justify-content: space-between;
  margin: 0.5em 0;
  padding-left: 0;
}

.toc-label {
  color: #1a73e8;
  text-decoration: none;
  flex: 1;
}

.toc-label:hover {
  text-decoration: underline;
}

.toc-level-1 { padding-left: 0; }
.toc-level-2 { padding-left: 1.5em; }
.toc-level-3 { padding-left: 3em; }
.toc-level-4 { padding-left: 4.5em; }

/* Blockquotes */
blockquote {
  margin: 1em 2em;
  padding-left: 1em;
  border-left: 3px solid #ccc;
  font-style: italic;
}

/* Code */
code {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
  background: #f5f5f5;
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

pre {
  background: #f5f5f5;
  padding: 1em;
  overflow-x: auto;
  border-radius: 5px;
  page-break-inside: avoid;
}

pre code {
  background: none;
  padding: 0;
}

/* Tables */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  page-break-inside: avoid;
}

th, td {
  border: 1px solid #ddd;
  padding: 0.5em;
  text-align: left;
}

th {
  background: #f5f5f5;
  font-weight: bold;
}

/* Links - Black for print (not clickable in PDF) */
a {
  color: #000;
  text-decoration: none;
}

a:visited {
  color: #000;
}

/* Page breaks */
.page-break {
  page-break-after: always;
}
`;
  }

  /**
   * Render HTML to PDF using Puppeteer
   */
  async renderToPdf(html, options, progressCallback) {
    const page = await this.browser.newPage();

    try {
      // Block external resources to prevent timeouts
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        const url = request.url();

        // Block external resources (allow data URLs and same-origin)
        if (url.startsWith('http://') || url.startsWith('https://')) {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Set viewport
      await page.setViewport(puppeteerConfig.viewport);

      // Set content with more lenient loading strategy
      // Use 'domcontentloaded' instead of 'networkidle0' to avoid timeouts
      // with external resources or broken links
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 300000 // 5 minutes
      });

      // Wait a moment for any internal rendering to settle
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));

      // Generate PDF options
      const pdfOptions = this.buildPdfOptions(options);

      // Add header/footer if requested
      if (options.headerFooter.includeHeader || options.headerFooter.includeFooter) {
        pdfOptions.displayHeaderFooter = true;
        pdfOptions.headerTemplate = this.buildHeaderTemplate(options);
        pdfOptions.footerTemplate = this.buildFooterTemplate(options);
      }

      // Generate PDF
      const buffer = await page.pdf(pdfOptions);

      if (progressCallback) progressCallback('Generating pages', 70);

      return buffer;
    } finally {
      await page.close();
    }
  }

  /**
   * Build PDF options for Puppeteer
   */
  buildPdfOptions(options) {
    const { pageSettings, quality } = options;

    const pdfOptions = {
      format: pageSettings.size === 'Custom' ? undefined : pageSettings.size,
      landscape: pageSettings.orientation === 'landscape',
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: false,
      margin: {
        top: `${pageSettings.margins.top}${pageSettings.unit}`,
        right: `${pageSettings.margins.right}${pageSettings.unit}`,
        bottom: `${pageSettings.margins.bottom}${pageSettings.unit}`,
        left: `${pageSettings.margins.left}${pageSettings.unit}`
      }
    };

    // Custom page size
    if (pageSettings.size === 'Custom' && pageSettings.customWidth && pageSettings.customHeight) {
      pdfOptions.width = `${pageSettings.customWidth}${pageSettings.unit}`;
      pdfOptions.height = `${pageSettings.customHeight}${pageSettings.unit}`;
    }

    return pdfOptions;
  }

  /**
   * Build header template
   */
  buildHeaderTemplate(options) {
    if (!options.headerFooter.includeHeader) return '<div></div>';

    const { headerContent, headerCustomText, headerAlignment } = options.headerFooter;

    let content = headerCustomText || '';
    if (headerContent === 'title') {
      content = '<span class="title"></span>';
    } else if (headerContent === 'chapter') {
      content = '<span class="section"></span>';
    }

    return `
<div style="font-size: 14px; text-align: ${headerAlignment}; width: 100%; margin: 0 auto; padding: 10px 0;">
  ${content}
</div>
`;
  }

  /**
   * Build footer template
   */
  buildFooterTemplate(options) {
    if (!options.headerFooter.includeFooter) return '<div></div>';

    const { footerContent, footerCustomText, footerAlignment } = options.headerFooter;

    let content = footerCustomText || '';
    if (footerContent === 'pageNumber') {
      content = '<span class="pageNumber"></span>';
    } else if (footerContent === 'author') {
      content = '<span class="author"></span>';
    } else if (footerContent === 'pageAndAuthor') {
      content = '<span class="author"></span> - Page <span class="pageNumber"></span>';
    }

    return `
<div style="font-size: 14px; text-align: ${footerAlignment}; width: 100%; margin: 0 auto; padding: 10px 0;">
  ${content}
</div>
`;
  }

  /**
   * Enhance PDF with bookmarks and metadata
   */
  async enhancePdf(pdfBuffer, epubData, options) {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);

      // Add metadata
      if (epubData.metadata) {
        pdfDoc.setTitle(epubData.metadata.title || 'Untitled');
        pdfDoc.setAuthor(epubData.metadata.author ? epubData.metadata.author.join(', ') : 'Unknown');
        pdfDoc.setSubject(epubData.metadata.description || '');
        pdfDoc.setKeywords([]);
        pdfDoc.setProducer('Content Lab EPUB to PDF Converter');
        pdfDoc.setCreator('Content Lab');
        pdfDoc.setCreationDate(new Date());
        pdfDoc.setModificationDate(new Date());
      }

      // TODO: Add bookmarks (requires more complex PDF-lib usage or external library)

      const enhancedBuffer = await pdfDoc.save();
      return enhancedBuffer;
    } catch (error) {
      console.error('[PdfGenerator] Error enhancing PDF:', error);
      // Return original buffer if enhancement fails
      return pdfBuffer;
    }
  }
}

// Export singleton instance
module.exports = new PdfGeneratorService();

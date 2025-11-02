/**
 * EPUB Parser Service
 * Parses EPUB files and extracts metadata, content, and structure
 */

const JSZip = require('jszip');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs').promises;
const EpubMetadata = require('../models/epub-metadata.model');

class EpubParserService {
  constructor() {
    this.parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      xmlns: false,
      explicitRoot: false,
      tagNameProcessors: [xml2js.processors.stripPrefix]
    });
  }

  /**
   * Parse EPUB file
   */
  async parseEpub(filepath) {
    try {
      // Read EPUB file
      const data = await fs.readFile(filepath);
      const zip = await JSZip.loadAsync(data);

      // Parse container.xml to find OPF file
      const containerPath = 'META-INF/container.xml';
      const containerXml = await zip.file(containerPath).async('string');
      const container = await this.parser.parseStringPromise(containerXml);

      console.log('[EpubParser] Container structure:', JSON.stringify(container, null, 2));

      // Extract OPF path - handle different xml2js structures
      // With explicitRoot: false, the root element becomes the object
      const rootfile = container.rootfiles?.rootfile || container.container?.rootfiles?.rootfile;

      console.log('[EpubParser] Rootfile object:', JSON.stringify(rootfile, null, 2));

      let opfPath = rootfile['full-path'] || rootfile.fullPath || rootfile['@_full-path'];

      // If still an object, try to extract value
      if (typeof opfPath === 'object') {
        opfPath = opfPath._ || opfPath['#text'] || opfPath.value;
      }

      console.log('[EpubParser] Extracted OPF path:', opfPath);
      const opfDir = path.dirname(opfPath);

      // Parse OPF file
      const opfXml = await zip.file(opfPath).async('string');
      const opf = await this.parser.parseStringPromise(opfXml);

      console.log('[EpubParser] OPF structure keys:', Object.keys(opf));

      // Extract metadata
      const metadata = this.extractMetadata(opf);

      // Extract manifest (all files in EPUB)
      const manifest = this.extractManifest(opf, opfDir);

      // Extract spine (reading order)
      const spine = this.extractSpine(opf, manifest);

      // Extract table of contents
      const toc = await this.extractTableOfContents(zip, opf, manifest, opfDir);

      // Extract cover image
      const cover = await this.extractCover(zip, opf, manifest);
      if (cover) {
        metadata.cover = cover;
      }

      // Calculate structure stats
      const structure = this.calculateStructure(manifest, spine, toc);

      return {
        metadata: metadata.toJSON(),
        structure,
        manifest,
        spine,
        tableOfContents: toc,
        opfPath,
        opfDir,
        zip
      };
    } catch (error) {
      console.error('[EpubParser] Error parsing EPUB:', error);
      throw new Error(`Failed to parse EPUB: ${error.message}`);
    }
  }

  /**
   * Extract metadata from OPF
   */
  extractMetadata(opf) {
    // With explicitRoot: false, 'package' becomes the root element
    const meta = opf.metadata || opf.package?.metadata;

    if (!meta) {
      console.error('[EpubParser] No metadata found. OPF structure:', JSON.stringify(opf, null, 2).substring(0, 500));
      throw new Error('No metadata found in OPF file');
    }

    // Handle both EPUB 2 and 3 formats
    const dcNs = 'http://purl.org/dc/elements/1.1/';

    const getMetaValue = (field) => {
      const key = `${dcNs}:${field}`;
      const value = meta[key] || meta[`dc:${field}`] || meta[field];

      if (!value) return null;
      if (typeof value === 'string') return value;
      if (value._) return value._;
      if (Array.isArray(value)) {
        return value.map(v => typeof v === 'string' ? v : (v._ || v)).filter(Boolean);
      }
      return String(value);
    };

    const title = getMetaValue('title') || 'Untitled';
    const creator = getMetaValue('creator');
    const author = Array.isArray(creator) ? creator : (creator ? [creator] : ['Unknown Author']);
    const publisher = getMetaValue('publisher');
    const language = getMetaValue('language') || 'en';
    const date = getMetaValue('date');
    const description = getMetaValue('description');
    const rights = getMetaValue('rights');
    const identifier = getMetaValue('identifier');

    // Try to find ISBN
    let isbn = null;
    if (identifier) {
      const isbnMatch = String(identifier).match(/(?:ISBN|isbn)[:\s]*([0-9-]+)/);
      if (isbnMatch) {
        isbn = isbnMatch[1];
      }
    }

    return new EpubMetadata({
      title,
      author,
      publisher,
      language,
      isbn,
      publicationDate: date,
      description,
      rights,
      identifier
    });
  }

  /**
   * Extract manifest from OPF
   */
  extractManifest(opf, opfDir) {
    // With explicitRoot: false, 'package' is the root
    const pkg = opf.package || opf;
    const manifestItems = pkg.manifest.item;
    const items = Array.isArray(manifestItems) ? manifestItems : [manifestItems];

    return items.map(item => ({
      id: item.id,
      href: path.join(opfDir, item.href).replace(/\\/g, '/'),
      mediaType: item['media-type'] || item.mediaType,
      properties: item.properties ? item.properties.split(' ') : []
    }));
  }

  /**
   * Extract spine from OPF
   */
  extractSpine(opf, manifest) {
    // With explicitRoot: false, 'package' is the root
    const pkg = opf.package || opf;
    const spineItems = pkg.spine.itemref;
    const items = Array.isArray(spineItems) ? spineItems : [spineItems];

    return items.map(item => {
      const manifestItem = manifest.find(m => m.id === item.idref);
      return {
        id: item.idref,
        href: manifestItem ? manifestItem.href : null,
        mediaType: manifestItem ? manifestItem.mediaType : null,
        linear: item.linear !== 'no',
        properties: item.properties ? item.properties.split(' ') : []
      };
    }).filter(item => item.href);
  }

  /**
   * Extract table of contents
   */
  async extractTableOfContents(zip, opf, manifest, opfDir) {
    try {
      console.log('[EpubParser] Extracting TOC...');

      // Try EPUB 3 NAV first
      const navItem = manifest.find(item =>
        item.properties && item.properties.includes('nav')
      );

      if (navItem) {
        console.log('[EpubParser] Found EPUB 3 NAV document:', navItem.href);
        return await this.parseNavDocument(zip, navItem.href);
      }

      // Fall back to EPUB 2 NCX
      const pkg = opf.package || opf;
      const tocId = pkg.spine.toc;
      console.log('[EpubParser] Looking for NCX with tocId:', tocId);

      if (tocId) {
        const ncxItem = manifest.find(item => item.id === tocId);
        console.log('[EpubParser] Found NCX item:', ncxItem);

        if (ncxItem) {
          console.log('[EpubParser] Parsing NCX document:', ncxItem.href);
          return await this.parseNcxDocument(zip, ncxItem.href);
        }
      } else {
        // Try to find NCX by media-type
        console.log('[EpubParser] No spine.toc attribute, searching by media-type...');
        const ncxItem = manifest.find(item => item.mediaType === 'application/x-dtbncx+xml');
        console.log('[EpubParser] NCX item by media-type:', ncxItem);

        if (ncxItem) {
          console.log('[EpubParser] Parsing NCX document:', ncxItem.href);
          return await this.parseNcxDocument(zip, ncxItem.href);
        }
      }

      console.warn('[EpubParser] No TOC found in EPUB');
      return [];
    } catch (error) {
      console.error('[EpubParser] Error parsing TOC:', error);
      return [];
    }
  }

  /**
   * Parse EPUB 3 NAV document
   */
  async parseNavDocument(zip, href) {
    const navXml = await zip.file(href).async('string');
    const nav = await this.parser.parseStringPromise(navXml);

    console.log('[EpubParser] NAV parsed structure keys:', Object.keys(nav));
    console.log('[EpubParser] NAV first level:', JSON.stringify(nav, null, 2).substring(0, 1000));

    const toc = [];

    // With explicitRoot: false, check both nav.html and just nav.body
    const body = nav.body || nav.html?.body;
    console.log('[EpubParser] Body found:', !!body);

    if (!body) {
      console.error('[EpubParser] No body element found in NAV document');
      return toc;
    }

    const navElements = body.nav;
    console.log('[EpubParser] Nav elements found:', !!navElements);

    if (!navElements) {
      console.error('[EpubParser] No nav elements found in body');
      return toc;
    }

    const navArray = Array.isArray(navElements) ? navElements : [navElements];
    console.log('[EpubParser] Nav array length:', navArray.length);

    // Debug: log the first nav element's attributes
    if (navArray.length > 0) {
      console.log('[EpubParser] First nav element attributes ($):', JSON.stringify(navArray[0].$, null, 2));
      console.log('[EpubParser] First nav element keys:', Object.keys(navArray[0]));
      console.log('[EpubParser] epub:type value:', navArray[0]['epub:type']);
    }

    // Check for epub:type directly on element (not in $)
    const tocNav = navArray.find(n =>
      n['epub:type'] === 'toc' ||
      (n.$ && n.$['epub:type'] === 'toc') ||
      (n.$ && n.$.type === 'toc')
    );
    console.log('[EpubParser] TOC nav found:', !!tocNav);

    if (tocNav && tocNav.ol) {
      console.log('[EpubParser] Parsing nav list...');
      this.parseNavList(tocNav.ol, toc, 1);
      console.log('[EpubParser] Parsed NAV TOC items:', toc.length);
    } else {
      console.error('[EpubParser] No TOC nav or ol found');
    }

    return toc;
  }

  /**
   * Parse NAV list recursively
   */
  parseNavList(ol, result, level) {
    if (!ol.li) return;

    const items = Array.isArray(ol.li) ? ol.li : [ol.li];

    items.forEach((item, index) => {
      const link = item.a;
      if (link) {
        const tocItem = {
          id: `nav-${level}-${index}`,
          label: typeof link === 'string' ? link : (link._ || link.span || 'Untitled'),
          href: link.href || '',
          level,
          children: []
        };

        if (item.ol) {
          this.parseNavList(item.ol, tocItem.children, level + 1);
        }

        result.push(tocItem);
      }
    });
  }

  /**
   * Parse EPUB 2 NCX document
   */
  async parseNcxDocument(zip, href) {
    const ncxXml = await zip.file(href).async('string');
    const ncx = await this.parser.parseStringPromise(ncxXml);

    console.log('[EpubParser] NCX parsed structure:', JSON.stringify(ncx, null, 2).substring(0, 500));

    const toc = [];

    // With explicitRoot: false, the <ncx> root element is stripped
    // So we access navMap directly instead of ncx.navMap
    const navMap = ncx.navMap || ncx.ncx?.navMap;

    console.log('[EpubParser] navMap found:', !!navMap);

    if (navMap && navMap.navPoint) {
      console.log('[EpubParser] navPoint count:', Array.isArray(navMap.navPoint) ? navMap.navPoint.length : 1);
      this.parseNavPoints(navMap.navPoint, toc, 1);
      console.log('[EpubParser] Parsed TOC items:', toc.length);
    } else {
      console.error('[EpubParser] No navMap or navPoint found in NCX');
    }

    return toc;
  }

  /**
   * Parse NCX navPoints recursively
   */
  parseNavPoints(navPoints, result, level) {
    const points = Array.isArray(navPoints) ? navPoints : [navPoints];

    points.forEach(point => {
      const label = point.navLabel?.text || 'Untitled';
      const href = point.content?.src || '';

      const tocItem = {
        id: point.id || `nav-${level}-${result.length}`,
        label: typeof label === 'string' ? label : (label._ || 'Untitled'),
        href,
        level,
        children: []
      };

      if (point.navPoint) {
        this.parseNavPoints(point.navPoint, tocItem.children, level + 1);
      }

      result.push(tocItem);
    });
  }

  /**
   * Extract cover image
   */
  async extractCover(zip, opf, manifest) {
    try {
      // Try to find cover in metadata
      const pkg = opf.package || opf;
      const meta = pkg.metadata;
      let coverItem;

      // EPUB 3 method
      if (meta.meta) {
        const metas = Array.isArray(meta.meta) ? meta.meta : [meta.meta];
        const coverMeta = metas.find(m => m.name === 'cover');
        if (coverMeta && coverMeta.content) {
          coverItem = manifest.find(item => item.id === coverMeta.content);
        }
      }

      // EPUB 2 method
      if (!coverItem) {
        coverItem = manifest.find(item =>
          item.properties && item.properties.includes('cover-image')
        );
      }

      // Fallback: look for common cover filenames
      if (!coverItem) {
        coverItem = manifest.find(item =>
          /cover/i.test(item.href) && /image/.test(item.mediaType)
        );
      }

      if (coverItem) {
        const coverData = await zip.file(coverItem.href).async('base64');
        return `data:${coverItem.mediaType};base64,${coverData}`;
      }

      return null;
    } catch (error) {
      console.warn('[EpubParser] Could not extract cover:', error.message);
      return null;
    }
  }

  /**
   * Calculate structure statistics
   */
  calculateStructure(manifest, spine, toc) {
    const images = manifest.filter(item =>
      item.mediaType && item.mediaType.startsWith('image/')
    );

    const hasTableOfContents = toc && toc.length > 0;
    const hasCover = manifest.some(item =>
      item.properties && item.properties.includes('cover-image')
    );

    return {
      format: 'EPUB 3.0', // TODO: detect version
      chapterCount: spine.length,
      wordCount: null, // TODO: calculate from content
      imageCount: images.length,
      hasTableOfContents,
      hasCover
    };
  }

  /**
   * Extract content file
   */
  async extractContent(zip, href) {
    try {
      const content = await zip.file(href).async('string');
      return content;
    } catch (error) {
      console.error(`[EpubParser] Error extracting ${href}:`, error.message);
      return null;
    }
  }

  /**
   * Extract all content files
   */
  async extractAllContent(zip, spine) {
    const contents = [];

    for (const item of spine) {
      if (item.href) {
        const content = await this.extractContent(zip, item.href);
        if (content) {
          contents.push({
            href: item.href,
            content
          });
        }
      }
    }

    return contents;
  }
}

// Export singleton instance
module.exports = new EpubParserService();

/**
 * Capture Storage Service
 *
 * Manages persistent storage of web captures in folder structure
 * Replaces temporary ZIP-based storage with organized capture library
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class CaptureStorageService {
  constructor(baseDir) {
    this.baseDir = baseDir || path.join(process.cwd(), 'captures');
    this.indexPath = path.join(this.baseDir, 'index.json');
  }

  /**
   * Initialize storage (create directories and index)
   */
  async initialize() {
    try {
      // Create captures directory if it doesn't exist
      await fs.mkdir(this.baseDir, { recursive: true });

      // Create or load index
      try {
        await fs.access(this.indexPath);
      } catch {
        // Index doesn't exist, create it
        await this.saveIndex({
          version: '1.0',
          captures: [],
          collections: []
        });
      }

      console.log(`[CaptureStorage] Initialized at ${this.baseDir}`);
    } catch (error) {
      console.error('[CaptureStorage] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Save a new capture
   */
  async saveCapture(url, title, resources, html, options = {}) {
    const captureId = uuidv4();
    const captureDir = path.join(this.baseDir, captureId);

    try {
      // Create capture directory structure
      await fs.mkdir(captureDir, { recursive: true });
      await fs.mkdir(path.join(captureDir, 'images'), { recursive: true });
      await fs.mkdir(path.join(captureDir, 'css'), { recursive: true });
      await fs.mkdir(path.join(captureDir, 'js'), { recursive: true });
      await fs.mkdir(path.join(captureDir, 'fonts'), { recursive: true });

      // Save HTML file
      await fs.writeFile(path.join(captureDir, 'index.html'), html, 'utf8');

      // Copy resources to capture directory
      await this.copyResources(resources, captureDir);

      // Calculate total size
      const totalSize = await this.calculateDirectorySize(captureDir);

      // Create metadata
      const metadata = {
        id: captureId,
        url,
        title: title || this.extractTitle(html) || url,
        capturedAt: new Date().toISOString(),
        captureMode: options.multiPage?.enabled ? 'multi-page' : 'single-page',
        stats: {
          totalPages: options.multiPage?.enabled ? (options.pages?.length || 1) : 1,
          totalResources: this.countResources(resources),
          totalSize,
          images: (resources.images || []).length,
          stylesheets: (resources.stylesheets || []).length,
          scripts: (resources.scripts || []).length,
          fonts: (resources.fonts || []).length
        },
        tags: options.tags || [],
        notes: options.notes || '',
        collections: options.collections || [],
        thumbnail: null, // Will be generated later
        status: 'completed',
        error: null
      };

      // Save metadata
      await fs.writeFile(
        path.join(captureDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf8'
      );

      // Add to index
      await this.addToIndex(metadata);

      console.log(`[CaptureStorage] Saved capture ${captureId}`);

      return {
        id: captureId,
        metadata,
        path: captureDir
      };
    } catch (error) {
      console.error(`[CaptureStorage] Failed to save capture:`, error);
      // Cleanup on error
      try {
        await fs.rm(captureDir, { recursive: true, force: true });
      } catch {}
      throw error;
    }
  }

  /**
   * Copy downloaded resources to capture directory
   */
  async copyResources(resources, captureDir) {
    const copyResource = async (resource, subdir) => {
      if (!resource.localPath) return;

      try {
        const filename = path.basename(resource.localPath);
        const destPath = path.join(captureDir, subdir, filename);
        await fs.copyFile(resource.localPath, destPath);
      } catch (error) {
        console.warn(`[CaptureStorage] Failed to copy resource:`, error.message);
      }
    };

    // Copy images
    for (const img of resources.images || []) {
      await copyResource(img, 'images');
    }

    // Copy stylesheets
    for (const css of resources.stylesheets || []) {
      if (!css.inline) {
        await copyResource(css, 'css');
      }
    }

    // Copy scripts
    for (const js of resources.scripts || []) {
      await copyResource(js, 'js');
    }

    // Copy fonts
    for (const font of resources.fonts || []) {
      await copyResource(font, 'fonts');
    }

    // Copy favicon
    if (resources.favicon) {
      await copyResource(resources.favicon, '.');
    }
  }

  /**
   * Get all captures
   */
  async listCaptures(filters = {}) {
    const index = await this.loadIndex();
    let captures = [...index.captures];

    // Apply filters
    if (filters.tag) {
      captures = captures.filter(c => c.tags?.includes(filters.tag));
    }

    if (filters.collection) {
      captures = captures.filter(c => c.collections?.includes(filters.collection));
    }

    if (filters.search) {
      const search = filters.search.toLowerCase();
      captures = captures.filter(c =>
        c.title?.toLowerCase().includes(search) ||
        c.url?.toLowerCase().includes(search) ||
        c.notes?.toLowerCase().includes(search)
      );
    }

    // Sort
    const sortBy = filters.sort || 'date';
    const order = filters.order || 'desc';

    captures.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'date') {
        comparison = new Date(a.capturedAt) - new Date(b.capturedAt);
      } else if (sortBy === 'title') {
        comparison = (a.title || '').localeCompare(b.title || '');
      } else if (sortBy === 'size') {
        comparison = (a.stats?.totalSize || 0) - (b.stats?.totalSize || 0);
      }

      return order === 'desc' ? -comparison : comparison;
    });

    // Pagination
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    return {
      total: captures.length,
      captures: captures.slice(offset, offset + limit),
      hasMore: offset + limit < captures.length
    };
  }

  /**
   * Get capture by ID
   */
  async getCapture(id) {
    const captureDir = path.join(this.baseDir, id);

    try {
      const metadataPath = path.join(captureDir, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));

      return {
        ...metadata,
        path: captureDir
      };
    } catch (error) {
      throw new Error(`Capture not found: ${id}`);
    }
  }

  /**
   * Get capture HTML content
   */
  async getCaptureHtml(id) {
    const captureDir = path.join(this.baseDir, id);
    const htmlPath = path.join(captureDir, 'index.html');

    try {
      return await fs.readFile(htmlPath, 'utf8');
    } catch (error) {
      throw new Error(`Capture HTML not found: ${id}`);
    }
  }

  /**
   * Delete capture
   */
  async deleteCapture(id) {
    const captureDir = path.join(this.baseDir, id);

    try {
      // Remove from index first
      await this.removeFromIndex(id);

      // Delete directory
      await fs.rm(captureDir, { recursive: true, force: true });

      console.log(`[CaptureStorage] Deleted capture ${id}`);
    } catch (error) {
      console.error(`[CaptureStorage] Failed to delete capture:`, error);
      throw error;
    }
  }

  /**
   * Update capture metadata
   */
  async updateMetadata(id, updates) {
    const capture = await this.getCapture(id);

    // Update allowed fields
    const allowedFields = ['title', 'tags', 'notes', 'collections'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        capture[field] = updates[field];
      }
    }

    // Save updated metadata
    const metadataPath = path.join(capture.path, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(capture, null, 2), 'utf8');

    // Update index
    await this.updateInIndex(id, capture);

    return capture;
  }

  /**
   * Load index file
   */
  async loadIndex() {
    try {
      const data = await fs.readFile(this.indexPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return { version: '1.0', captures: [], collections: [] };
    }
  }

  /**
   * Save index file
   */
  async saveIndex(index) {
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  /**
   * Add capture to index
   */
  async addToIndex(metadata) {
    const index = await this.loadIndex();

    // Add capture summary to index
    index.captures.push({
      id: metadata.id,
      url: metadata.url,
      title: metadata.title,
      capturedAt: metadata.capturedAt,
      thumbnail: metadata.thumbnail,
      size: metadata.stats.totalSize,
      tags: metadata.tags,
      collections: metadata.collections
    });

    await this.saveIndex(index);
  }

  /**
   * Remove capture from index
   */
  async removeFromIndex(id) {
    const index = await this.loadIndex();
    index.captures = index.captures.filter(c => c.id !== id);
    await this.saveIndex(index);
  }

  /**
   * Update capture in index
   */
  async updateInIndex(id, metadata) {
    const index = await this.loadIndex();
    const idx = index.captures.findIndex(c => c.id === id);

    if (idx !== -1) {
      index.captures[idx] = {
        id: metadata.id,
        url: metadata.url,
        title: metadata.title,
        capturedAt: metadata.capturedAt,
        thumbnail: metadata.thumbnail,
        size: metadata.stats?.totalSize || 0,
        tags: metadata.tags || [],
        collections: metadata.collections || []
      };

      await this.saveIndex(index);
    }
  }

  /**
   * Helper: Calculate directory size
   */
  async calculateDirectorySize(dir) {
    let totalSize = 0;

    const calculateSize = async (currentPath) => {
      const stats = await fs.stat(currentPath);

      if (stats.isFile()) {
        totalSize += stats.size;
      } else if (stats.isDirectory()) {
        const files = await fs.readdir(currentPath);
        for (const file of files) {
          await calculateSize(path.join(currentPath, file));
        }
      }
    };

    await calculateSize(dir);
    return totalSize;
  }

  /**
   * Helper: Count total resources
   */
  countResources(resources) {
    return (
      (resources.images || []).length +
      (resources.stylesheets || []).length +
      (resources.scripts || []).length +
      (resources.fonts || []).length
    );
  }

  /**
   * Helper: Extract title from HTML
   */
  extractTitle(html) {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
  }
}

module.exports = CaptureStorageService;

/**
 * EPUB Controller
 * Handles EPUB upload and parsing endpoints
 */

const fileStorageService = require('../services/file-storage.service');
const epubParserService = require('../services/epub-parser.service');
const { validateEpubFile, validateFileId } = require('../utils/validation');

/**
 * Upload EPUB file
 * POST /api/epub-pdf/upload
 */
async function uploadEpub(req, res) {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // Validate file
    const validation = validateEpubFile(file);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid EPUB file',
        details: validation.errors
      });
    }

    // Save file
    const savedFile = await fileStorageService.saveUpload(file);

    res.json({
      success: true,
      fileId: savedFile.fileId,
      filename: savedFile.originalName,
      size: savedFile.size,
      uploadedAt: savedFile.uploadedAt
    });
  } catch (error) {
    console.error('[EpubController] Upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Parse EPUB structure
 * POST /api/epub-pdf/parse
 */
async function parseEpub(req, res) {
  try {
    const { fileId } = req.body;

    if (!validateFileId(fileId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file ID'
      });
    }

    // Get file
    const file = await fileStorageService.getFile(fileId);
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Parse EPUB
    const epubData = await epubParserService.parseEpub(file.path);

    // Return parsed data (without the zip object)
    res.json({
      success: true,
      metadata: epubData.metadata,
      structure: epubData.structure,
      tableOfContents: epubData.tableOfContents,
      spine: epubData.spine.map(item => ({
        id: item.id,
        href: item.href,
        mediaType: item.mediaType
      })),
      resources: {
        images: epubData.manifest.filter(m => m.mediaType && m.mediaType.startsWith('image/')),
        fonts: epubData.manifest.filter(m => m.mediaType && m.mediaType.includes('font')),
        stylesheets: epubData.manifest.filter(m => m.mediaType && m.mediaType.includes('css'))
      }
    });
  } catch (error) {
    console.error('[EpubController] Parse error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  uploadEpub,
  parseEpub
};

/**
 * Validation utilities for EPUB to PDF conversion
 */

const path = require('path');
const mime = require('mime-types');

/**
 * Validate uploaded EPUB file
 */
function validateEpubFile(file) {
  const errors = [];

  if (!file) {
    errors.push('No file provided');
    return { valid: false, errors };
  }

  // Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.epub') {
    errors.push('File must be an EPUB (.epub)');
  }

  // Check MIME type
  const mimeType = file.mimetype || mime.lookup(file.originalname);
  const validMimeTypes = [
    'application/epub+zip',
    'application/octet-stream',
    'application/zip'
  ];

  if (!validMimeTypes.includes(mimeType)) {
    errors.push(`Invalid MIME type: ${mimeType}`);
  }

  // Check file size (max 100MB)
  const maxSize = parseInt(process.env.MAX_FILE_SIZE || '104857600');
  if (file.size > maxSize) {
    errors.push(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB (max ${(maxSize / 1024 / 1024).toFixed(0)}MB)`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate file ID format
 */
function validateFileId(fileId) {
  if (!fileId || typeof fileId !== 'string') {
    return false;
  }

  // UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(fileId);
}

/**
 * Validate job ID format
 */
function validateJobId(jobId) {
  return validateFileId(jobId); // Same format as fileId
}

/**
 * Sanitize filename
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 255);
}

module.exports = {
  validateEpubFile,
  validateFileId,
  validateJobId,
  sanitizeFilename
};

/**
 * Upload Middleware
 * Handles file uploads using Multer
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const storageConfig = require('../../config/storage.config');

// Ensure upload directory exists
const uploadDir = storageConfig.uploadsDir;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use temp filename, will be renamed by FileStorageService
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'temp-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext !== '.epub') {
    return cb(new Error('Only EPUB files are allowed'), false);
  }

  cb(null, true);
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: storageConfig.maxFileSize, // Max file size from config
    files: 1 // Only one file at a time
  }
});

/**
 * Upload single EPUB file
 */
const uploadEpub = upload.single('epub');

/**
 * Upload middleware with error handling
 */
const uploadMiddleware = (req, res, next) => {
  uploadEpub(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // Multer error
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: `File too large. Maximum size is ${storageConfig.maxFileSize / 1024 / 1024}MB`
        });
      }

      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          error: 'Only one file can be uploaded at a time'
        });
      }

      return res.status(400).json({
        success: false,
        error: `Upload error: ${err.message}`
      });
    } else if (err) {
      // Other error
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }

    // No error, proceed
    next();
  });
};

module.exports = uploadMiddleware;

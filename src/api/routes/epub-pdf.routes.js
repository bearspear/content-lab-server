/**
 * EPUB to PDF API Routes
 */

const express = require('express');
const router = express.Router();

// Middleware
const uploadMiddleware = require('../middleware/upload.middleware');
const { asyncHandler } = require('../middleware/error-handler');
const { uploadLimiter, conversionLimiter } = require('../middleware/rate-limiter');

// Controllers
const epubController = require('../controllers/epub.controller');
const pdfController = require('../controllers/pdf.controller');

// Upload EPUB
router.post('/upload',
  // uploadLimiter, // Disabled for development
  uploadMiddleware,
  asyncHandler(epubController.uploadEpub)
);

// Parse EPUB
router.post('/parse',
  express.json(),
  asyncHandler(epubController.parseEpub)
);

// Convert to PDF
router.post('/convert',
  // conversionLimiter, // Disabled for development
  express.json(),
  asyncHandler(pdfController.convertToPdf)
);

// Preview HTML (generate HTML without PDF conversion)
router.post('/preview-html',
  express.json({ limit: '50mb' }),
  asyncHandler(pdfController.previewHtml)
);

// Convert edited HTML to PDF
router.post('/convert-html',
  express.json({ limit: '50mb' }),
  asyncHandler(pdfController.convertHtmlToPdf)
);

// Get job status
router.get('/status/:jobId',
  asyncHandler(pdfController.getJobStatus)
);

// Download PDF
router.get('/download/:jobId',
  asyncHandler(pdfController.downloadPdf)
);

// Delete job
router.delete('/job/:jobId',
  asyncHandler(pdfController.deleteJob)
);

// Get presets
router.get('/presets',
  pdfController.getPresets
);

module.exports = router;

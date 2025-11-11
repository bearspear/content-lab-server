/**
 * EPUB to PDF API Routes
 * Placeholder for EPUB to PDF conversion functionality
 */

const express = require('express');
const router = express.Router();

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'epub-pdf',
    message: 'EPUB to PDF service (not yet implemented)',
    timestamp: new Date().toISOString()
  });
});

/**
 * Placeholder for future EPUB to PDF endpoints
 */
router.post('/convert', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'EPUB to PDF conversion not yet implemented'
  });
});

module.exports = router;

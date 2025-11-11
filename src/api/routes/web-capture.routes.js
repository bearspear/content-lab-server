/**
 * Web Capture API Routes
 *
 * Endpoints for capturing webpages with multi-page support
 */

const express = require('express');
const router = express.Router();

// Middleware
const { asyncHandler } = require('../middleware/error-handler');
const {
  validateSingleCapture,
  validateMultiCapture,
  validateTestCrawl,
  validateCuratedCapture,
  validateMetadataUpdate,
  validateListParams
} = require('../middleware/validation.middleware');
// const { captureLimiter } = require('../middleware/rate-limiter'); // TODO: Add rate limiting

// Controller
const webCaptureController = require('../controllers/web-capture.controller');

/**
 * POST /api/web-capture/capture
 * Start a web capture job
 *
 * Body: {
 *   url: string,
 *   options: {
 *     inlineStyles: boolean,
 *     includePDFs: boolean,
 *     timeout: number,
 *     multiPage: {
 *       enabled: boolean,
 *       depth: number,
 *       maxPages: number,
 *       sameDomainOnly: boolean
 *     }
 *   }
 * }
 */
router.post('/capture',
  express.json(),
  validateSingleCapture,
  asyncHandler(webCaptureController.startCapture)
);

/**
 * GET /api/web-capture/status/:jobId
 * Get status and progress of a capture job
 */
router.get('/status/:jobId',
  asyncHandler(webCaptureController.getStatus)
);

/**
 * GET /api/web-capture/download/:jobId
 * Download completed ZIP archive
 */
router.get('/download/:jobId',
  asyncHandler(webCaptureController.downloadZip)
);

/**
 * DELETE /api/web-capture/job/:jobId
 * Delete a job and cleanup files
 */
router.delete('/job/:jobId',
  asyncHandler(webCaptureController.deleteJob)
);

/**
 * GET /api/web-capture/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'web-capture',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// Capture Management Endpoints (NEW)
// ============================================

/**
 * GET /api/web-capture/captures
 * List all captures with optional filtering, sorting, and pagination
 *
 * Query params:
 *   - tag: Filter by tag
 *   - collection: Filter by collection
 *   - search: Search in title, URL, notes
 *   - sort: Sort by 'date', 'title', 'size' (default: 'date')
 *   - order: 'asc' or 'desc' (default: 'desc')
 *   - limit: Number of results (default: 50)
 *   - offset: Pagination offset (default: 0)
 */
router.get('/captures',
  validateListParams,
  asyncHandler(webCaptureController.listCaptures)
);

/**
 * GET /api/web-capture/captures/:id
 * Get details of a specific capture
 */
router.get('/captures/:id',
  asyncHandler(webCaptureController.getCapture)
);

/**
 * GET /api/web-capture/captures/:id/view
 * View capture HTML in browser
 */
router.get('/captures/:id/view',
  asyncHandler(webCaptureController.viewCapture)
);

/**
 * GET /api/web-capture/captures/:id/export
 * Export capture as ZIP file
 */
router.get('/captures/:id/export',
  asyncHandler(webCaptureController.exportCapture)
);

/**
 * DELETE /api/web-capture/captures/:id
 * Delete a capture
 */
router.delete('/captures/:id',
  asyncHandler(webCaptureController.deleteCapture)
);

/**
 * PATCH /api/web-capture/captures/:id
 * Update capture metadata (title, tags, notes, collections)
 *
 * Body: {
 *   title?: string,
 *   tags?: string[],
 *   notes?: string,
 *   collections?: string[]
 * }
 */
router.patch('/captures/:id',
  express.json(),
  validateMetadataUpdate,
  asyncHandler(webCaptureController.updateCapture)
);

// ============================================
// Test Crawl Endpoints (Multi-Page Discovery)
// ============================================

/**
 * POST /api/web-capture/test-crawl
 * Start a test crawl (discovery-only, no resource downloads)
 *
 * Body: {
 *   url: string,
 *   options: {
 *     multiPage: {
 *       depth: number,
 *       maxPages: number,
 *       sameDomainOnly: boolean
 *     },
 *     timeout: number
 *   }
 * }
 */
router.post('/test-crawl',
  express.json(),
  validateTestCrawl,
  asyncHandler(webCaptureController.startTestCrawl)
);

/**
 * GET /api/web-capture/test-crawl/:crawlId
 * Get test crawl status and progress
 */
router.get('/test-crawl/:crawlId',
  asyncHandler(webCaptureController.getTestCrawlStatus)
);

/**
 * GET /api/web-capture/test-crawl/:crawlId/pages
 * Get discovered pages in hierarchical format
 */
router.get('/test-crawl/:crawlId/pages',
  asyncHandler(webCaptureController.getDiscoveredPages)
);

/**
 * POST /api/web-capture/test-crawl/:crawlId/cancel
 * Cancel a running test crawl
 */
router.post('/test-crawl/:crawlId/cancel',
  asyncHandler(webCaptureController.cancelTestCrawl)
);

/**
 * POST /api/web-capture/capture-curated
 * Capture selected pages from a completed test crawl
 *
 * Body: {
 *   crawlId: string,
 *   selectedUrls: string[],
 *   additionalUrls?: string[],
 *   excludedUrls?: string[],
 *   options?: CaptureOptions
 * }
 */
router.post('/capture-curated',
  express.json(),
  validateCuratedCapture,
  asyncHandler(webCaptureController.captureCurated)
);

// ============================================
// Multi-Page Batch Capture Endpoints
// ============================================

/**
 * POST /api/web-capture/capture-multi
 * Start immediate multi-page capture (no discovery)
 *
 * Body: {
 *   urls: string[],
 *   options?: CaptureOptions
 * }
 */
router.post('/capture-multi',
  express.json(),
  validateMultiCapture,
  asyncHandler(webCaptureController.captureMulti)
);

/**
 * GET /api/web-capture/batch/:batchId
 * Get batch job status and progress
 */
router.get('/batch/:batchId',
  asyncHandler(webCaptureController.getBatchStatus)
);

/**
 * GET /api/web-capture/batch/:batchId/download
 * Download completed batch as ZIP archive
 */
router.get('/batch/:batchId/download',
  asyncHandler(webCaptureController.downloadBatchZip)
);

/**
 * GET /api/web-capture/captures/:id/*
 * Serve static resources (images, CSS, JS, etc.) from capture directory
 * IMPORTANT: This wildcard route must be LAST to avoid catching specific routes above
 */
router.get('/captures/:id/*',
  asyncHandler(webCaptureController.serveResource)
);

module.exports = router;

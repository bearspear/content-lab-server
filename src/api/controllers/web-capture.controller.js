/**
 * Web Capture Controller
 * Handles web capture API endpoints
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const CaptureJob = require('../models/capture-job.model');
const CaptureOptions = require('../models/capture-options.model');
const BatchJob = require('../models/batch-job.model');
const WebCaptureService = require('../services/web-capture.service');
const browserManager = require('../services/browser-manager.service');
const jobQueueService = require('../services/job-queue.service');
const { getInstance: getBatchJobQueueService } = require('../services/batch-job-queue.service');
const storageConfig = require('../../config/storage.config');
const { getInstance: getTestCrawlService } = require('../services/test-crawl.service');

// Initialize web capture service (lazy - browser initialized on first use)
let webCaptureService = null;

async function getWebCaptureService() {
  if (!webCaptureService) {
    const browser = await browserManager.getBrowser();
    webCaptureService = new WebCaptureService(browser, storageConfig.tempDir);
    await webCaptureService.initialize();
  }
  return webCaptureService;
}

/**
 * Start a web capture job
 * POST /api/web-capture/capture
 */
async function startCapture(req, res) {
  try {
    const { url, options } = req.body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'URL is required and must be a string'
      });
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: 'URL must use HTTP or HTTPS protocol'
        });
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    // Validate and normalize options
    const captureOptions = new CaptureOptions(options);
    const validation = captureOptions.validate();

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid capture options',
        details: validation.errors
      });
    }

    // Create job
    const jobId = uuidv4();
    const job = new CaptureJob(jobId, url, captureOptions.toJSON());

    // Store job
    jobQueueService.addJob(job);

    console.log(`[WebCaptureController] Starting capture job ${jobId} for ${url}`);

    // Start capture async
    const service = await getWebCaptureService();
    service.captureWebpageAsync(job)
      .then(() => {
        console.log(`[WebCaptureController] Job ${jobId} completed successfully`);
      })
      .catch(error => {
        console.error(`[WebCaptureController] Job ${jobId} failed:`, error.message);
      });

    res.status(202).json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: 'Capture job created'
    });
  } catch (error) {
    console.error('[WebCaptureController] Start capture error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get job status
 * GET /api/web-capture/status/:jobId
 */
async function getStatus(req, res) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'Job ID is required'
      });
    }

    const job = jobQueueService.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      job: job.toJSON()
    });
  } catch (error) {
    console.error('[WebCaptureController] Get status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Download completed ZIP
 * GET /api/web-capture/download/:jobId
 */
async function downloadZip(req, res) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'Job ID is required'
      });
    }

    const job = jobQueueService.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    if (job.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: `Job is ${job.status}, not ready for download`
      });
    }

    if (!job.outputPath) {
      return res.status(500).json({
        success: false,
        error: 'Output file not found'
      });
    }

    // Generate filename from URL
    const urlObj = new URL(job.url);
    const hostname = urlObj.hostname.replace(/\./g, '-');
    const timestamp = new Date(job.completedAt).toISOString().split('T')[0];
    const filename = `${hostname}-${timestamp}.zip`;

    console.log(`[WebCaptureController] Downloading ZIP for job ${jobId}: ${filename}`);

    // Create temporary ZIP from capture directory
    const fs = require('fs').promises;
    const tempZipPath = path.join(storageConfig.tempDir, 'downloads', `${jobId}.zip`);
    await fs.mkdir(path.dirname(tempZipPath), { recursive: true });

    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFolder(job.outputPath);
    zip.writeZip(tempZipPath);

    console.log(`[WebCaptureController] Created temporary ZIP: ${tempZipPath}`);

    res.download(tempZipPath, filename, async (err) => {
      if (err) {
        console.error(`[WebCaptureController] Download error for job ${jobId}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download file'
          });
        }
      }

      // Cleanup temp ZIP
      try {
        await fs.unlink(tempZipPath);
        console.log(`[WebCaptureController] Cleaned up temporary ZIP: ${tempZipPath}`);
      } catch (cleanupErr) {
        console.warn(`[WebCaptureController] Failed to cleanup temp ZIP:`, cleanupErr.message);
      }
    });
  } catch (error) {
    console.error('[WebCaptureController] Download ZIP error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Delete job and cleanup files
 * DELETE /api/web-capture/job/:jobId
 */
async function deleteJob(req, res) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'Job ID is required'
      });
    }

    const job = jobQueueService.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Delete output file if exists
    if (job.outputPath) {
      const fs = require('fs').promises;
      try {
        await fs.unlink(job.outputPath);
        console.log(`[WebCaptureController] Deleted output file: ${job.outputPath}`);
      } catch (error) {
        console.warn(`[WebCaptureController] Failed to delete output file:`, error.message);
      }
    }

    // Remove job from queue
    jobQueueService.deleteJob(jobId);

    console.log(`[WebCaptureController] Deleted job ${jobId}`);

    res.json({
      success: true,
      message: 'Job deleted'
    });
  } catch (error) {
    console.error('[WebCaptureController] Delete job error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * List all captures
 * GET /api/web-capture/captures
 */
async function listCaptures(req, res) {
  try {
    const service = await getWebCaptureService();
    const filters = {
      tag: req.query.tag,
      collection: req.query.collection,
      search: req.query.search,
      sort: req.query.sort || 'date',
      order: req.query.order || 'desc',
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };

    const result = await service.captureStorage.listCaptures(filters);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[WebCaptureController] List captures error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get single capture details
 * GET /api/web-capture/captures/:id
 */
async function getCapture(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Capture ID is required'
      });
    }

    const service = await getWebCaptureService();
    const capture = await service.captureStorage.getCapture(id);

    res.json({
      success: true,
      capture
    });
  } catch (error) {
    console.error('[WebCaptureController] Get capture error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * View capture HTML
 * GET /api/web-capture/captures/:id/view
 */
async function viewCapture(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Capture ID is required'
      });
    }

    const service = await getWebCaptureService();
    const html = await service.captureStorage.getCaptureHtml(id);

    // Set headers to allow iframe embedding
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:* https://localhost:*");
    res.send(html);
  } catch (error) {
    console.error('[WebCaptureController] View capture error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Export capture to ZIP
 * GET /api/web-capture/captures/:id/export
 */
async function exportCapture(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Capture ID is required'
      });
    }

    const service = await getWebCaptureService();
    const capture = await service.captureStorage.getCapture(id);

    // Generate ZIP filename
    const urlObj = new URL(capture.url);
    const hostname = urlObj.hostname.replace(/\./g, '-');
    const timestamp = new Date(capture.capturedAt).toISOString().split('T')[0];
    const filename = `${hostname}-${timestamp}.zip`;

    // Create ZIP from capture directory
    const tempZipPath = path.join(storageConfig.tempDir, 'exports', `${id}.zip`);
    await require('fs').promises.mkdir(path.dirname(tempZipPath), { recursive: true });

    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFolder(capture.path);
    zip.writeZip(tempZipPath);

    console.log(`[WebCaptureController] Exporting capture ${id} to ZIP: ${filename}`);

    res.download(tempZipPath, filename, async (err) => {
      if (err) {
        console.error(`[WebCaptureController] Export error for capture ${id}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to export capture'
          });
        }
      }

      // Cleanup temp ZIP
      try {
        await require('fs').promises.unlink(tempZipPath);
      } catch (cleanupErr) {
        console.warn(`[WebCaptureController] Failed to cleanup temp ZIP:`, cleanupErr.message);
      }
    });
  } catch (error) {
    console.error('[WebCaptureController] Export capture error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Delete capture
 * DELETE /api/web-capture/captures/:id
 */
async function deleteCapture(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Capture ID is required'
      });
    }

    const service = await getWebCaptureService();
    await service.captureStorage.deleteCapture(id);

    console.log(`[WebCaptureController] Deleted capture ${id}`);

    res.json({
      success: true,
      message: 'Capture deleted'
    });
  } catch (error) {
    console.error('[WebCaptureController] Delete capture error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Update capture metadata
 * PATCH /api/web-capture/captures/:id
 */
async function updateCapture(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Capture ID is required'
      });
    }

    const service = await getWebCaptureService();
    const capture = await service.captureStorage.updateMetadata(id, updates);

    console.log(`[WebCaptureController] Updated capture ${id}`);

    res.json({
      success: true,
      capture
    });
  } catch (error) {
    console.error('[WebCaptureController] Update capture error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Serve static resource from capture directory
 * GET /api/web-capture/captures/:id/*
 */
async function serveResource(req, res) {
  try {
    const { id } = req.params;
    const resourcePath = req.params[0]; // The wildcard part

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Capture ID is required'
      });
    }

    if (!resourcePath) {
      return res.status(400).json({
        success: false,
        error: 'Resource path is required'
      });
    }

    const service = await getWebCaptureService();
    const capture = await service.captureStorage.getCapture(id);

    // Security: Prevent directory traversal attacks
    const normalizedPath = path.normalize(resourcePath);
    if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
      return res.status(403).json({
        success: false,
        error: 'Invalid resource path'
      });
    }

    // Construct full file path
    const filePath = path.join(capture.path, normalizedPath);

    // Verify file exists and is within capture directory
    const fs = require('fs').promises;
    try {
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) {
        return res.status(404).json({
          success: false,
          error: 'Resource not found'
        });
      }

      // Verify the resolved path is still within capture directory (double-check security)
      const resolvedPath = path.resolve(filePath);
      const resolvedCaptureDir = path.resolve(capture.path);
      if (!resolvedPath.startsWith(resolvedCaptureDir)) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          error: 'Resource not found'
        });
      }
      throw error;
    }

    // Determine MIME type
    const mime = require('mime-types');
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';

    console.log(`[WebCaptureController] Serving resource: ${resourcePath} (${mimeType})`);

    // Set appropriate headers
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    // Send file
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[WebCaptureController] Error serving resource ${resourcePath}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to serve resource'
          });
        }
      }
    });

  } catch (error) {
    console.error('[WebCaptureController] Serve resource error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Start a test crawl (discovery-only, no resource download)
 * POST /api/web-capture/test-crawl
 */
async function startTestCrawl(req, res) {
  try {
    const { url, options } = req.body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'URL is required and must be a string'
      });
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: 'URL must use HTTP or HTTPS protocol'
        });
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    console.log(`[WebCaptureController] Starting test crawl for ${url}`);

    // Start test crawl
    const testCrawlService = getTestCrawlService();
    const result = await testCrawlService.startTestCrawl(url, options);

    res.status(202).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[WebCaptureController] Start test crawl error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get test crawl status
 * GET /api/web-capture/test-crawl/:crawlId
 */
async function getTestCrawlStatus(req, res) {
  try {
    const { crawlId } = req.params;

    if (!crawlId) {
      return res.status(400).json({
        success: false,
        error: 'Crawl ID is required'
      });
    }

    const testCrawlService = getTestCrawlService();
    const status = testCrawlService.getCrawlStatus(crawlId);

    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('[WebCaptureController] Get test crawl status error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Get discovered pages in hierarchical format
 * GET /api/web-capture/test-crawl/:crawlId/pages
 */
async function getDiscoveredPages(req, res) {
  try {
    const { crawlId } = req.params;

    if (!crawlId) {
      return res.status(400).json({
        success: false,
        error: 'Crawl ID is required'
      });
    }

    const testCrawlService = getTestCrawlService();
    const pages = testCrawlService.getDiscoveredPagesHierarchical(crawlId);

    res.json({
      success: true,
      ...pages
    });
  } catch (error) {
    console.error('[WebCaptureController] Get discovered pages error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Cancel a running test crawl
 * POST /api/web-capture/test-crawl/:crawlId/cancel
 */
async function cancelTestCrawl(req, res) {
  try {
    const { crawlId } = req.params;

    if (!crawlId) {
      return res.status(400).json({
        success: false,
        error: 'Crawl ID is required'
      });
    }

    const testCrawlService = getTestCrawlService();
    const result = testCrawlService.cancelCrawl(crawlId);

    console.log(`[WebCaptureController] Cancelled test crawl ${crawlId}`);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[WebCaptureController] Cancel test crawl error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Capture curated pages from test crawl
 * POST /api/web-capture/capture-curated
 */
async function captureCurated(req, res) {
  try {
    const { crawlId, selectedUrls, additionalUrls, excludedUrls, options } = req.body;

    // Validate crawl ID
    if (!crawlId) {
      return res.status(400).json({
        success: false,
        error: 'Crawl ID is required'
      });
    }

    // Validate that at least some URLs are selected
    if (!selectedUrls || !Array.isArray(selectedUrls) || selectedUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one URL must be selected'
      });
    }

    console.log(`[WebCaptureController] Starting curated capture from crawl ${crawlId}`);
    console.log(`[WebCaptureController] Selected URLs: ${selectedUrls.length}`);

    // Get test crawl to verify it exists
    const testCrawlService = getTestCrawlService();
    const crawlStatus = testCrawlService.getCrawlStatus(crawlId);

    if (crawlStatus.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Test crawl must be completed before capturing'
      });
    }

    // Combine selected and additional URLs
    const allUrls = [...selectedUrls];
    if (additionalUrls && Array.isArray(additionalUrls)) {
      allUrls.push(...additionalUrls);
    }

    // Remove excluded URLs
    const finalUrls = excludedUrls && Array.isArray(excludedUrls)
      ? allUrls.filter(url => !excludedUrls.includes(url))
      : allUrls;

    // Remove duplicates
    const uniqueUrls = [...new Set(finalUrls)];

    console.log(`[WebCaptureController] Final URL count: ${uniqueUrls.length}`);

    // Create batch job for tracking
    const batchJob = new BatchJob(uniqueUrls, options);
    const batchJobQueueService = getBatchJobQueueService();
    batchJobQueueService.addBatch(batchJob);

    // Create capture jobs for each URL
    const captureOptions = new CaptureOptions(options);

    for (const url of uniqueUrls) {
      const jobId = uuidv4();
      const job = new CaptureJob(jobId, url, captureOptions.toJSON());
      batchJob.addJob(jobId, url);
      jobQueueService.addJob(job);

      // Start capture async with batch tracking
      const service = await getWebCaptureService();
      service.captureWebpageAsync(job)
        .then(() => {
          console.log(`[WebCaptureController] Curated capture job ${jobId} completed`);
          batchJobQueueService.updateJobStatus(batchJob.batchId, jobId, 'completed');
        })
        .catch(error => {
          console.error(`[WebCaptureController] Curated capture job ${jobId} failed:`, error.message);
          batchJobQueueService.updateJobStatus(batchJob.batchId, jobId, 'failed');
        });
    }

    res.status(202).json({
      success: true,
      message: `Started curated capture for ${uniqueUrls.length} pages from crawl ${crawlId}`,
      crawlId,
      ...batchJob.toJSON()
    });

  } catch (error) {
    console.error('[WebCaptureController] Capture curated error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: error.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * Start immediate multi-page capture
 * POST /api/web-capture/capture-multi
 */
async function captureMulti(req, res) {
  try {
    const { urls, options } = req.body;

    // Validate URLs
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'URLs array is required and must not be empty'
      });
    }

    console.log(`[WebCaptureController] Starting multi-page capture for ${urls.length} URLs`);

    // Create batch job
    const batchJob = new BatchJob(urls, options);
    const batchJobQueueService = getBatchJobQueueService();
    batchJobQueueService.addBatch(batchJob);

    // Create and start individual capture jobs
    const captureOptions = new CaptureOptions(options);

    for (const url of urls) {
      const jobId = uuidv4();
      const job = new CaptureJob(jobId, url, captureOptions.toJSON());

      // Add to batch
      batchJob.addJob(jobId, url);

      // Store job
      jobQueueService.addJob(job);

      // Start capture async
      const service = await getWebCaptureService();
      service.captureWebpageAsync(job)
        .then(() => {
          console.log(`[WebCaptureController] Batch ${batchJob.batchId} - Job ${jobId} completed`);
          batchJobQueueService.updateJobStatus(batchJob.batchId, jobId, 'completed');
        })
        .catch(error => {
          console.error(`[WebCaptureController] Batch ${batchJob.batchId} - Job ${jobId} failed:`, error.message);
          batchJobQueueService.updateJobStatus(batchJob.batchId, jobId, 'failed');
        });
    }

    res.status(202).json({
      success: true,
      ...batchJob.toJSON()
    });

  } catch (error) {
    console.error('[WebCaptureController] Capture multi error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get batch job status
 * GET /api/web-capture/batch/:batchId
 */
async function getBatchStatus(req, res) {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: 'Batch ID is required'
      });
    }

    const batchJobQueueService = getBatchJobQueueService();
    const batchJob = batchJobQueueService.getBatch(batchId);

    if (!batchJob) {
      return res.status(404).json({
        success: false,
        error: 'Batch not found'
      });
    }

    res.json({
      success: true,
      ...batchJob.toJSON()
    });

  } catch (error) {
    console.error('[WebCaptureController] Get batch status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Download batch ZIP archive
 * GET /api/web-capture/batch/:batchId/download
 */
async function downloadBatchZip(req, res) {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        error: 'Batch ID is required'
      });
    }

    const batchJobQueueService = getBatchJobQueueService();
    const batchJob = batchJobQueueService.getBatch(batchId);

    if (!batchJob) {
      return res.status(404).json({
        success: false,
        error: 'Batch not found'
      });
    }

    if (batchJob.status !== 'completed' && batchJob.status !== 'partial') {
      return res.status(400).json({
        success: false,
        error: `Batch is ${batchJob.status}, not ready for download`
      });
    }

    if (batchJob.summary.completed === 0) {
      return res.status(400).json({
        success: false,
        error: 'No completed captures in batch'
      });
    }

    console.log(`[WebCaptureController] Creating batch ZIP for ${batchId} with ${batchJob.summary.completed} captures`);

    // Generate filename
    const timestamp = new Date(batchJob.createdAt).toISOString().split('T')[0];
    const filename = `multi-page-capture-${timestamp}-${batchId.substring(0, 8)}.zip`;

    // Create temporary ZIP
    const fs = require('fs').promises;
    const tempZipPath = path.join(storageConfig.tempDir, 'downloads', `${batchId}.zip`);
    await fs.mkdir(path.dirname(tempZipPath), { recursive: true });

    const AdmZip = require('adm-zip');
    const zip = new AdmZip();

    // Add completed job captures to ZIP
    let captureCount = 0;
    for (const jobInfo of batchJob.jobs) {
      if (jobInfo.status === 'completed') {
        const job = jobQueueService.getJob(jobInfo.jobId);
        if (job && job.outputPath) {
          try {
            const urlObj = new URL(job.url);
            const hostname = urlObj.hostname.replace(/\./g, '-');
            const folderName = `${hostname}-${jobInfo.jobId.substring(0, 8)}`;

            // Add folder to ZIP with a clean name
            zip.addLocalFolder(job.outputPath, folderName);
            captureCount++;
            console.log(`[WebCaptureController] Added capture ${captureCount}: ${folderName}`);
          } catch (error) {
            console.error(`[WebCaptureController] Error adding job ${jobInfo.jobId}:`, error.message);
          }
        }
      }
    }

    // Add manifest file with batch metadata
    const manifest = {
      batchId: batchJob.batchId,
      createdAt: batchJob.createdAt,
      completedAt: batchJob.completedAt,
      totalCaptures: captureCount,
      summary: batchJob.summary,
      captures: batchJob.jobs
        .filter(j => j.status === 'completed')
        .map(j => ({
          jobId: j.jobId,
          url: j.url,
          status: j.status
        }))
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

    console.log(`[WebCaptureController] Writing ZIP with ${captureCount} captures`);
    zip.writeZip(tempZipPath);

    console.log(`[WebCaptureController] Batch ZIP created: ${tempZipPath}`);

    res.download(tempZipPath, filename, async (err) => {
      if (err) {
        console.error(`[WebCaptureController] Download error for batch ${batchId}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download file'
          });
        }
      }

      // Cleanup temporary ZIP
      try {
        await fs.unlink(tempZipPath);
        console.log(`[WebCaptureController] Cleaned up temporary ZIP: ${tempZipPath}`);
      } catch (cleanupErr) {
        console.error(`[WebCaptureController] Failed to cleanup temp ZIP:`, cleanupErr.message);
      }
    });

  } catch (error) {
    console.error('[WebCaptureController] Download batch ZIP error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  // Job endpoints (legacy)
  startCapture,
  getStatus,
  downloadZip,
  deleteJob,

  // Capture management endpoints (new)
  listCaptures,
  getCapture,
  viewCapture,
  serveResource,
  exportCapture,
  deleteCapture,
  updateCapture,

  // Test crawl endpoints (multi-page discovery)
  startTestCrawl,
  getTestCrawlStatus,
  getDiscoveredPages,
  cancelTestCrawl,
  captureCurated,

  // Multi-page batch capture
  captureMulti,
  getBatchStatus,
  downloadBatchZip
};

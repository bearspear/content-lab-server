/**
 * PDF Controller
 * Handles PDF conversion and download endpoints
 */

const fileStorageService = require('../services/file-storage.service');
const epubParserService = require('../services/epub-parser.service');
const pdfGeneratorService = require('../services/pdf-generator.service');
const jobQueueService = require('../services/job-queue.service');
const PdfConversionOptions = require('../models/pdf-options.model');
const { validateFileId, validateJobId, sanitizeFilename } = require('../utils/validation');

/**
 * Convert EPUB to PDF
 * POST /api/epub-pdf/convert
 */
async function convertToPdf(req, res) {
  try {
    const { fileId, options } = req.body;

    if (!validateFileId(fileId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file ID'
      });
    }

    // Validate options
    const pdfOptions = new PdfConversionOptions(options);
    const validation = pdfOptions.validate();

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid conversion options',
        details: validation.errors
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

    // Create job
    const job = jobQueueService.createJob(fileId, pdfOptions.toJSON());

    // Start conversion async
    convertEpubToPdfAsync(job.id, fileId, file.path, file.filename, pdfOptions);

    res.json({
      success: true,
      jobId: job.id,
      status: 'processing',
      message: 'PDF conversion started'
    });
  } catch (error) {
    console.error('[PdfController] Convert error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Async conversion function
 */
async function convertEpubToPdfAsync(jobId, fileId, filepath, filename, options) {
  const startTime = Date.now();

  try {
    // Check if can start
    if (!jobQueueService.canStartJob()) {
      jobQueueService.updateJobStatus(jobId, 'pending', 0);
      // Wait and retry
      setTimeout(() => convertEpubToPdfAsync(jobId, fileId, filepath, filename, options), 5000);
      return;
    }

    jobQueueService.startJob(jobId);

    // Step 1: Parse EPUB
    jobQueueService.updateJobStep(jobId, 'Parsing EPUB', 'in_progress');
    const stepStart = Date.now();

    const epubData = await epubParserService.parseEpub(filepath);

    const parseTime = (Date.now() - stepStart) / 1000;
    jobQueueService.updateJobStep(jobId, 'Parsing EPUB', 'completed', parseTime);
    jobQueueService.updateJobStatus(jobId, 'extracting', 15);

    // Step 2: Extract content
    jobQueueService.updateJobStep(jobId, 'Extracting content', 'in_progress');
    const extractStart = Date.now();

    // Content is already in epubData from parser

    const extractTime = (Date.now() - extractStart) / 1000;
    jobQueueService.updateJobStep(jobId, 'Extracting content', 'completed', extractTime);
    jobQueueService.updateJobStatus(jobId, 'rendering', 25);

    // Step 3: Generate PDF
    jobQueueService.updateJobStep(jobId, 'Generating pages', 'in_progress');
    const generateStart = Date.now();

    const pdfBuffer = await pdfGeneratorService.generatePdf(
      epubData,
      options,
      (step, progress) => {
        jobQueueService.updateJobStatus(jobId, 'rendering', progress);
      }
    );

    const generateTime = (Date.now() - generateStart) / 1000;
    jobQueueService.updateJobStep(jobId, 'Generating pages', 'completed', generateTime);
    jobQueueService.updateJobStatus(jobId, 'optimizing', 90);

    // Step 4: Save output
    jobQueueService.updateJobStep(jobId, 'Optimizing PDF', 'in_progress');
    const saveStart = Date.now();

    const outputFilename = filename.replace('.epub', '.pdf');
    const output = await fileStorageService.saveOutput(jobId, outputFilename, pdfBuffer);

    const saveTime = (Date.now() - saveStart) / 1000;
    jobQueueService.updateJobStep(jobId, 'Optimizing PDF', 'completed', saveTime);

    // Complete job
    jobQueueService.completeJob(jobId, output.path);

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`[PdfController] Converted ${filename} to PDF in ${totalTime.toFixed(2)}s`);

  } catch (error) {
    console.error('[PdfController] Async conversion error:', error);
    jobQueueService.failJob(jobId, error.message);
  }
}

/**
 * Get job status
 * GET /api/epub-pdf/status/:jobId
 */
async function getJobStatus(req, res) {
  try {
    const { jobId } = req.params;

    if (!validateJobId(jobId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid job ID'
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
      ...job.toJSON()
    });
  } catch (error) {
    console.error('[PdfController] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Download PDF
 * GET /api/epub-pdf/download/:jobId
 */
async function downloadPdf(req, res) {
  try {
    const { jobId } = req.params;

    if (!validateJobId(jobId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid job ID'
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
        error: 'PDF not ready yet',
        status: job.status
      });
    }

    const output = await fileStorageService.getOutput(jobId);

    if (!output) {
      return res.status(404).json({
        success: false,
        error: 'PDF file not found'
      });
    }

    // Send file
    res.download(output.path, output.filename, (err) => {
      if (err) {
        console.error('[PdfController] Download error:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download PDF'
          });
        }
      }
    });
  } catch (error) {
    console.error('[PdfController] Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Delete job and files
 * DELETE /api/epub-pdf/job/:jobId
 */
async function deleteJob(req, res) {
  try {
    const { jobId } = req.params;

    if (!validateJobId(jobId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid job ID'
      });
    }

    const job = jobQueueService.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Delete files
    await fileStorageService.deleteJobFiles(jobId, job.fileId);

    // Delete job
    jobQueueService.deleteJob(jobId);

    res.json({
      success: true,
      message: 'Job and associated files deleted'
    });
  } catch (error) {
    console.error('[PdfController] Delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get presets
 * GET /api/epub-pdf/presets
 */
function getPresets(req, res) {
  try {
    const { getAllPresets } = require('../../config/presets.config');
    const presets = getAllPresets();

    res.json({
      success: true,
      presets
    });
  } catch (error) {
    console.error('[PdfController] Presets error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Generate HTML preview without PDF conversion
 * POST /api/epub-pdf/preview-html
 */
async function previewHtml(req, res) {
  try {
    const { fileId, options } = req.body;

    if (!validateFileId(fileId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file ID'
      });
    }

    // Validate options
    const pdfOptions = new PdfConversionOptions(options);
    const validation = pdfOptions.validate();

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid conversion options',
        details: validation.errors
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

    // Generate HTML only (no PDF conversion)
    const html = await pdfGeneratorService.buildHtmlDocument(epubData, pdfOptions.toJSON());

    res.json({
      success: true,
      html,
      metadata: epubData.metadata,
      fileId
    });
  } catch (error) {
    console.error('[PdfController] Preview HTML error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Convert edited HTML to PDF
 * POST /api/epub-pdf/convert-html
 */
async function convertHtmlToPdf(req, res) {
  try {
    const { html, options, fileId } = req.body;

    if (!html) {
      return res.status(400).json({
        success: false,
        error: 'HTML content is required'
      });
    }

    if (!validateFileId(fileId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file ID'
      });
    }

    // Validate options
    const pdfOptions = new PdfConversionOptions(options);
    const validation = pdfOptions.validate();

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid conversion options',
        details: validation.errors
      });
    }

    // Get file for metadata
    const file = await fileStorageService.getFile(fileId);
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Parse EPUB for metadata and structure
    const epubData = await epubParserService.parseEpub(file.path);

    // Create job
    const job = jobQueueService.createJob(fileId, pdfOptions.toJSON());

    // Start conversion async with the edited HTML
    convertHtmlToPdfAsync(job.id, fileId, file.filename, html, epubData, pdfOptions);

    res.json({
      success: true,
      jobId: job.id,
      status: 'processing',
      message: 'PDF conversion started'
    });
  } catch (error) {
    console.error('[PdfController] Convert HTML error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Async conversion function for edited HTML
 */
async function convertHtmlToPdfAsync(jobId, fileId, filename, html, epubData, options) {
  const startTime = Date.now();

  try {
    // Check if can start
    if (!jobQueueService.canStartJob()) {
      jobQueueService.updateJobStatus(jobId, 'pending', 0);
      // Wait and retry
      setTimeout(() => convertHtmlToPdfAsync(jobId, fileId, filename, html, epubData, options), 5000);
      return;
    }

    jobQueueService.startJob(jobId);

    // Initialize browser
    await pdfGeneratorService.init();

    // Step 1: Convert HTML to PDF
    jobQueueService.updateJobStep(jobId, 'Converting HTML to PDF', 'in_progress');
    jobQueueService.updateJobStatus(jobId, 'converting', 30);

    const pdfBuffer = await pdfGeneratorService.renderToPdf(
      html,
      options.toJSON(),
      (message, progress) => {
        jobQueueService.updateJobStatus(jobId, 'converting', progress);
      }
    );

    const convertTime = (Date.now() - startTime) / 1000;
    jobQueueService.updateJobStep(jobId, 'Converting HTML to PDF', 'completed', convertTime);

    // Step 2: Enhance PDF with bookmarks
    jobQueueService.updateJobStep(jobId, 'Adding bookmarks', 'in_progress');
    jobQueueService.updateJobStatus(jobId, 'enhancing', 85);

    const enhanceStart = Date.now();
    const finalPdf = await pdfGeneratorService.enhancePdf(pdfBuffer, epubData, options.toJSON());

    const enhanceTime = (Date.now() - enhanceStart) / 1000;
    jobQueueService.updateJobStep(jobId, 'Adding bookmarks', 'completed', enhanceTime);

    // Step 3: Save PDF
    jobQueueService.updateJobStatus(jobId, 'saving', 95);

    const outputFilename = sanitizeFilename(filename.replace(/\.epub$/i, '.pdf'));
    await fileStorageService.saveOutput(jobId, outputFilename, finalPdf);

    // Complete job
    const totalTime = (Date.now() - startTime) / 1000;
    jobQueueService.completeJob(jobId, totalTime);

    console.log(`[PdfController] Conversion completed in ${totalTime.toFixed(2)}s`);
  } catch (error) {
    console.error('[PdfController] Async conversion error:', error);
    jobQueueService.failJob(jobId, error.message);
  }
}

module.exports = {
  convertToPdf,
  getJobStatus,
  downloadPdf,
  deleteJob,
  getPresets,
  previewHtml,
  convertHtmlToPdf
};

#!/usr/bin/env node

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const path = require('path');

// Import API routes
const epubPdfRoutes = require('./src/api/routes/epub-pdf.routes');
const proxyRoutes = require('./src/api/routes/proxy.routes');
const webCaptureRoutes = require('./src/api/routes/web-capture.routes');
const { errorHandler, notFoundHandler } = require('./src/api/middleware/error-handler');
const { apiLimiter } = require('./src/api/middleware/rate-limiter');
const { getInstance: getCleanupService } = require('./src/api/services/cleanup.service');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Middleware
app.use(compression()); // Enable GZIP compression
app.use(cors()); // Enable CORS

// API routes (before static file serving)
app.use('/api/epub-pdf', /* apiLimiter, */ epubPdfRoutes); // Rate limiter disabled for development
app.use('/api/proxy', proxyRoutes); // Proxy for API tester (bypasses CORS)
app.use('/api/web-capture', webCaptureRoutes); // Web page capture with multi-page support

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Serve static files from the 'public' directory
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath, {
  maxAge: '1y', // Cache static assets for 1 year
  etag: true,
  fallthrough: true // Continue to next middleware if file not found
}));

// SPA fallback: serve index.html for all non-file routes
// This allows Angular routing to work properly
app.get('*', (req, res) => {
  // Check if the request is for a file (has extension)
  const requestedPath = req.path;
  const hasExtension = path.extname(requestedPath) !== '';

  // If it's a file request that wasn't found by static middleware, return 404
  if (hasExtension) {
    return res.status(404).send('File not found');
  }

  // Otherwise, serve index.html for Angular routing
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Start server
app.listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║                                                        ║');
  console.log('║              Content Lab Server                        ║');
  console.log('║       EPUB to PDF & Web Capture APIs Enabled           ║');
  console.log('║                                                        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  🚀 Server running at: ${url}`);
  console.log(`  📚 EPUB to PDF API: ${url}/api/epub-pdf`);
  console.log(`  🌐 Web Capture API: ${url}/api/web-capture`);
  console.log(`  🔄 API Proxy (CORS): ${url}/api/proxy`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');

  // Start cleanup service (runs every hour)
  const cleanupService = getCleanupService();
  cleanupService.start(60 * 60 * 1000); // 1 hour interval
  console.log('  🧹 Cleanup service started (runs hourly)');
  console.log('');

  // Auto-open browser using dynamic import
  try {
    const open = (await import('open')).default;
    await open(url);
  } catch (error) {
    console.log('  (Could not auto-open browser)');
  }
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n\n  👋 Shutting down gracefully...');

  // Close PDF generator browser if running
  try {
    const pdfGenerator = require('./src/api/services/pdf-generator.service');
    await pdfGenerator.close();
  } catch (error) {
    // Ignore
  }

  // Close web capture browser if running
  try {
    const browserManager = require('./src/api/services/browser-manager.service');
    await browserManager.close();
  } catch (error) {
    // Ignore
  }

  console.log('  ✓ Cleanup complete\n');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

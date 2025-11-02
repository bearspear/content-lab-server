#!/usr/bin/env node

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Import API routes
const epubPdfRoutes = require('./src/api/routes/epub-pdf.routes');
const { errorHandler, notFoundHandler } = require('./src/api/middleware/error-handler');
const { apiLimiter } = require('./src/api/middleware/rate-limiter');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline styles for Angular
  crossOriginEmbedderPolicy: false
}));

// Middleware
app.use(compression()); // Enable GZIP compression
app.use(cors()); // Enable CORS

// API routes (before static file serving)
app.use('/api/epub-pdf', /* apiLimiter, */ epubPdfRoutes); // Rate limiter disabled for development

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

// SPA fallback: serve index.html for all non-API, non-file routes
// This allows Angular routing to work properly
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return notFoundHandler(req, res);
  }

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

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║                                                        ║');
  console.log('║              Content Lab Server                        ║');
  console.log('║          EPUB to PDF API Enabled                       ║');
  console.log('║                                                        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  🚀 Server running at: ${url}`);
  console.log(`  📚 API endpoint: ${url}/api/epub-pdf`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
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

  console.log('  ✓ Cleanup complete\n');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

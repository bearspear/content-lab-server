const express = require('express');
const router = express.Router();
const proxyController = require('../controllers/proxy.controller');

// Enable JSON parsing for this route
router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * @route   POST /api/proxy
 * @desc    Forward an HTTP request through the proxy to bypass CORS
 * @access  Public
 */
router.post('/', proxyController.proxyRequest.bind(proxyController));

/**
 * @route   GET /api/proxy/health
 * @desc    Health check for proxy service
 * @access  Public
 */
router.get('/health', proxyController.healthCheck.bind(proxyController));

module.exports = router;

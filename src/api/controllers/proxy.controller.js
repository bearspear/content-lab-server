const proxyService = require('../services/proxy.service');

/**
 * Proxy Controller - Handle API proxy requests
 */
class ProxyController {
  /**
   * Forward an HTTP request through the proxy
   * POST /api/proxy
   */
  async proxyRequest(req, res) {
    try {
      const { method, url, headers, body, timeout } = req.body;

      // Validation
      if (!method || !url) {
        return res.status(400).json({
          success: false,
          error: {
            type: 'validation',
            message: 'Method and URL are required'
          }
        });
      }

      // Validate URL
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          success: false,
          error: {
            type: 'validation',
            message: 'Invalid URL format'
          }
        });
      }

      // Forward the request
      const response = await proxyService.forwardRequest({
        method,
        url,
        headers,
        body,
        timeout
      });

      // Return the proxied response
      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      // Handle proxy errors
      if (error.type) {
        return res.status(502).json({
          success: false,
          error: {
            type: error.type,
            message: error.message,
            timestamp: new Date().toISOString()
          }
        });
      }

      // Unknown errors
      console.error('Proxy error:', error);
      res.status(500).json({
        success: false,
        error: {
          type: 'unknown',
          message: 'An error occurred while proxying the request',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  /**
   * Health check for proxy endpoint
   * GET /api/proxy/health
   */
  async healthCheck(req, res) {
    res.json({
      success: true,
      status: 'healthy',
      service: 'proxy',
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = new ProxyController();

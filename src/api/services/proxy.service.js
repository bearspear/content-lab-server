const axios = require('axios');
const https = require('https');

/**
 * Proxy Service - Forward HTTP requests to bypass CORS
 */
class ProxyService {
  /**
   * Forward an HTTP request to the target URL
   * @param {Object} requestData - The request configuration
   * @returns {Promise<Object>} - The proxied response
   */
  async forwardRequest(requestData) {
    const { method, url, headers, body, timeout } = requestData;

    try {
      const startTime = Date.now();

      // Build axios config
      const config = {
        method: method.toLowerCase(),
        url: url,
        headers: this.cleanHeaders(headers),
        timeout: timeout || 30000, // 30 second default timeout
        validateStatus: () => true, // Don't throw on any status code
        maxRedirects: 5,
        // Handle different content types
        transformResponse: [(data) => data], // Keep response as-is (string or buffer)
        // Disable SSL certificate verification for development
        // NOTE: In production, you should use proper SSL certificates
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      };

      // Add body for methods that support it
      if (body && ['post', 'put', 'patch'].includes(method.toLowerCase())) {
        config.data = body;
      }

      // Make the request
      const response = await axios(config);
      const endTime = Date.now();

      // Calculate response size
      const responseSize = response.data
        ? Buffer.byteLength(JSON.stringify(response.data), 'utf8')
        : 0;

      // Build response object
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: this.parseResponseBody(response.data, response.headers['content-type']),
        responseTime: endTime - startTime,
        size: responseSize,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Handle errors
      if (error.code === 'ECONNABORTED') {
        throw {
          type: 'timeout',
          message: `Request timeout after ${timeout || 30000}ms`
        };
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw {
          type: 'network',
          message: `Network error: ${error.message}`
        };
      } else if (error.response) {
        // Server responded with error status
        const startTime = Date.now();
        const endTime = Date.now();

        return {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          body: this.parseResponseBody(error.response.data, error.response.headers['content-type']),
          responseTime: endTime - startTime,
          size: Buffer.byteLength(JSON.stringify(error.response.data || ''), 'utf8'),
          timestamp: new Date().toISOString()
        };
      } else {
        throw {
          type: 'unknown',
          message: error.message || 'An unknown error occurred'
        };
      }
    }
  }

  /**
   * Clean and filter headers
   * Remove headers that shouldn't be forwarded
   */
  cleanHeaders(headers) {
    if (!headers || typeof headers !== 'object') {
      return {};
    }

    const cleaned = {};
    const skipHeaders = [
      'host',
      'connection',
      'origin',
      'referer',
      'sec-fetch-mode',
      'sec-fetch-site',
      'sec-fetch-dest',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform'
    ];

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (!skipHeaders.includes(lowerKey) && value) {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }

  /**
   * Parse response body based on content type
   */
  parseResponseBody(data, contentType) {
    if (!data) return null;

    // If already an object, return as-is
    if (typeof data === 'object' && !Buffer.isBuffer(data)) {
      return data;
    }

    // Try to parse JSON
    if (contentType && contentType.includes('application/json')) {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }

    // For text responses, return as string
    if (contentType && (
      contentType.includes('text/') ||
      contentType.includes('application/xml') ||
      contentType.includes('application/javascript')
    )) {
      return data.toString();
    }

    // For binary data, convert to base64
    if (Buffer.isBuffer(data)) {
      return {
        type: 'binary',
        data: data.toString('base64'),
        contentType: contentType
      };
    }

    // Default: return as-is
    return data;
  }
}

module.exports = new ProxyService();

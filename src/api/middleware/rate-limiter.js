/**
 * Rate Limiter Middleware
 * Provides API-level rate limiting using express-rate-limit
 */

const rateLimit = require('express-rate-limit');

/**
 * API Rate Limiter
 * Limits requests per IP address
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

/**
 * Capture Rate Limiter
 * More strict limits for resource-intensive capture operations
 */
const captureLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 capture requests per minute
  message: {
    success: false,
    error: 'Too many capture requests, please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  captureLimiter
};

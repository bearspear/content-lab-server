/**
 * Rate Limiter Middleware
 * Limits API requests per IP to prevent abuse
 */

const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // Max requests per window (increased for dev)
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Upload rate limiter (more strict)
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Max 50 uploads per 15 minutes (increased for dev)
  message: {
    success: false,
    error: 'Too many uploads from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Conversion rate limiter
 */
const conversionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Max 50 conversions per 15 minutes (increased for dev)
  message: {
    success: false,
    error: 'Too many conversion requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  uploadLimiter,
  conversionLimiter
};

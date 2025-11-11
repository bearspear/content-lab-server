/**
 * Error Handler Middleware
 * Handles errors and provides consistent error responses
 */

/**
 * Async Handler Wrapper
 * Wraps async route handlers to catch errors and pass them to error middleware
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not Found Handler
 * Handles 404 errors for undefined routes
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl
  });
}

/**
 * Global Error Handler
 * Handles all errors passed via next(error)
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging
  console.error('[Error Handler]', err);

  // Default to 500 Internal Server Error
  const statusCode = err.statusCode || err.status || 500;

  // Prepare error response
  const response = {
    success: false,
    error: err.message || 'Internal Server Error'
  };

  // Add details if available (from ValidationError)
  if (err.details) {
    response.details = err.details;
  }

  // Add stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = {
  asyncHandler,
  notFoundHandler,
  errorHandler
};

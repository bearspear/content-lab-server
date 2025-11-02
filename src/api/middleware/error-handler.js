/**
 * Error Handler Middleware
 * Centralized error handling for the API
 */

/**
 * Global error handler
 */
function errorHandler(err, req, res, next) {
  console.error('[Error]', err);

  // Default error response
  const response = {
    success: false,
    error: err.message || 'Internal server error'
  };

  // Determine status code
  let statusCode = err.statusCode || err.status || 500;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    response.error = 'Validation error';
    response.details = err.details || err.message;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    response.error = 'Unauthorized';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    response.error = 'Resource not found';
  } else if (err.code === 'ENOENT') {
    statusCode = 404;
    response.error = 'File not found';
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    response.error = 'Internal server error';
    delete response.stack;
  } else {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * 404 handler
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path
  });
}

/**
 * Async handler wrapper
 * Catches errors from async route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler
};

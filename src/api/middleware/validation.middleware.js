/**
 * Request Validation Middleware
 * Validates and sanitizes incoming requests for web capture endpoints
 */

const { URL } = require('url');

/**
 * Validation Error Class
 */
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

/**
 * Validate URL format and protocol
 */
function validateUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new ValidationError('URL is required and must be a string');
  }

  // Trim whitespace
  urlString = urlString.trim();

  if (!urlString) {
    throw new ValidationError('URL cannot be empty');
  }

  // Check length (reasonable limit)
  if (urlString.length > 2048) {
    throw new ValidationError('URL is too long (max 2048 characters)');
  }

  // Try to parse URL
  let parsedUrl;
  try {
    parsedUrl = new URL(urlString);
  } catch (error) {
    throw new ValidationError('Invalid URL format', error.message);
  }

  // Only allow HTTP/HTTPS
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ValidationError('Only HTTP and HTTPS protocols are supported');
  }

  // Reject localhost/internal IPs in production
  if (process.env.NODE_ENV === 'production') {
    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedHosts = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '169.254.169.254' // AWS metadata endpoint
    ];

    if (blockedHosts.includes(hostname) || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
      throw new ValidationError('Cannot capture internal/localhost URLs in production');
    }
  }

  return parsedUrl.href; // Return normalized URL
}

/**
 * Validate capture options
 */
function validateCaptureOptions(options = {}) {
  const validated = {};

  // Validate timeout
  if (options.timeout !== undefined) {
    const timeout = parseInt(options.timeout);
    if (isNaN(timeout) || timeout < 1000 || timeout > 300000) {
      throw new ValidationError('Timeout must be between 1000ms and 300000ms (5 minutes)');
    }
    validated.timeout = timeout;
  }

  // Validate boolean flags
  ['inlineStyles', 'includePDFs'].forEach(flag => {
    if (options[flag] !== undefined) {
      if (typeof options[flag] !== 'boolean') {
        throw new ValidationError(`${flag} must be a boolean value`);
      }
      validated[flag] = options[flag];
    }
  });

  // Validate multiPage options
  if (options.multiPage) {
    if (typeof options.multiPage !== 'object') {
      throw new ValidationError('multiPage must be an object');
    }

    validated.multiPage = {};

    if (options.multiPage.enabled !== undefined) {
      if (typeof options.multiPage.enabled !== 'boolean') {
        throw new ValidationError('multiPage.enabled must be a boolean');
      }
      validated.multiPage.enabled = options.multiPage.enabled;
    }

    if (options.multiPage.depth !== undefined) {
      const depth = parseInt(options.multiPage.depth);
      if (isNaN(depth) || depth < 0 || depth > 5) {
        throw new ValidationError('multiPage.depth must be between 0 and 5');
      }
      validated.multiPage.depth = depth;
    }

    if (options.multiPage.maxPages !== undefined) {
      const maxPages = parseInt(options.multiPage.maxPages);
      if (isNaN(maxPages) || maxPages < 1 || maxPages > 100) {
        throw new ValidationError('multiPage.maxPages must be between 1 and 100');
      }
      validated.multiPage.maxPages = maxPages;
    }

    if (options.multiPage.sameDomainOnly !== undefined) {
      if (typeof options.multiPage.sameDomainOnly !== 'boolean') {
        throw new ValidationError('multiPage.sameDomainOnly must be a boolean');
      }
      validated.multiPage.sameDomainOnly = options.multiPage.sameDomainOnly;
    }
  }

  return validated;
}

/**
 * Validate array of URLs
 */
function validateUrlArray(urls, options = {}) {
  const { maxUrls = 50, minUrls = 1 } = options;

  if (!Array.isArray(urls)) {
    throw new ValidationError('URLs must be an array');
  }

  if (urls.length < minUrls) {
    throw new ValidationError(`At least ${minUrls} URL(s) required`);
  }

  if (urls.length > maxUrls) {
    throw new ValidationError(`Too many URLs (max ${maxUrls})`);
  }

  // Validate each URL
  const validatedUrls = [];
  const errors = [];

  urls.forEach((url, index) => {
    try {
      validatedUrls.push(validateUrl(url));
    } catch (error) {
      errors.push(`URL ${index + 1}: ${error.message}`);
    }
  });

  if (errors.length > 0) {
    throw new ValidationError('URL validation failed', errors);
  }

  // Check for duplicates
  const uniqueUrls = [...new Set(validatedUrls)];
  if (uniqueUrls.length !== validatedUrls.length) {
    throw new ValidationError('Duplicate URLs are not allowed');
  }

  return validatedUrls;
}

/**
 * Validate metadata fields
 */
function validateMetadata(metadata = {}) {
  const validated = {};

  if (metadata.title !== undefined) {
    if (typeof metadata.title !== 'string') {
      throw new ValidationError('Title must be a string');
    }
    if (metadata.title.length > 500) {
      throw new ValidationError('Title is too long (max 500 characters)');
    }
    validated.title = metadata.title.trim();
  }

  if (metadata.notes !== undefined) {
    if (typeof metadata.notes !== 'string') {
      throw new ValidationError('Notes must be a string');
    }
    if (metadata.notes.length > 5000) {
      throw new ValidationError('Notes are too long (max 5000 characters)');
    }
    validated.notes = metadata.notes.trim();
  }

  if (metadata.tags !== undefined) {
    if (!Array.isArray(metadata.tags)) {
      throw new ValidationError('Tags must be an array');
    }
    if (metadata.tags.length > 50) {
      throw new ValidationError('Too many tags (max 50)');
    }
    validated.tags = metadata.tags.map(tag => {
      if (typeof tag !== 'string') {
        throw new ValidationError('Each tag must be a string');
      }
      if (tag.length > 50) {
        throw new ValidationError('Tag is too long (max 50 characters)');
      }
      return tag.trim();
    }).filter(tag => tag.length > 0);
  }

  if (metadata.collections !== undefined) {
    if (!Array.isArray(metadata.collections)) {
      throw new ValidationError('Collections must be an array');
    }
    if (metadata.collections.length > 20) {
      throw new ValidationError('Too many collections (max 20)');
    }
    validated.collections = metadata.collections.map(collection => {
      if (typeof collection !== 'string') {
        throw new ValidationError('Each collection must be a string');
      }
      if (collection.length > 100) {
        throw new ValidationError('Collection name is too long (max 100 characters)');
      }
      return collection.trim();
    }).filter(collection => collection.length > 0);
  }

  return validated;
}

/**
 * Validate pagination parameters
 */
function validatePagination(query = {}) {
  const validated = {};

  if (query.limit !== undefined) {
    const limit = parseInt(query.limit);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be between 1 and 100');
    }
    validated.limit = limit;
  }

  if (query.offset !== undefined) {
    const offset = parseInt(query.offset);
    if (isNaN(offset) || offset < 0) {
      throw new ValidationError('Offset must be a non-negative number');
    }
    validated.offset = offset;
  }

  return validated;
}

/**
 * Validate sort parameters
 */
function validateSort(query = {}, allowedFields = ['date', 'title', 'size']) {
  const validated = {};

  if (query.sort !== undefined) {
    if (!allowedFields.includes(query.sort)) {
      throw new ValidationError(`Sort field must be one of: ${allowedFields.join(', ')}`);
    }
    validated.sort = query.sort;
  }

  if (query.order !== undefined) {
    if (!['asc', 'desc'].includes(query.order)) {
      throw new ValidationError('Order must be "asc" or "desc"');
    }
    validated.order = query.order;
  }

  return validated;
}

/**
 * Middleware: Validate single capture request
 */
function validateSingleCapture(req, res, next) {
  try {
    const { url, options } = req.body;

    // Validate URL
    req.validatedUrl = validateUrl(url);

    // Validate options
    req.validatedOptions = validateCaptureOptions(options || {});

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware: Validate multi-capture request
 */
function validateMultiCapture(req, res, next) {
  try {
    const { urls, options } = req.body;

    // Validate URLs array
    req.validatedUrls = validateUrlArray(urls, { maxUrls: 50, minUrls: 1 });

    // Validate options
    req.validatedOptions = validateCaptureOptions(options || {});

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware: Validate test crawl request
 */
function validateTestCrawl(req, res, next) {
  try {
    const { url, options } = req.body;

    // Validate URL
    req.validatedUrl = validateUrl(url);

    // Validate options (with required multiPage settings)
    const validatedOptions = validateCaptureOptions(options || {});

    if (!validatedOptions.multiPage) {
      throw new ValidationError('multiPage options are required for test crawl');
    }

    req.validatedOptions = validatedOptions;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware: Validate curated capture request
 */
function validateCuratedCapture(req, res, next) {
  try {
    const { crawlId, selectedUrls, additionalUrls, excludedUrls, options } = req.body;

    // Validate crawl ID
    if (!crawlId || typeof crawlId !== 'string') {
      throw new ValidationError('Crawl ID is required');
    }
    req.validatedCrawlId = crawlId.trim();

    // Validate selected URLs
    if (selectedUrls) {
      req.validatedSelectedUrls = validateUrlArray(selectedUrls, { maxUrls: 100, minUrls: 0 });
    }

    // Validate additional URLs
    if (additionalUrls) {
      req.validatedAdditionalUrls = validateUrlArray(additionalUrls, { maxUrls: 50, minUrls: 0 });
    }

    // Validate excluded URLs
    if (excludedUrls) {
      req.validatedExcludedUrls = validateUrlArray(excludedUrls, { maxUrls: 100, minUrls: 0 });
    }

    // Must have at least selectedUrls or additionalUrls
    if (!selectedUrls?.length && !additionalUrls?.length) {
      throw new ValidationError('At least one URL must be selected or added');
    }

    // Validate options
    req.validatedOptions = validateCaptureOptions(options || {});

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware: Validate metadata update request
 */
function validateMetadataUpdate(req, res, next) {
  try {
    // Validate at least one field is being updated
    const allowedFields = ['title', 'tags', 'notes', 'collections'];
    const hasUpdate = allowedFields.some(field => req.body[field] !== undefined);

    if (!hasUpdate) {
      throw new ValidationError('At least one metadata field must be provided');
    }

    // Validate metadata
    req.validatedMetadata = validateMetadata(req.body);

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware: Validate list/search parameters
 */
function validateListParams(req, res, next) {
  try {
    const validated = {};

    // Validate pagination
    Object.assign(validated, validatePagination(req.query));

    // Validate sorting
    Object.assign(validated, validateSort(req.query, ['date', 'title', 'size']));

    // Validate search string
    if (req.query.search !== undefined) {
      if (typeof req.query.search !== 'string') {
        throw new ValidationError('Search must be a string');
      }
      if (req.query.search.length > 200) {
        throw new ValidationError('Search query is too long (max 200 characters)');
      }
      validated.search = req.query.search.trim();
    }

    // Validate tag filter
    if (req.query.tag !== undefined) {
      if (typeof req.query.tag !== 'string') {
        throw new ValidationError('Tag filter must be a string');
      }
      if (req.query.tag.length > 50) {
        throw new ValidationError('Tag filter is too long (max 50 characters)');
      }
      validated.tag = req.query.tag.trim();
    }

    // Validate collection filter
    if (req.query.collection !== undefined) {
      if (typeof req.query.collection !== 'string') {
        throw new ValidationError('Collection filter must be a string');
      }
      if (req.query.collection.length > 100) {
        throw new ValidationError('Collection filter is too long (max 100 characters)');
      }
      validated.collection = req.query.collection.trim();
    }

    req.validatedParams = validated;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  ValidationError,
  validateUrl,
  validateCaptureOptions,
  validateUrlArray,
  validateMetadata,
  validatePagination,
  validateSort,
  validateSingleCapture,
  validateMultiCapture,
  validateTestCrawl,
  validateCuratedCapture,
  validateMetadataUpdate,
  validateListParams
};

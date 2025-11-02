/**
 * Puppeteer Configuration
 * Settings for headless Chrome PDF generation
 */

const config = {
  // Launch options
  launch: {
    headless: process.env.PUPPETEER_HEADLESS !== 'false',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions'
    ],
    // Use system Chrome if available (faster than bundled Chromium)
    executablePath: process.env.CHROME_PATH || undefined,
    // Increase protocol timeout for large/complex PDFs (5 minutes)
    protocolTimeout: 300000
  },

  // Default viewport - Higher resolution for better quality
  viewport: {
    width: 794,  // A4 width at 96 DPI
    height: 1123, // A4 height at 96 DPI
    deviceScaleFactor: 2  // 2x for Retina/high-DPI displays
  },

  // Page settings
  page: {
    timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '120000'), // 2 minutes
  },

  // PDF generation defaults
  pdf: {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: false,
    margin: {
      top: '25mm',
      right: '20mm',
      bottom: '25mm',
      left: '20mm'
    }
  },

  /**
   * Get page dimensions for different formats
   */
  getPageDimensions(format, orientation = 'portrait') {
    const dimensions = {
      'A4': { width: 210, height: 297 },
      'A5': { width: 148, height: 210 },
      'Letter': { width: 215.9, height: 279.4 },
      'Legal': { width: 215.9, height: 355.6 }
    };

    let dim = dimensions[format] || dimensions.A4;

    if (orientation === 'landscape') {
      dim = { width: dim.height, height: dim.width };
    }

    return dim;
  },

  /**
   * Convert DPI to scale factor
   */
  getScaleFactor(dpi) {
    const baseDpi = 96;
    return dpi / baseDpi;
  }
};

module.exports = config;

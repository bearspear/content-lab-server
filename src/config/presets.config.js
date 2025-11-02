/**
 * PDF Conversion Presets
 * Predefined configurations for common use cases
 */

const presets = {
  'ereader': {
    id: 'ereader',
    name: 'E-Reader Optimized',
    description: 'Optimized for e-readers with larger text and margins',
    icon: '📱',
    options: {
      pageSettings: {
        size: 'A5',
        orientation: 'portrait',
        margins: { top: 15, right: 12, bottom: 15, left: 12 }
      },
      typography: {
        fontFamily: 'Literata',
        fontSize: 14,
        lineHeight: 1.8,
        textAlign: 'left',
        hyphenation: false
      },
      layout: {
        columns: 1,
        chapterPageBreaks: true,
        includeImages: true,
        imageQuality: 'medium',
        preserveCss: true
      },
      headerFooter: {
        includeHeader: false,
        includeFooter: true,
        footerContent: 'pageNumber'
      },
      tableOfContents: {
        generateBookmarks: true,
        includePrintedToc: true,
        tocDepth: 2
      },
      quality: {
        dpi: 150,
        compression: 'medium',
        embedFonts: true,
        fontSubsetting: true
      }
    }
  },

  'print': {
    id: 'print',
    name: 'Print Quality',
    description: 'High DPI, proper margins, justified text for printing',
    icon: '📄',
    options: {
      pageSettings: {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 25, right: 20, bottom: 25, left: 20 }
      },
      typography: {
        fontFamily: 'Literata',
        fontSize: 11,
        lineHeight: 1.6,
        textAlign: 'justify',
        hyphenation: true
      },
      layout: {
        columns: 1,
        chapterPageBreaks: true,
        includeImages: true,
        imageQuality: 'high',
        preserveCss: true
      },
      headerFooter: {
        includeHeader: true,
        headerContent: 'chapter',
        includeFooter: true,
        footerContent: 'pageNumber'
      },
      tableOfContents: {
        generateBookmarks: true,
        includePrintedToc: true,
        tocDepth: 3
      },
      quality: {
        dpi: 300,
        compression: 'low',
        embedFonts: true,
        fontSubsetting: true,
        colorSpace: 'CMYK'
      }
    }
  },

  'academic': {
    id: 'academic',
    name: 'Academic',
    description: 'Two-column layout for academic papers and documents',
    icon: '📘',
    options: {
      pageSettings: {
        size: 'Letter',
        orientation: 'portrait',
        margins: { top: 25, right: 20, bottom: 25, left: 20 }
      },
      typography: {
        fontFamily: 'Literata',
        fontSize: 10,
        lineHeight: 1.5,
        textAlign: 'justify',
        hyphenation: true
      },
      layout: {
        columns: 2,
        columnGap: 15,
        chapterPageBreaks: true,
        includeImages: true,
        imageQuality: 'high',
        preserveCss: true
      },
      headerFooter: {
        includeHeader: true,
        headerContent: 'title',
        includeFooter: true,
        footerContent: 'pageNumber'
      },
      tableOfContents: {
        generateBookmarks: true,
        includePrintedToc: true,
        tocDepth: 4
      },
      quality: {
        dpi: 300,
        compression: 'low',
        embedFonts: true,
        fontSubsetting: true
      }
    }
  },

  'quick': {
    id: 'quick',
    name: 'Quick Convert',
    description: 'Fast conversion with basic formatting',
    icon: '⚡',
    options: {
      pageSettings: {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 20, right: 15, bottom: 20, left: 15 }
      },
      typography: {
        fontFamily: 'Inter',
        fontSize: 12,
        lineHeight: 1.5,
        textAlign: 'left',
        hyphenation: false
      },
      layout: {
        columns: 1,
        chapterPageBreaks: false,
        includeImages: true,
        imageQuality: 'medium',
        preserveCss: false
      },
      headerFooter: {
        includeHeader: false,
        includeFooter: true,
        footerContent: 'pageNumber'
      },
      tableOfContents: {
        generateBookmarks: true,
        includePrintedToc: false,
        tocDepth: 2
      },
      quality: {
        dpi: 72,
        compression: 'high',
        embedFonts: true,
        fontSubsetting: true
      }
    }
  },

  'custom': {
    id: 'custom',
    name: 'Custom',
    description: 'Full manual control over all settings',
    icon: '🎨',
    options: {
      pageSettings: {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 25, right: 20, bottom: 25, left: 20 }
      },
      typography: {
        fontFamily: 'Literata',
        fontSize: 12,
        lineHeight: 1.6,
        textAlign: 'justify',
        hyphenation: true
      },
      layout: {
        columns: 1,
        chapterPageBreaks: true,
        includeImages: true,
        imageQuality: 'high',
        preserveCss: true
      },
      headerFooter: {
        includeHeader: true,
        headerContent: 'title',
        includeFooter: true,
        footerContent: 'pageNumber'
      },
      tableOfContents: {
        generateBookmarks: true,
        includePrintedToc: true,
        tocDepth: 3
      },
      quality: {
        dpi: 150,
        compression: 'medium',
        embedFonts: true,
        fontSubsetting: true
      }
    }
  }
};

/**
 * Get all presets as array
 */
function getAllPresets() {
  return Object.values(presets);
}

/**
 * Get preset by ID
 */
function getPreset(id) {
  return presets[id] || null;
}

module.exports = {
  presets,
  getAllPresets,
  getPreset
};

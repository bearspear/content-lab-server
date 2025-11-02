/**
 * PDF Conversion Options Model
 * Defines all configurable options for PDF generation
 */

class PdfConversionOptions {
  constructor(data = {}) {
    this.pageSettings = {
      size: data.pageSettings?.size || 'A4',
      customWidth: data.pageSettings?.customWidth || null,
      customHeight: data.pageSettings?.customHeight || null,
      orientation: data.pageSettings?.orientation || 'portrait',
      margins: {
        top: data.pageSettings?.margins?.top || 25,
        right: data.pageSettings?.margins?.right || 20,
        bottom: data.pageSettings?.margins?.bottom || 25,
        left: data.pageSettings?.margins?.left || 20
      },
      unit: data.pageSettings?.unit || 'mm'
    };

    this.typography = {
      fontFamily: data.typography?.fontFamily || 'Literata',
      fontSize: data.typography?.fontSize || 12,
      lineHeight: data.typography?.lineHeight || 1.6,
      textAlign: data.typography?.textAlign || 'justify',
      hyphenation: data.typography?.hyphenation !== false,
      paragraphSpacing: data.typography?.paragraphSpacing || 8,
      indentFirstLine: data.typography?.indentFirstLine !== false
    };

    this.layout = {
      columns: data.layout?.columns || 1,
      columnGap: data.layout?.columnGap || 20,
      chapterPageBreaks: data.layout?.chapterPageBreaks !== false,
      includeImages: data.layout?.includeImages !== false,
      imageQuality: data.layout?.imageQuality || 'high',
      imageMaxWidth: data.layout?.imageMaxWidth || 100,
      preserveCss: data.layout?.preserveCss !== false
    };

    this.headerFooter = {
      includeHeader: data.headerFooter?.includeHeader || false,
      headerContent: data.headerFooter?.headerContent || 'title',
      headerCustomText: data.headerFooter?.headerCustomText || null,
      headerAlignment: data.headerFooter?.headerAlignment || 'center',
      includeFooter: data.headerFooter?.includeFooter !== false,
      footerContent: data.headerFooter?.footerContent || 'pageNumber',
      footerCustomText: data.headerFooter?.footerCustomText || null,
      footerAlignment: data.headerFooter?.footerAlignment || 'center',
      startPageNumber: data.headerFooter?.startPageNumber || 1
    };

    this.tableOfContents = {
      generateBookmarks: data.tableOfContents?.generateBookmarks !== false,
      includePrintedToc: data.tableOfContents?.includePrintedToc !== false,
      tocDepth: data.tableOfContents?.tocDepth || 3,
      tocPageNumbers: data.tableOfContents?.tocPageNumbers !== false,
      tocTitle: data.tableOfContents?.tocTitle || 'Table of Contents'
    };

    this.quality = {
      dpi: data.quality?.dpi || 150,
      compression: data.quality?.compression || 'medium',
      embedFonts: data.quality?.embedFonts !== false,
      fontSubsetting: data.quality?.fontSubsetting !== false,
      pdfVersion: data.quality?.pdfVersion || '1.7',
      pdfA: data.quality?.pdfA || false,
      colorSpace: data.quality?.colorSpace || 'RGB'
    };

    this.metadata = data.metadata || null;
  }

  /**
   * Validate options
   */
  validate() {
    const errors = [];

    // Validate page size
    const validSizes = ['A4', 'Letter', 'Legal', 'A5', 'Custom'];
    if (!validSizes.includes(this.pageSettings.size)) {
      errors.push(`Invalid page size: ${this.pageSettings.size}`);
    }

    // Validate DPI
    const validDpi = [72, 150, 300, 600];
    if (!validDpi.includes(this.quality.dpi)) {
      errors.push(`Invalid DPI: ${this.quality.dpi}`);
    }

    // Validate TOC depth
    if (this.tableOfContents.tocDepth < 1 || this.tableOfContents.tocDepth > 6) {
      errors.push(`Invalid TOC depth: ${this.tableOfContents.tocDepth}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      pageSettings: this.pageSettings,
      typography: this.typography,
      layout: this.layout,
      headerFooter: this.headerFooter,
      tableOfContents: this.tableOfContents,
      quality: this.quality,
      metadata: this.metadata
    };
  }
}

module.exports = PdfConversionOptions;

/**
 * EPUB Metadata Model
 * Represents metadata extracted from an EPUB file
 */

class EpubMetadata {
  constructor(data = {}) {
    this.title = data.title || 'Untitled';
    this.author = Array.isArray(data.author) ? data.author : [data.author || 'Unknown Author'];
    this.publisher = data.publisher || null;
    this.language = data.language || 'en';
    this.isbn = data.isbn || null;
    this.publicationDate = data.publicationDate || null;
    this.description = data.description || null;
    this.cover = data.cover || null;
    this.rights = data.rights || null;
    this.identifier = data.identifier || null;
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      title: this.title,
      author: this.author,
      publisher: this.publisher,
      language: this.language,
      isbn: this.isbn,
      publicationDate: this.publicationDate,
      description: this.description,
      cover: this.cover,
      rights: this.rights,
      identifier: this.identifier
    };
  }
}

module.exports = EpubMetadata;

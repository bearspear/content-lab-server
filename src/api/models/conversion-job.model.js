/**
 * Conversion Job Model
 * Tracks the state of an EPUB to PDF conversion job
 */

class ConversionJob {
  constructor(id, fileId, options = {}) {
    this.id = id;
    this.fileId = fileId;
    this.options = options;
    this.status = 'pending';
    this.progress = 0;
    this.currentStep = 'Initializing';
    this.totalPages = null;
    this.processedPages = null;
    this.startedAt = new Date();
    this.completedAt = null;
    this.error = null;
    this.outputPath = null;
    this.steps = [
      { name: 'Parsing EPUB', status: 'pending', time: null },
      { name: 'Extracting content', status: 'pending', time: null },
      { name: 'Processing styles', status: 'pending', time: null },
      { name: 'Generating pages', status: 'pending', time: null },
      { name: 'Creating bookmarks', status: 'pending', time: null },
      { name: 'Optimizing PDF', status: 'pending', time: null }
    ];
  }

  /**
   * Update job status
   */
  updateStatus(status, progress = null) {
    this.status = status;
    if (progress !== null) {
      this.progress = Math.min(100, Math.max(0, progress));
    }
  }

  /**
   * Update current step
   */
  updateStep(stepName, status = 'in_progress', time = null) {
    this.currentStep = stepName;
    const step = this.steps.find(s => s.name === stepName);
    if (step) {
      step.status = status;
      if (time !== null) {
        step.time = time;
      }
    }
  }

  /**
   * Mark job as completed
   */
  complete(outputPath) {
    this.status = 'completed';
    this.progress = 100;
    this.completedAt = new Date();
    this.outputPath = outputPath;
    this.steps.forEach(step => {
      if (step.status !== 'completed') {
        step.status = 'completed';
      }
    });
  }

  /**
   * Mark job as failed
   */
  fail(error) {
    this.status = 'failed';
    this.error = error;
    this.completedAt = new Date();
    const currentStepIndex = this.steps.findIndex(s => s.name === this.currentStep);
    if (currentStepIndex >= 0) {
      this.steps[currentStepIndex].status = 'failed';
      this.steps[currentStepIndex].error = error;
    }
  }

  /**
   * Get elapsed time in seconds
   */
  getElapsedTime() {
    const endTime = this.completedAt || new Date();
    return Math.floor((endTime - this.startedAt) / 1000);
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      id: this.id,
      fileId: this.fileId,
      status: this.status,
      progress: this.progress,
      currentStep: this.currentStep,
      totalPages: this.totalPages,
      processedPages: this.processedPages,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      error: this.error,
      outputPath: this.outputPath,
      steps: this.steps,
      elapsedTime: this.getElapsedTime()
    };
  }
}

module.exports = ConversionJob;

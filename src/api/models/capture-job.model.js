/**
 * Capture Job Model
 *
 * Represents a web capture job with status tracking
 */

class CaptureJob {
  constructor(id, url, options) {
    this.id = id;
    this.url = url;
    this.options = options;
    this.status = 'pending'; // pending, processing, completed, failed
    this.progress = 0; // 0-100
    this.currentStep = 'Initializing';
    this.startedAt = Date.now();
    this.completedAt = null;
    this.error = null;
    this.outputPath = null; // Path to generated ZIP file
    this.steps = [];
    this.stats = {
      pagesProcessed: 0,
      totalPages: 0,
      resourcesDownloaded: 0,
      totalResources: 0,
      succeeded: {
        images: 0,
        stylesheets: 0,
        scripts: 0,
        fonts: 0,
        pdfs: 0
      },
      failed: {
        images: [],
        stylesheets: [],
        scripts: [],
        fonts: [],
        pdfs: []
      }
    };
  }

  /**
   * Update job progress
   */
  updateProgress(step, progress) {
    this.currentStep = step;
    this.progress = Math.min(100, Math.max(0, progress));

    // Track step completion
    const existingStep = this.steps.find(s => s.name === step);
    if (existingStep) {
      existingStep.status = 'in_progress';
    } else {
      this.steps.push({
        name: step,
        status: 'in_progress',
        startedAt: Date.now(),
        completedAt: null
      });
    }
  }

  /**
   * Complete a step
   */
  completeStep(step) {
    const existingStep = this.steps.find(s => s.name === step);
    if (existingStep) {
      existingStep.status = 'completed';
      existingStep.completedAt = Date.now();
    }
  }

  /**
   * Mark job as completed
   */
  complete(outputPath) {
    this.status = 'completed';
    this.progress = 100;
    this.currentStep = 'Completed';
    this.completedAt = Date.now();
    this.outputPath = outputPath;

    // Complete all steps
    this.steps.forEach(step => {
      if (step.status === 'in_progress') {
        step.status = 'completed';
        step.completedAt = Date.now();
      }
    });
  }

  /**
   * Mark job as failed
   */
  fail(error) {
    this.status = 'failed';
    this.currentStep = 'Failed';
    this.completedAt = Date.now();
    this.error = error.message || String(error);

    // Mark current step as failed
    const currentStep = this.steps.find(s => s.status === 'in_progress');
    if (currentStep) {
      currentStep.status = 'failed';
      currentStep.completedAt = Date.now();
    }
  }

  /**
   * Get job summary for API response
   */
  toJSON() {
    return {
      id: this.id,
      url: this.url,
      status: this.status,
      progress: this.progress,
      currentStep: this.currentStep,
      startedAt: new Date(this.startedAt).toISOString(),
      completedAt: this.completedAt ? new Date(this.completedAt).toISOString() : null,
      error: this.error,
      steps: this.steps,
      stats: this.stats,
      estimatedCompletion: this.getEstimatedCompletion()
    };
  }

  /**
   * Estimate completion time based on progress
   */
  getEstimatedCompletion() {
    if (this.status === 'completed' || this.status === 'failed') {
      return null;
    }

    if (this.progress === 0) {
      return null;
    }

    const elapsed = Date.now() - this.startedAt;
    const estimatedTotal = (elapsed / this.progress) * 100;
    const remaining = estimatedTotal - elapsed;

    return new Date(Date.now() + remaining).toISOString();
  }
}

module.exports = CaptureJob;

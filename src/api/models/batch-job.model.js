/**
 * Batch Job Model
 *
 * Tracks multiple related capture jobs as a single batch
 * Used for multi-page captures
 */

const crypto = require('crypto');

class BatchJob {
  constructor(urls, options = {}) {
    this.batchId = `batch_${crypto.randomBytes(8).toString('hex')}`;
    this.urls = urls; // Array of URLs to capture
    this.options = options;
    this.status = 'pending'; // 'pending' | 'in_progress' | 'completed' | 'failed' | 'partial'
    this.progress = 0; // 0-100
    this.createdAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.jobs = []; // Array of { jobId, url, status }
    this.summary = {
      total: urls.length,
      completed: 0,
      failed: 0,
      pending: urls.length
    };
    this.error = null;
  }

  /**
   * Add a job to this batch
   */
  addJob(jobId, url) {
    this.jobs.push({
      jobId,
      url,
      status: 'pending',
      createdAt: new Date()
    });
  }

  /**
   * Update job status within batch
   */
  updateJobStatus(jobId, status) {
    const job = this.jobs.find(j => j.jobId === jobId);
    if (job) {
      job.status = status;
      job.updatedAt = new Date();

      // Update summary
      this.summary.completed = this.jobs.filter(j => j.status === 'completed').length;
      this.summary.failed = this.jobs.filter(j => j.status === 'failed').length;
      this.summary.pending = this.jobs.filter(j => j.status === 'pending' || j.status === 'processing').length;

      // Update progress
      this.progress = Math.round((this.summary.completed / this.summary.total) * 100);

      // Update batch status
      this.updateBatchStatus();
    }
  }

  /**
   * Update overall batch status based on job statuses
   */
  updateBatchStatus() {
    const allCompleted = this.summary.completed === this.summary.total;
    const allFailed = this.summary.failed === this.summary.total;
    const someCompleted = this.summary.completed > 0;
    const someFailed = this.summary.failed > 0;
    const noPending = this.summary.pending === 0;

    if (allCompleted) {
      this.status = 'completed';
      this.completedAt = new Date();
    } else if (allFailed) {
      this.status = 'failed';
      this.completedAt = new Date();
    } else if (noPending && someCompleted && someFailed) {
      this.status = 'partial';
      this.completedAt = new Date();
    } else if (someCompleted || someFailed) {
      this.status = 'in_progress';
      if (!this.startedAt) {
        this.startedAt = new Date();
      }
    }
  }

  /**
   * Mark batch as failed
   */
  fail(error) {
    this.status = 'failed';
    this.completedAt = new Date();
    this.error = error.message || 'Unknown error';
  }

  /**
   * Get batch summary for API response
   */
  toJSON() {
    return {
      batchId: this.batchId,
      status: this.status,
      progress: this.progress,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      summary: this.summary,
      jobs: this.jobs,
      error: this.error
    };
  }

  /**
   * Get completed job IDs
   */
  getCompletedJobIds() {
    return this.jobs
      .filter(j => j.status === 'completed')
      .map(j => j.jobId);
  }

  /**
   * Get failed job IDs
   */
  getFailedJobIds() {
    return this.jobs
      .filter(j => j.status === 'failed')
      .map(j => j.jobId);
  }
}

module.exports = BatchJob;

/**
 * Batch Job Queue Service
 *
 * Manages batch jobs for multi-page captures
 */

class BatchJobQueueService {
  constructor() {
    this.batches = new Map(); // batchId -> BatchJob
  }

  /**
   * Add a batch job
   */
  addBatch(batchJob) {
    this.batches.set(batchJob.batchId, batchJob);
    console.log(`[BatchJobQueue] Added batch ${batchJob.batchId} with ${batchJob.urls.length} URLs`);
    return batchJob;
  }

  /**
   * Get batch by ID
   */
  getBatch(batchId) {
    return this.batches.get(batchId);
  }

  /**
   * Update job status within a batch
   */
  updateJobStatus(batchId, jobId, status) {
    const batch = this.batches.get(batchId);
    if (batch) {
      batch.updateJobStatus(jobId, status);
      console.log(`[BatchJobQueue] Updated job ${jobId} in batch ${batchId}: ${status}`);
    }
  }

  /**
   * Get all batches
   */
  getAllBatches() {
    return Array.from(this.batches.values());
  }

  /**
   * Delete batch
   */
  deleteBatch(batchId) {
    const deleted = this.batches.delete(batchId);
    if (deleted) {
      console.log(`[BatchJobQueue] Deleted batch ${batchId}`);
    }
    return deleted;
  }

  /**
   * Cleanup old completed/failed batches
   */
  cleanup(maxAge = 3600000) { // Default: 1 hour
    const now = Date.now();
    const toDelete = [];

    for (const [batchId, batch] of this.batches.entries()) {
      if (batch.completedAt) {
        const age = now - batch.completedAt.getTime();
        if (age > maxAge) {
          toDelete.push(batchId);
        }
      }
    }

    toDelete.forEach(batchId => this.batches.delete(batchId));

    if (toDelete.length > 0) {
      console.log(`[BatchJobQueue] Cleaned up ${toDelete.length} old batches`);
    }

    return { cleaned: toDelete.length };
  }

  /**
   * Get batch statistics
   */
  getStats() {
    const batches = Array.from(this.batches.values());
    return {
      total: batches.length,
      pending: batches.filter(b => b.status === 'pending').length,
      inProgress: batches.filter(b => b.status === 'in_progress').length,
      completed: batches.filter(b => b.status === 'completed').length,
      failed: batches.filter(b => b.status === 'failed').length,
      partial: batches.filter(b => b.status === 'partial').length
    };
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getInstance: () => {
    if (!instance) {
      instance = new BatchJobQueueService();
    }
    return instance;
  },
  BatchJobQueueService
};

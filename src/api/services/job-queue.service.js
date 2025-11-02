/**
 * Job Queue Service
 * Manages conversion jobs and their state
 */

const { v4: uuidv4 } = require('uuid');
const ConversionJob = require('../models/conversion-job.model');

class JobQueueService {
  constructor() {
    this.jobs = new Map(); // jobId -> ConversionJob
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_JOBS || '3');
    this.running = 0;
  }

  /**
   * Create a new conversion job
   */
  createJob(fileId, options) {
    const jobId = uuidv4();
    const job = new ConversionJob(jobId, fileId, options);

    this.jobs.set(jobId, job);

    console.log(`[JobQueue] Created job ${jobId} for file ${fileId}`);

    return job;
  }

  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Update job status
   */
  updateJobStatus(jobId, status, progress = null) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.updateStatus(status, progress);

    return true;
  }

  /**
   * Update job step
   */
  updateJobStep(jobId, stepName, status = 'in_progress', time = null) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.updateStep(stepName, status, time);

    return true;
  }

  /**
   * Complete a job
   */
  completeJob(jobId, outputPath) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.complete(outputPath);
    this.running = Math.max(0, this.running - 1);

    console.log(`[JobQueue] Completed job ${jobId} in ${job.getElapsedTime()}s`);

    return true;
  }

  /**
   * Fail a job
   */
  failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.fail(error);
    this.running = Math.max(0, this.running - 1);

    console.error(`[JobQueue] Failed job ${jobId}:`, error);

    return true;
  }

  /**
   * Delete a job
   */
  deleteJob(jobId) {
    const deleted = this.jobs.delete(jobId);

    if (deleted) {
      console.log(`[JobQueue] Deleted job ${jobId}`);
    }

    return deleted;
  }

  /**
   * Check if can start new job
   */
  canStartJob() {
    return this.running < this.maxConcurrent;
  }

  /**
   * Mark job as started
   */
  startJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    this.running++;
    job.updateStatus('parsing', 0);

    console.log(`[JobQueue] Started job ${jobId} (${this.running}/${this.maxConcurrent} running)`);

    return true;
  }

  /**
   * Get all jobs
   */
  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * Get running jobs
   */
  getRunningJobs() {
    return Array.from(this.jobs.values()).filter(
      job => job.status !== 'completed' && job.status !== 'failed'
    );
  }

  /**
   * Get job statistics
   */
  getStatistics() {
    const all = this.getAllJobs();
    const completed = all.filter(j => j.status === 'completed').length;
    const failed = all.filter(j => j.status === 'failed').length;
    const pending = all.filter(j => j.status === 'pending').length;

    return {
      total: all.length,
      running: this.running,
      completed,
      failed,
      pending,
      maxConcurrent: this.maxConcurrent
    };
  }

  /**
   * Cleanup old completed/failed jobs
   */
  cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) { // 24 hours
    const now = Date.now();
    let cleaned = 0;

    for (const [jobId, job] of this.jobs) {
      const isOld = job.completedAt && (now - job.completedAt.getTime()) > maxAge;
      const isFinished = job.status === 'completed' || job.status === 'failed';

      if (isOld && isFinished) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[JobQueue] Cleaned up ${cleaned} old jobs`);
    }

    return cleaned;
  }
}

// Export singleton instance
module.exports = new JobQueueService();

const cron = require('node-cron');
const { createLogger } = require('../logger');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_LIMIT = 1000;
const DAILY_MIDNIGHT = '0 0 * * *';

// Job states purged to keep the queue bounded. Completed jobs are the main
// driver of unbounded growth — BullMQ retains them indefinitely by default —
// so they are purged after a short grace. Failed jobs are kept longer for
// inspection but still purged eventually.
const CLEANUP_TARGETS = Object.freeze([
  { type: 'completed', grace: ONE_DAY_MS },
  { type: 'failed', grace: SEVEN_DAYS_MS }
]);

/**
 * Remove jobs of a single state older than `grace`, in a bounded batch.
 * `queue.clean` performs the batched delete (at most `limit` jobs per call).
 * Emits an audit log line before and after the purge.
 */
async function cleanJobsByType(queue, type, options = {}) {
  const logger = options.logger || createLogger();
  const grace = options.grace !== undefined ? options.grace : SEVEN_DAYS_MS;
  const limit = options.limit !== undefined ? options.limit : CLEANUP_BATCH_LIMIT;

  logger.info({ queue: queue.name, type, graceMs: grace, limit }, 'queue cleanup started');

  const removed = await queue.clean(grace, limit, type);
  const count = Array.isArray(removed) ? removed.length : 0;

  logger.info({ queue: queue.name, type, removed: count }, 'queue cleanup completed');

  return removed;
}

/**
 * Purge stale failed jobs. Retained for backwards compatibility and direct use.
 */
async function cleanFailedJobs(queue, options = {}) {
  return cleanJobsByType(queue, 'failed', options);
}

/**
 * Purge stale completed jobs — the primary defence against unbounded queue
 * growth in a high-throughput relayer.
 */
async function cleanCompletedJobs(queue, options = {}) {
  const grace = options.grace !== undefined ? options.grace : ONE_DAY_MS;
  return cleanJobsByType(queue, 'completed', { ...options, grace });
}

/**
 * Purge every configured stale job state (completed + failed by default),
 * each with its own grace period, and return an audited summary of how many
 * jobs were removed per state.
 */
async function cleanStaleJobs(queue, options = {}) {
  const logger = options.logger || createLogger();
  const targets = options.targets || CLEANUP_TARGETS;
  const limit = options.limit !== undefined ? options.limit : CLEANUP_BATCH_LIMIT;

  const summary = { total: 0 };

  for (const target of targets) {
    const grace = options.grace !== undefined ? options.grace : target.grace;
    const removed = await cleanJobsByType(queue, target.type, { logger, grace, limit });
    const count = Array.isArray(removed) ? removed.length : 0;
    summary[target.type] = count;
    summary.total += count;
  }

  logger.info({ queue: queue.name, ...summary }, 'queue cleanup summary');

  return summary;
}

/**
 * Schedule a cron job that purges stale completed and failed jobs. Cleanup
 * failures are logged and swallowed so one bad run never crashes the worker.
 */
function createCleanupJob(queue, options = {}) {
  const logger = options.logger || createLogger();
  const schedule = options.schedule || DAILY_MIDNIGHT;
  const timezone = options.timezone || 'UTC';

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression: ${schedule}`);
  }

  const task = cron.schedule(
    schedule,
    async () => {
      try {
        await cleanStaleJobs(queue, {
          logger,
          grace: options.grace,
          limit: options.limit,
          targets: options.targets
        });
      } catch (error) {
        logger.error({ queue: queue.name, error: error.message }, 'queue cleanup failed');
      }
    },
    { scheduled: false, timezone }
  );

  return task;
}

module.exports = {
  ONE_DAY_MS,
  SEVEN_DAYS_MS,
  CLEANUP_BATCH_LIMIT,
  CLEANUP_TARGETS,
  cleanJobsByType,
  cleanFailedJobs,
  cleanCompletedJobs,
  cleanStaleJobs,
  createCleanupJob
};

const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const {
  cleanFailedJobs,
  cleanCompletedJobs,
  cleanStaleJobs,
  createCleanupJob,
  ONE_DAY_MS,
  SEVEN_DAYS_MS,
  CLEANUP_BATCH_LIMIT
} = require('../src/queue/cleanup');

function makeQueue(removedIds = ['job-1', 'job-2']) {
  return {
    name: 'test-queue',
    clean: async (grace, limit, type) => removedIds
  };
}

function makeLogger() {
  const calls = [];
  return {
    _calls: calls,
    info: (data, msg) => calls.push({ level: 'info', data, msg }),
    error: (data, msg) => calls.push({ level: 'error', data, msg })
  };
}

test('cleanFailedJobs removes failed jobs older than 7 days', async () => {
  const queue = makeQueue(['job-1', 'job-2', 'job-3']);
  const logger = makeLogger();

  const removed = await cleanFailedJobs(queue, { logger });

  assert.deepEqual(removed, ['job-1', 'job-2', 'job-3']);
  assert.equal(logger._calls.filter(c => c.level === 'info').length, 2);
  assert.match(logger._calls[0].msg, /started/);
  assert.match(logger._calls[1].msg, /completed/);
  assert.equal(logger._calls[1].data.removed, 3);
});

test('cleanFailedJobs passes correct grace period and limit to queue.clean', async () => {
  const calls = [];
  const queue = {
    name: 'test-queue',
    clean: async (grace, limit, type) => {
      calls.push({ grace, limit, type });
      return [];
    }
  };

  await cleanFailedJobs(queue, { logger: makeLogger() });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].grace, SEVEN_DAYS_MS);
  assert.equal(calls[0].limit, CLEANUP_BATCH_LIMIT);
  assert.equal(calls[0].type, 'failed');
});

test('cleanFailedJobs accepts custom grace and limit overrides', async () => {
  const calls = [];
  const queue = {
    name: 'test-queue',
    clean: async (grace, limit, type) => {
      calls.push({ grace, limit, type });
      return [];
    }
  };

  await cleanFailedJobs(queue, { logger: makeLogger(), grace: 1000, limit: 50 });

  assert.equal(calls[0].grace, 1000);
  assert.equal(calls[0].limit, 50);
});

test('cleanFailedJobs logs an error when queue.clean throws', async () => {
  const queue = {
    name: 'test-queue',
    clean: async () => { throw new Error('Redis unavailable'); }
  };
  const logger = makeLogger();

  await assert.rejects(
    () => cleanFailedJobs(queue, { logger }),
    /Redis unavailable/
  );
});

test('createCleanupJob returns a task with start/stop methods', () => {
  const queue = makeQueue();
  const task = createCleanupJob(queue, { logger: makeLogger() });

  assert.equal(typeof task.start, 'function');
  assert.equal(typeof task.stop, 'function');

  task.stop();
});

test('createCleanupJob rejects invalid cron expressions', () => {
  assert.throws(
    () => createCleanupJob(makeQueue(), { logger: makeLogger(), schedule: 'not-a-cron' }),
    /Invalid cron expression/
  );
});

test('createCleanupJob logs error without throwing when cleanup fails mid-run', async () => {
  const failingQueue = {
    name: 'fail-queue',
    clean: async () => { throw new Error('timeout'); }
  };
  const logger = makeLogger();

  const task = createCleanupJob(failingQueue, { logger, schedule: '* * * * * *' });
  task.start();

  await new Promise(resolve => setTimeout(resolve, 1100));
  task.stop();

  const errorLogs = logger._calls.filter(c => c.level === 'error');
  assert.ok(errorLogs.length >= 1, 'expected at least one error log');
  assert.match(errorLogs[0].data.error, /timeout/);
});

test('cleanCompletedJobs purges completed jobs with a one-day default grace', async () => {
  const calls = [];
  const queue = {
    name: 'test-queue',
    clean: async (grace, limit, type) => {
      calls.push({ grace, limit, type });
      return ['c-1', 'c-2'];
    }
  };

  const removed = await cleanCompletedJobs(queue, { logger: makeLogger() });

  assert.deepEqual(removed, ['c-1', 'c-2']);
  assert.equal(calls[0].type, 'completed');
  assert.equal(calls[0].grace, ONE_DAY_MS);
  assert.equal(calls[0].limit, CLEANUP_BATCH_LIMIT);
});

test('cleanStaleJobs purges completed and failed jobs with per-state grace periods', async () => {
  const calls = [];
  const removedByType = { completed: ['c-1', 'c-2', 'c-3'], failed: ['f-1'] };
  const queue = {
    name: 'test-queue',
    clean: async (grace, limit, type) => {
      calls.push({ grace, limit, type });
      return removedByType[type] || [];
    }
  };

  const summary = await cleanStaleJobs(queue, { logger: makeLogger() });

  assert.deepEqual(calls.map(c => c.type), ['completed', 'failed']);
  assert.equal(calls.find(c => c.type === 'completed').grace, ONE_DAY_MS);
  assert.equal(calls.find(c => c.type === 'failed').grace, SEVEN_DAYS_MS);
  assert.deepEqual(summary, { total: 4, completed: 3, failed: 1 });
});

test('cleanStaleJobs logs an audited summary of removed counts', async () => {
  const queue = {
    name: 'test-queue',
    clean: async (grace, limit, type) => (type === 'completed' ? ['c-1', 'c-2'] : ['f-1'])
  };
  const logger = makeLogger();

  await cleanStaleJobs(queue, { logger });

  const summaryLog = logger._calls.find(c => c.msg === 'queue cleanup summary');
  assert.ok(summaryLog, 'expected a summary log line');
  assert.equal(summaryLog.data.total, 3);
  assert.equal(summaryLog.data.completed, 2);
  assert.equal(summaryLog.data.failed, 1);
});

test('cleanStaleJobs honours custom targets', async () => {
  const calls = [];
  const queue = {
    name: 'test-queue',
    clean: async (grace, limit, type) => {
      calls.push({ grace, limit, type });
      return [];
    }
  };

  await cleanStaleJobs(queue, {
    logger: makeLogger(),
    targets: [{ type: 'completed', grace: 5000 }]
  });

  assert.deepEqual(calls.map(c => c.type), ['completed']);
  assert.equal(calls[0].grace, 5000);
});

test('createCleanupJob purges both completed and failed jobs on each run', async () => {
  const cleanedTypes = [];
  const queue = {
    name: 'sched-queue',
    clean: async (grace, limit, type) => {
      cleanedTypes.push(type);
      return [];
    }
  };

  const task = createCleanupJob(queue, { logger: makeLogger(), schedule: '* * * * * *' });
  task.start();

  await new Promise(resolve => setTimeout(resolve, 1100));
  task.stop();

  assert.ok(cleanedTypes.includes('completed'), 'expected completed jobs to be purged');
  assert.ok(cleanedTypes.includes('failed'), 'expected failed jobs to be purged');
});

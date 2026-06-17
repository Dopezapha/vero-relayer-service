const express = require('express');
const {
  buildGitHubPullRequestEventPayload,
  buildMetadataFromRequest,
  enqueueEvent,
  validateRedisConfig
} = require('./src/queue');

function createApp(options = {}) {
  const enqueueEventJob = options.enqueueEventJob || enqueueEvent;
  const app = express();

  app.use(express.json());
const { registerTaskOnChain, registerBatchOnChain } = require('./stellar');
const { verifySignature } = require('./src/middleware/auth');

// Inline require of the compiled/ts-node batcher. Using require with ts-node
// registration, or the plain JS equivalent below if TS is not bootstrapped.
let EventBatcher;
try {
  require('ts-node/register');
  ({ EventBatcher } = require('./src/queue/batcher'));
} catch {
  // Fallback: inline minimal batcher so the server still boots without ts-node
  EventBatcher = class {
    constructor(flush) { this.flush = flush; this.queue = []; this.timer = null; }
    enqueue(id) {
      this.queue.push(id);
      if (!this.timer) this.timer = setTimeout(() => this._drain(), 5000);
      if (this.queue.length >= 50) this._drain();
    }
    _drain() {
      clearTimeout(this.timer); this.timer = null;
      if (!this.queue.length) return;
      const batch = this.queue.splice(0);
      this.flush(batch).catch(e => console.error('[batcher] flush error:', e));
    }
  };
}

const batcher = new EventBatcher(registerBatchOnChain);

// const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.post('/github-webhook', async (req, res) => {
  const { action, pull_request: pr } = req.body;

    if (action !== 'closed' || !pr?.merged) {
      return res.status(200).json({ skipped: true });
    }

    const hasLabel = pr.labels?.some(l => l.name === 'wave-contribution');
    if (!hasLabel) {
      return res.status(200).json({ skipped: true, reason: 'no wave-contribution label' });
    }

    const eventPayload = buildGitHubPullRequestEventPayload(req.body, buildMetadataFromRequest(req));

    try {
      const job = await enqueueEventJob(eventPayload);
      console.log(`[webhook] queued PR #${pr.number} eventType=${eventPayload.eventType} job=${job.id}`);
      return res.status(202).json({ ok: true, pr: pr.number, queued: true, jobId: job.id });
    } catch (error) {
      console.error(`[webhook] failed to enqueue PR #${pr.number}: ${error.message}`);
      return res.status(500).json({ ok: false, error: 'failed to enqueue event' });
    }
  });

  return app;
}

function startServer() {
  validateRedisConfig();

  const port = process.env.PORT || 3000;
  const app = createApp();

  return app.listen(port, () => console.log(`Server listening on port ${port}`));
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};

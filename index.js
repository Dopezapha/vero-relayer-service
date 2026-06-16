const express = require('express');
const { registerBatchOnChain } = require('./stellar');

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

const app = express();
app.use(express.json());

app.post('/github-webhook', async (req, res) => {
  const { action, pull_request: pr } = req.body;

  if (action !== 'closed' || !pr?.merged) {
    return res.status(200).json({ skipped: true });
  }

  const hasLabel = pr.labels?.some(l => l.name === 'wave-contribution');
  if (!hasLabel) {
    return res.status(200).json({ skipped: true, reason: 'no wave-contribution label' });
  }

  console.log(`[webhook] PR #${pr.number} merged with wave-contribution label`);
  batcher.enqueue(pr.number);
  res.status(200).json({ ok: true, pr: pr.number, status: 'queued' });
});

app.listen(3000, () => console.log('Server listening on port 3000'));

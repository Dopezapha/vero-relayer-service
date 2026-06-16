const express = require('express');
const { registerTaskOnChain } = require('./stellar');
const { verifySignature } = require('./src/middleware/auth');

const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.post('/github-webhook', verifySignature, async (req, res) => {
  const { action, pull_request: pr } = req.body;

  if (action !== 'closed' || !pr?.merged) {
    return res.status(200).json({ skipped: true });
  }

  const hasLabel = pr.labels?.some(l => l.name === 'wave-contribution');
  if (!hasLabel) {
    return res.status(200).json({ skipped: true, reason: 'no wave-contribution label' });
  }

  console.log(`[webhook] PR #${pr.number} merged with wave-contribution label`);
  await registerTaskOnChain(pr.number);
  res.status(200).json({ ok: true, pr: pr.number });
});

app.listen(3000, () => console.log('Server listening on port 3000'));

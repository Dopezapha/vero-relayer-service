const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { test } = require('node:test');
const { createLogger } = require('../src/logger');
const {
  createTransactionLogger,
  maskAccountId,
  sanitizeFields
} = require('../src/services/transaction-logger');

// Valid-format Stellar StrKeys: base32, 56 chars, account ids start with `G`,
// secret seeds with `S`.
const ACCOUNT_ID = 'G' + 'A'.repeat(55);
const SECRET_SEED = 'S' + 'B'.repeat(55);

function memoryStream() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });
  return { lines, stream };
}

function parsedLogs(lines) {
  return lines.join('').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function createMemoryTxLogger() {
  const output = memoryStream();
  const base = createLogger({ env: { LOG_LEVEL: 'debug' }, stream: output.stream });
  return { txLogger: createTransactionLogger(base), output };
}

test('emits structured JSON with component, txEvent and message', () => {
  const { txLogger, output } = createMemoryTxLogger();

  txLogger.confirmed({ githubId: 42, txHash: 'abc123' }, 'done');

  const [entry] = parsedLogs(output.lines);
  assert.equal(entry.component, 'transaction');
  assert.equal(entry.txEvent, 'confirmed');
  assert.equal(entry.message, 'done');
  assert.equal(entry.githubId, 42);
  assert.equal(entry.txHash, 'abc123');
  assert.equal(entry.level, 'info');
});

test('masks Stellar account ids in dedicated fields', () => {
  const { txLogger, output } = createMemoryTxLogger();

  txLogger.started({ account: ACCOUNT_ID });

  const [entry] = parsedLogs(output.lines);
  assert.equal(entry.account, `${ACCOUNT_ID.slice(0, 6)}…${ACCOUNT_ID.slice(-6)}`);
  assert.ok(!output.lines.join('').includes(ACCOUNT_ID));
});

test('redacts secret seeds that leak into arbitrary values', () => {
  const { txLogger, output } = createMemoryTxLogger();

  txLogger.failed(
    { note: `submitting with ${SECRET_SEED}` },
    new Error(`signing failed for seed ${SECRET_SEED}`)
  );

  const serialized = output.lines.join('');
  const [entry] = parsedLogs(output.lines);
  assert.equal(entry.txEvent, 'failed');
  assert.equal(entry.level, 'error');
  assert.ok(!serialized.includes(SECRET_SEED), 'secret seed must never reach the stream');
  assert.ok(entry.note.includes('[Redacted]'));
  assert.ok(entry.error.includes('[Redacted]'));
});

test('redacts known secret field names regardless of value', () => {
  const { txLogger, output } = createMemoryTxLogger();

  txLogger.started({ secretKey: 'whatever', signature: 'deadbeef', safe: 'visible' });

  const [entry] = parsedLogs(output.lines);
  assert.equal(entry.secretKey, '[Redacted]');
  assert.equal(entry.signature, '[Redacted]');
  assert.equal(entry.safe, 'visible');
});

test('child() binds context across every event', () => {
  const { txLogger, output } = createMemoryTxLogger();

  const txLog = txLogger.child({ githubId: 7, network: 'testnet' });
  txLog.started({ account: ACCOUNT_ID });
  txLog.submitting({ fee: '100' });
  txLog.confirmed({ txHash: 'hash-7' });

  const entries = parsedLogs(output.lines);
  assert.equal(entries.length, 3);
  assert.ok(entries.every(e => e.githubId === 7 && e.network === 'testnet'));
  assert.deepEqual(entries.map(e => e.txEvent), ['started', 'submitting', 'confirmed']);
});

test('maskAccountId leaves non-account values untouched', () => {
  assert.equal(maskAccountId('not-an-account'), 'not-an-account');
  assert.equal(maskAccountId(123), 123);
  assert.equal(maskAccountId(ACCOUNT_ID), `${ACCOUNT_ID.slice(0, 6)}…${ACCOUNT_ID.slice(-6)}`);
});

test('sanitizeFields handles nested objects and arrays without mutating input', () => {
  const input = { items: [{ secretKey: 's', publicKey: ACCOUNT_ID }], ok: 1 };
  const result = sanitizeFields(input);
  assert.equal(result.items[0].secretKey, '[Redacted]');
  assert.equal(result.items[0].publicKey, `${ACCOUNT_ID.slice(0, 6)}…${ACCOUNT_ID.slice(-6)}`);
  assert.equal(result.ok, 1);
  // original is untouched
  assert.equal(input.items[0].secretKey, 's');
});

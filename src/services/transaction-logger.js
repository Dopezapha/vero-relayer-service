const { logger: defaultLogger } = require('../logger');

const SECRET_SEED_PATTERN = /\bS[A-Z2-7]{55}\b/g;
const ACCOUNT_ID_PATTERN = /\bG[A-Z2-7]{55}\b/g;

const SECRET_FIELDS = new Set([
  'secret',
  'secretKey',
  'secretSeed',
  'seed',
  'privateKey',
  'signature',
  'stellarSecretKey',
  'STELLAR_SECRET_KEY'
]);

const TX_EVENTS = Object.freeze({
  STARTED: 'started',
  SUBMITTING: 'submitting',
  CONFIRMED: 'confirmed',
  RETRYING: 'retrying',
  FAILED: 'failed'
});

/**
 * Partially mask a Stellar account id so the log remains correlatable per
 * account (stable prefix + suffix) without exposing the full identifier.
 * Returns the input unchanged when it is not a recognisable account id.
 */
function maskAccountId(value) {
  if (typeof value !== 'string' || !/^G[A-Z2-7]{55}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

/**
 * Replace any Stellar secret seed that appears anywhere in a string with the
 * redaction marker. Account ids embedded in free text are masked too. This is a
 * value-level guard that catches secrets the path-based redactor cannot see
 * (e.g. a seed accidentally interpolated into an error message).
 */
function sanitizeString(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .replace(SECRET_SEED_PATTERN, '[Redacted]')
    .replace(ACCOUNT_ID_PATTERN, match => maskAccountId(match));
}

/**
 * Recursively sanitize a structured log payload: drop/redact known secret
 * fields, mask account ids, and scrub secret seeds from any string value.
 */
function sanitizeFields(input, seen = new WeakSet()) {
  if (typeof input === 'string') {
    return sanitizeString(input);
  }

  if (!input || typeof input !== 'object') {
    return input;
  }

  if (seen.has(input)) {
    return '[Circular]';
  }
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map(item => sanitizeFields(item, seen));
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_FIELDS.has(key)) {
      output[key] = '[Redacted]';
      continue;
    }
    if (key === 'account' || key === 'publicKey' || key === 'source') {
      output[key] = typeof value === 'string' ? maskAccountId(value) : sanitizeFields(value, seen);
      continue;
    }
    output[key] = sanitizeFields(value, seen);
  }
  return output;
}

function normalizeError(error) {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'string') {
    return sanitizeString(error);
  }
  return sanitizeString(error.message || String(error));
}

/**
 * Build a secure transaction logger bound to `component: 'transaction'`.
 * Every helper emits a single structured JSON line with a stable, queryable
 * schema (`txEvent`, `githubId`, `account`, `txHash`, `network`, `fee`, ...)
 * and guarantees secrets/PII are masked before they reach the stream.
 */
function createTransactionLogger(baseLogger = defaultLogger, bindings = {}) {
  const log = baseLogger.child({ component: 'transaction', ...sanitizeFields(bindings) });

  function emit(level, txEvent, fields, message) {
    log[level]({ txEvent, ...sanitizeFields(fields || {}) }, message);
  }

  return {
    /** Logger scoped to a single transaction (e.g. bound to a githubId/txId). */
    child(extraBindings = {}) {
      return createTransactionLogger(baseLogger, { ...bindings, ...extraBindings });
    },
    started(fields, message = 'Transaction started') {
      emit('info', TX_EVENTS.STARTED, fields, message);
    },
    submitting(fields, message = 'Submitting transaction') {
      emit('info', TX_EVENTS.SUBMITTING, fields, message);
    },
    confirmed(fields, message = 'Transaction confirmed on-chain') {
      emit('info', TX_EVENTS.CONFIRMED, fields, message);
    },
    retrying(fields, error, message = 'Retrying transaction') {
      emit('warn', TX_EVENTS.RETRYING, { ...fields, error: normalizeError(error) }, message);
    },
    failed(fields, error, message = 'Transaction failed') {
      emit('error', TX_EVENTS.FAILED, { ...fields, error: normalizeError(error) }, message);
    }
  };
}

const transactionLogger = createTransactionLogger();

module.exports = {
  TX_EVENTS,
  SECRET_FIELDS,
  createTransactionLogger,
  transactionLogger,
  maskAccountId,
  sanitizeString,
  sanitizeFields
};

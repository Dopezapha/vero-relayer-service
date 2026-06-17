import type { Logger } from 'pino';
import { logger as defaultLogger } from '../logger';

const SECRET_SEED_PATTERN = /\bS[A-Z2-7]{55}\b/g;
const ACCOUNT_ID_PATTERN = /\bG[A-Z2-7]{55}\b/g;

export const SECRET_FIELDS = new Set<string>([
  'secret',
  'secretKey',
  'secretSeed',
  'seed',
  'privateKey',
  'signature',
  'stellarSecretKey',
  'STELLAR_SECRET_KEY'
]);

export const TX_EVENTS = Object.freeze({
  STARTED: 'started',
  SUBMITTING: 'submitting',
  CONFIRMED: 'confirmed',
  RETRYING: 'retrying',
  FAILED: 'failed'
} as const);

export type TxFields = Record<string, unknown>;

export interface TransactionLogger {
  child(extraBindings?: TxFields): TransactionLogger;
  started(fields?: TxFields, message?: string): void;
  submitting(fields?: TxFields, message?: string): void;
  confirmed(fields?: TxFields, message?: string): void;
  retrying(fields?: TxFields, error?: unknown, message?: string): void;
  failed(fields?: TxFields, error?: unknown, message?: string): void;
}

export function maskAccountId(value: unknown): unknown {
  if (typeof value !== 'string' || !/^G[A-Z2-7]{55}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

export function sanitizeString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value
    .replace(SECRET_SEED_PATTERN, '[Redacted]')
    .replace(ACCOUNT_ID_PATTERN, match => maskAccountId(match) as string);
}

/**
 * Recursively sanitize a structured log payload: drop/redact known secret
 * fields, mask account ids, and scrub secret seeds from any string value.
 */
export function sanitizeFields(input: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof input === 'string') {
    return sanitizeString(input);
  }

  if (!input || typeof input !== 'object') {
    return input;
  }

  if (seen.has(input as object)) {
    return '[Circular]';
  }
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map(item => sanitizeFields(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
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

function normalizeError(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'string') {
    return sanitizeString(error) as string;
  }
  const message = (error as { message?: string }).message;
  return sanitizeString(message || String(error)) as string;
}

/**
 * Build a secure transaction logger bound to `component: 'transaction'`.
 * Every helper emits a single structured JSON line with a stable, queryable
 * schema (`txEvent`, `githubId`, `account`, `txHash`, `network`, `fee`, ...)
 * and guarantees secrets/PII are masked before they reach the stream.
 */
export function createTransactionLogger(
  baseLogger: Logger = defaultLogger,
  bindings: TxFields = {}
): TransactionLogger {
  const log = baseLogger.child({ component: 'transaction', ...(sanitizeFields(bindings) as TxFields) });

  function emit(level: 'info' | 'warn' | 'error', txEvent: string, fields: TxFields | undefined, message: string): void {
    log[level]({ txEvent, ...(sanitizeFields(fields || {}) as TxFields) }, message);
  }

  return {
    child(extraBindings: TxFields = {}): TransactionLogger {
      return createTransactionLogger(baseLogger, { ...bindings, ...extraBindings });
    },
    started(fields?: TxFields, message = 'Transaction started'): void {
      emit('info', TX_EVENTS.STARTED, fields, message);
    },
    submitting(fields?: TxFields, message = 'Submitting transaction'): void {
      emit('info', TX_EVENTS.SUBMITTING, fields, message);
    },
    confirmed(fields?: TxFields, message = 'Transaction confirmed on-chain'): void {
      emit('info', TX_EVENTS.CONFIRMED, fields, message);
    },
    retrying(fields?: TxFields, error?: unknown, message = 'Retrying transaction'): void {
      emit('warn', TX_EVENTS.RETRYING, { ...fields, error: normalizeError(error) }, message);
    },
    failed(fields: TxFields | undefined, error?: unknown, message = 'Transaction failed'): void {
      emit('error', TX_EVENTS.FAILED, { ...fields, error: normalizeError(error) }, message);
    }
  };
}

export const transactionLogger = createTransactionLogger();

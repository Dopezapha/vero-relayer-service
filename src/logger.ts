import { randomUUID } from 'crypto';
import pino, { Logger, LoggerOptions } from 'pino';
import { Writable } from 'stream';

export const REDACT_PATHS = [
  'password',
  'pass',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'privateKey',
  'secretKey',
  'seed',
  'seedPhrase',
  'mnemonic',
  'signature',
  'authorization',
  'Authorization',
  'headers.authorization',
  'headers.Authorization',
  'headers.cookie',
  'headers.Cookie',
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'wallet.privateKey',
  'wallet.secretKey',
  'config.privateKey',
  'config.secretKey',
  'env',
  'STELLAR_SECRET_KEY',
  'stellarSecretKey',
  'stellar.secretKey'
] as const;

type Env = Record<string, string | undefined>;

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
  requestId?: string;
  log?: Logger;
};

type ResponseLike = {
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
  on?: (event: 'finish', listener: () => void) => void;
};

type NextFunction = () => void;

function parseBoolean(value: string | undefined): boolean {
  return String(value || '').toLowerCase() === 'true';
}

export function createLogger(options: { env?: Env; stream?: Writable } = {}): Logger {
  const env = options.env || process.env;
  const loggerOptions: LoggerOptions = {
    level: env.LOG_LEVEL || 'info',
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...REDACT_PATHS],
      censor: '[Redacted]',
      remove: parseBoolean(env.LOG_REDACT_REMOVE)
    },
    formatters: {
      level(label: string) {
        return { level: label };
      }
    }
  };

  return pino(loggerOptions, options.stream);
}

export const logger = createLogger();

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.find(item => typeof item === 'string' && item.trim()) || null;
  }

  return typeof value === 'string' && value.trim() ? value : null;
}

export function getRequestId(req: RequestLike): string {
  const headers = req.headers || {};
  return normalizeHeaderValue(headers['x-request-id']) || normalizeHeaderValue(headers['x-correlation-id']) || randomUUID();
}

function getRequestPath(req: RequestLike): string {
  const rawUrl = req.originalUrl || req.url || '';

  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return rawUrl.split('?')[0];
  }
}

export function requestLoggerMiddleware(options: { logger?: Logger; enabled?: boolean } = {}) {
  const baseLogger = options.logger || logger;
  const enabled = options.enabled !== undefined
    ? options.enabled
    : process.env.ENABLE_HTTP_REQUEST_LOGS !== 'false';

  return function requestLogger(req: RequestLike, res: ResponseLike, next: NextFunction): void {
    const requestId = getRequestId(req);
    const requestLog = baseLogger.child({ requestId });
    const startedAt = process.hrtime.bigint();

    req.requestId = requestId;
    req.log = requestLog;

    if (typeof res.setHeader === 'function') {
      res.setHeader('x-request-id', requestId);
    }

    if (enabled && typeof res.on === 'function') {
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        requestLog.info({
          method: req.method,
          path: getRequestPath(req),
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs)
        }, 'request completed');
      });
    }

    next();
  };
}

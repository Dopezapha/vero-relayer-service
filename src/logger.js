const { randomUUID } = require('crypto');
const pino = require('pino');

const REDACT_PATHS = [
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
];

function parseBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

function createLogger(options = {}) {
  const env = options.env || process.env;
  const loggerOptions = {
    level: env.LOG_LEVEL || 'info',
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
      remove: parseBoolean(env.LOG_REDACT_REMOVE)
    },
    formatters: {
      level(label) {
        return { level: label };
      }
    }
  };

  return pino(loggerOptions, options.stream);
}

const logger = createLogger();

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.find(item => typeof item === 'string' && item.trim()) || null;
  }

  return typeof value === 'string' && value.trim() ? value : null;
}

function getRequestId(req) {
  const headers = req.headers || {};
  return normalizeHeaderValue(headers['x-request-id']) || normalizeHeaderValue(headers['x-correlation-id']) || randomUUID();
}

function getRequestPath(req) {
  const rawUrl = req.originalUrl || req.url || '';

  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch (_) {
    return rawUrl.split('?')[0];
  }
}

function requestLoggerMiddleware(options = {}) {
  const baseLogger = options.logger || logger;
  const enabled = options.enabled !== undefined
    ? options.enabled
    : process.env.ENABLE_HTTP_REQUEST_LOGS !== 'false';

  return function requestLogger(req, res, next) {
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

module.exports = {
  REDACT_PATHS,
  createLogger,
  getRequestId,
  logger,
  requestLoggerMiddleware
};

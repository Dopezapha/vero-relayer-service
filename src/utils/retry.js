const { setTimeout } = require('timers/promises');

function defaultIsRetryable(err) {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('network') || msg.includes('rate limit')) {
      return true;
    }
    if (err.code === 429 || err.code === 503 || err.code === 502) {
      return true;
    }
  }
  return false;
}

async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    isRetryable = defaultIsRetryable,
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !isRetryable(err)) {
        throw err;
      }
      const delay = baseDelay * Math.pow(2, attempt);
      if (onRetry) {
        onRetry({ attempt, delay, error: err });
      }
      await setTimeout(delay);
    }
  }

  throw lastError;
}

module.exports = { retry, defaultIsRetryable };

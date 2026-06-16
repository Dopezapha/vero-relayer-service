const { retry } = require('../utils/retry');

async function broadcastTransaction(server, transaction) {
  return retry(
    async (attempt) => {
      const result = await server.submitTransaction(transaction);
      if (!result.hash) {
        throw new Error('Transaction submission returned no hash');
      }
      return result;
    },
    {
      maxRetries: 3,
      baseDelay: 1000,
      onRetry: ({ attempt, delay, error }) => {
        console.warn(`[broadcaster] Retry ${attempt + 1}/3 after ${delay}ms: ${error.message}`);
      },
    }
  );
}

async function fetchAccount(server, accountId) {
  return retry(
    () => server.loadAccount(accountId),
    {
      maxRetries: 3,
      baseDelay: 500,
      onRetry: ({ attempt, delay, error }) => {
        console.warn(`[broadcaster] Account fetch retry ${attempt + 1}/3 after ${delay}ms: ${error.message}`);
      },
    }
  );
}

module.exports = { broadcastTransaction, fetchAccount };

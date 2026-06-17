const { retry } = require('../utils/retry');
const { transactionLogger } = require('./transaction-logger');

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
        transactionLogger.retrying({ attempt: attempt + 1, delay }, error, '[broadcaster] Retry submitting transaction');
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
        transactionLogger.retrying({ attempt: attempt + 1, delay, account: accountId }, error, '[broadcaster] Account fetch retry');
      },
    }
  );
}

module.exports = { broadcastTransaction, fetchAccount };

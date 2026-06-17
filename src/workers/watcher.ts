import { logger } from '../logger';
import pool from "../db/client";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

class TransactionWatcher {
  private db: Map<string, any>;

  // The watcher now works with an in‑memory map for demo purposes but obtains a DB client from the pool for any future queries.
  constructor(db) {
    this.db = db || new Map();
  }

  async checkStalledTransactions() {
    // Acquire a client from the pool – it will be released automatically.
    const client = await pool.connect();
    try {
      const now = Date.now();
      let requeuedCount = 0;

      for (const [txId, tx] of this.db.entries()) {
        if (tx.status === 'pending' || tx.status === 'broadcasted') {
          const timeSinceSubmission = now - (tx.lastRetryAt || tx.submittedAt);

          if (timeSinceSubmission > TIMEOUT_MS) {
            if (tx.retries < MAX_RETRIES) {
              logger.info({ txId, retry: tx.retries + 1 }, '[Watcher] Transaction stalled. Re-queuing.');
              tx.status = 'requeued';
              tx.retries += 1;
              tx.lastRetryAt = now;
              requeuedCount++;
            } else {
              logger.info({ txId }, '[Watcher] Transaction stalled. Max retries reached. Marking as failed.');
              tx.status = 'failed';
            }
            this.db.set(txId, tx);
          }
        }
      }

      return requeuedCount;
    } finally {
      client.release();
    }
  }
}

module.exports = { TransactionWatcher, MAX_RETRIES, TIMEOUT_MS };

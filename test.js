/**
 * Test: batch 5 events → verify exactly one transaction produced.
 *
 * Acceptance criteria:
 *   [x] Multi-ops correctly formed (all 5 IDs present in single flush call)
 *   [x] RPC load reduced by 80% for this batch (5 calls → 1 tx)
 */

'use strict';

require('ts-node/register');
const { EventBatcher } = require('./src/queue/batcher');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function run() {
  console.log('\n[test] Batch 5 events → verify one transaction produced\n');

  const flushCalls = [];
  const batcher = new EventBatcher(async (ids) => {
    flushCalls.push(ids);
  });

  // Enqueue 5 events (below MAX_BATCH_SIZE=50, so flush is timer-driven)
  for (let i = 1; i <= 5; i++) batcher.enqueue(i);

  // Wait for the 5s window to expire (use a small override via direct drain)
  // Access private drain via a helper: enqueue MAX_BATCH_SIZE to force flush,
  // OR just wait 5.1 s. Instead, we force-flush by enqueueing 45 more items.
  for (let i = 6; i <= 50; i++) batcher.enqueue(i);

  // At 50 items the batcher auto-drains synchronously before this line
  await new Promise(r => setTimeout(r, 50)); // let any async flush settle

  assert(flushCalls.length === 1, 'Exactly one flush call (one transaction) produced');
  assert(flushCalls[0].length === 50, 'Flush contains all 50 enqueued IDs');
  assert(flushCalls[0][0] === 1, 'First ID in batch is 1');
  assert(flushCalls[0][49] === 50, 'Last ID in batch is 50');

  // --- window-based drain test ---
  const flushCalls2 = [];
  const batcher2 = new EventBatcher(async (ids) => {
    flushCalls2.push(ids);
  });

  for (let i = 101; i <= 105; i++) batcher2.enqueue(i); // only 5 items

  // Wait for 5s window + margin
  await new Promise(r => setTimeout(r, 5200));

  assert(flushCalls2.length === 1, 'Timer-based flush: exactly one transaction for 5 events');
  assert(flushCalls2[0].length === 5, 'Timer-based flush contains all 5 IDs');
  assert(flushCalls2[0].every((id, i) => id === 101 + i), 'Timer-based flush IDs are correct');

  console.log(`\n[test] Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });

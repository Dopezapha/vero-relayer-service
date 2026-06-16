# Vero Relayer Service

A lightweight Node.js service that listens for GitHub webhook events and relays qualifying pull request activity onto the Stellar blockchain. It is the on-chain settlement layer for the **Wave Contribution Program**, a sprint-based open-source incentive model where maintainers post scoped issues and contributors earn verifiable on-chain records for their merged work.

---

## How It Works

```
GitHub PR merged
      |
      v
POST /github-webhook
      |
      |-- action === "closed"? skip if false
      |-- pull_request.merged === true? skip if false
      `-- labels includes "wave-contribution"? skip if false
                |
                v
      enqueue BullMQ job in Redis
                |
                v
      event worker calls registerTaskOnChain(pr.number)
                |
                v
      Stellar transaction submitted
      (manageData: vero:pr:<number>)
```

When a contributor's PR is merged and carries the `wave-contribution` label, the relayer captures the PR number, persists an event job in Redis, and returns `202 Accepted`. A separate BullMQ worker drains the queue and writes a `manageData` operation to Stellar.

---

## Quick Start

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
# Fill in STELLAR_SECRET_KEY and REDIS_PASSWORD
```

**3. Start Redis with password protection**
```bash
docker run --rm -p 6379:6379 redis:7-alpine redis-server --requirepass change-me
```

**4. Start the server**
```bash
npm start
# Server listening on port 3000
```

**5. Start the worker**
```bash
npm run worker:events
# [worker] status=started queue=vero:event-processing concurrency=5
```

**6. Simulate a webhook (no GitHub needed)**
```bash
npm run simulate
# [mock] Response: { ok: true, pr: 42, queued: true, jobId: "..." }
```

---

## Webhook Payload Contract

The service expects the standard GitHub `pull_request` event shape:

```json
{
  "action": "closed",
  "pull_request": {
    "number": 42,
    "merged": true,
    "labels": [
      { "name": "wave-contribution" }
    ]
  }
}
```

Any payload where `action` is not `closed`, `merged` is not `true`, or the label is absent is silently skipped with `{ "skipped": true }`.

Qualifying events return `202 Accepted` with `{ "ok": true, "pr": <number>, "queued": true, "jobId": "..." }` after the job is persisted to Redis.

---

## The Wave Program

The Wave Program works by having maintainers create scoped issues that contributors pick up during sprint cycles. Each sprint has a fixed window, typically two weeks, and a defined set of issues tagged `wave-contribution`. When a contributor's PR for one of those issues is merged, this service queues the event and records the contribution on-chain through the worker.

### Types of work posted each sprint

| Category | Description |
|---|---|
| **Bug fixes** | Reproducible defects with a clear acceptance criterion, such as a failing test that must pass or a described broken behavior that must be resolved. |
| **New features** | Bounded feature additions scoped to a single module. Maintainers write the interface contract; contributors implement it. |
| **Documentation** | Missing or outdated docs, inline code comments, architecture diagrams, and usage examples. |
| **Testing** | New unit or integration tests for uncovered paths, edge cases, or regression scenarios. |
| **Refactors** | Isolated clean-up tasks with no behavior change. |

Maintainers label qualifying issues `wave-contribution` before the sprint opens. Contributors fork, implement, and open a PR against `main`. On merge, this service fires automatically.

---

## Project Structure

```
vero-relayer-service/
├── index.js                    # Express server + webhook route
├── stellar.js                  # Blockchain registration utility
├── src/
│   ├── queue/                  # Redis/BullMQ queue configuration
│   └── workers/                # Event queue worker
├── scripts/
│   └── mock-webhook.js         # Local simulation script
├── .env.example                # Required environment variables
└── package.json
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STELLAR_SECRET_KEY` | Yes | Signing key for the relayer account |
| `STELLAR_NETWORK` | No | `testnet` (default) or `mainnet` |
| `REDIS_HOST` | Yes | Redis host for BullMQ |
| `REDIS_PORT` | Yes | Redis port for BullMQ |
| `REDIS_USERNAME` | No | Redis ACL username, when required by the provider |
| `REDIS_PASSWORD` | Production | Redis password; required when `NODE_ENV=production` |
| `REDIS_TLS` | No | Set to `true` to enable TLS |
| `EVENT_QUEUE_NAME` | No | Defaults to `vero:event-processing` |
| `EVENT_QUEUE_CONCURRENCY` | No | Worker concurrency, defaults to `5` |

---

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the production server |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm run worker:events` | Start the BullMQ event worker |
| `npm run simulate` | Fire a mock webhook at localhost:3000 |
| `COUNT=125 npm run simulate` | Inject 125 mock webhooks |
| `npm test` | Run native Node.js tests |

---

## Manual Queue Verification

1. Start Redis with password protection:
   ```bash
   docker run --rm -p 6379:6379 redis:7-alpine redis-server --requirepass change-me
   ```
2. Set `.env` with `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, and the same `REDIS_PASSWORD`.
3. Start the app with `npm start`.
4. In a second terminal, start the worker with `npm run worker:events`.
5. Inject a burst of events with `COUNT=125 npm run simulate`.
6. Confirm jobs enter Redis:
   ```bash
   docker exec -it <redis-container> redis-cli -a change-me LLEN bull:vero:event-processing:wait
   ```
7. Watch the worker logs for `status=started`, `status=completed`, and retry `status=failed` entries. Logs include job ID, event type, and attempt number, but do not include Redis passwords or request headers.
8. Stop the worker during a burst and restart it to confirm persisted jobs continue draining from Redis.

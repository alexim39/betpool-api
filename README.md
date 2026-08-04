# BetPool API

Express.js + TypeScript backend for the BetPool micro-betting platform.

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** Express.js + TypeScript
- **Database:** MongoDB + Mongoose
- **Auth:** JWT (OTP + PIN)
- **Payments:** Paystack, Flutterwave
- **SMS:** BulkSMS Nigeria
- **Testing:** Jest

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Server starts at `http://localhost:8383`.

## Available Scripts

| Command           | Description                        |
|-------------------|------------------------------------|
| `npm run dev`     | Start dev server with hot-reload   |
| `npm run build`   | Compile TypeScript to `dist/`      |
| `npm start`       | Run compiled production build      |
| `npm test`        | Run Jest test suite (159 tests)    |

## API Endpoints

Import `BetPool-API.postman_collection.json` into Postman for the full collection.

### Auth
- `POST /api/auth/send-otp` — Request OTP to phone number
- `POST /api/auth/verify-otp` — Verify OTP and receive JWT
- `POST /api/auth/set-pin` — Set transaction PIN
- `POST /api/auth/login` — Login with PIN

### Pods
- `GET /api/pods` — List available pods
- `GET /api/pods/:id` — Get pod details
- `POST /api/pods` — Create pod (admin)
- `PATCH /api/pods/:id` — Update pod (admin)

### Wallet
- `GET /api/wallet` — Get wallet balance & transactions
- `POST /api/wallet/deposit` — Initiate deposit (Paystack/Flutterwave)
- `POST /api/wallet/withdraw` — Request withdrawal

### Bets
- `POST /api/bets` — Place a bet on a pod
- `GET /api/bets` — List user's bets
- `GET /api/bets/:id` — Bet details

### Admin
- `GET /api/admin/users` — List users
- `GET /api/admin/transactions` — List all transactions
- `PATCH /api/admin/bets/:id` — Resolve bet outcome

## Environment Variables

See `.env.example` for all required variables:

| Variable                    | Description                        |
|-----------------------------|------------------------------------|
| `PORT`                      | Server port                        |
| `NODE_ENV`                  | Environment mode                   |
| `MONGODB_URI`               | MongoDB connection string          |
| `JWT_SECRET`                | JWT signing secret                 |
| `JWT_EXPIRY`                | JWT expiry duration                |
| `BULKSMS_API_TOKEN`         | BulkSMS Nigeria API token          |
| `BULKSMS_SENDER_ID`         | SMS sender ID                      |
| `PAYSTACK_SECRET_KEY`       | Paystack secret key                |
| `PAYSTACK_PUBLIC_KEY`       | Paystack public key                |
| `PAYSTACK_WEBHOOK_SECRET`   | Paystack webhook verification      |
| `FLUTTERWAVE_SECRET_KEY`    | Flutterwave secret key             |
| `FLUTTERWAVE_PUBLIC_KEY`    | Flutterwave public key             |
| `FLUTTERWAVE_WEBHOOK_HASH`  | Flutterwave webhook verification   |
| `BANK_TRANSFER_PROVIDER`    | Provider for bank transfers        |
| `FRONTEND_URL`              | CORS origin for the frontend       |
| `ADMIN_EMAILS`              | Admin email addresses              |
| `DEEPSEEK_API_KEY`          | DeepSeek key used by Ora curation  |
| `DEEPSEEK_MODEL`            | DeepSeek model for curation        |
| `LLM_API_URL`               | Chat-completions endpoint          |
| `SPORTSAPI_KEY`             | Sports-data key for fixtures       |
| `SPORTSAPI_LEAGUES`         | Comma-separated league IDs        |
| `PERSONALIZATION_LLM_REASONS` | `1` to generate LLM pick-reason lines on personalized pods |
| `CURATION_ACCURACY_MIN_SAMPLE` | Min settled-pick sample per league before accuracy signals influence ranking (default `5`) |
| `ORA_AUTOMATION`            | `disabled` turns off the 2h background cycle |
| `MAX_ACTIVE_PODS`           | Max concurrently-running pods the cycle publishes (default `300`) |
| `DAILY_DIGEST_HOUR`         | Hour (0-23) the Daily AI Briefing sends (default `8`) |
| `DIGEST_POOL_SIZE`          | Candidate pods considered per digest (default `10`) |
| `DIGEST_PICK_COUNT`         | Shortlist length per digest (default `5`) |
| `DIGEST_BATCH_SIZE`         | Users processed per batch (default `200`) |

## Operations

### Background schedulers (booted in `src/server.ts`)

| Scheduler | Cadence | Disable with |
|-----------|---------|--------------|
| Ora automation — curation + pod publishing, Games Today, **auto-settlement of concluded pods**, bet-manager ops, profile warm-up | every 2h | `ORA_AUTOMATION=disabled` |
| Risk auto-escalation | every 15 min | `RISK_AUTO_ESCALATION=disabled` |
| Games Today live match-status watcher | every 3 min | `MATCH_STATUS_WATCHER=disabled` |
| Daily AI Briefing digest | daily at `DAILY_DIGEST_HOUR` | `DAILY_DIGEST=disabled` |
| T4 financial advisory | every 6h | `T4_ADVISORY=disabled` |
| Withdrawal reconciliation | every 5 min | `WITHDRAWAL_RECONCILIATION=disabled` |

### Auto-settlement & the outcome ledger

Every 2h cycle the API settles pods whose match dates have passed via
`aiSettlementService.settleAllSettleable()`. Settled picks are written to the
outcome ledger (`pickoutcomes` collection), which is what powers feed
personalization and per-league curation-accuracy signals. If a match can't be
resolved with confidence it is flagged for manual review in the admin console
(`AdminService.settlePod` / the AI settlement admin endpoints).

Cold-start note: with a fresh database there are no ledger rows, so
personalization and accuracy boosts stay neutral until the first pods settle.

### A/B experiment: `personalization`

Feed ranking ships with an A/B harness. The experiment key is
`personalization` (`control` = ranked feed as before, `treatment` = personalized
feed on top). By default it is **disabled** so all users get the control feed.

Enable (50/50) after launch and enough settled data exists:

```
POST /api/admin/abtests
{ "key": "personalization", "description": "Personalized feed ranking", "enabled": true, "controlShare": 50 }
```

Manage state:

```
PATCH /api/admin/abtests/toggle   { "key": "personalization", "enabled": false }
GET /api/admin/abtests
GET /api/admin/abtests/:key/summary
```

Per-user assignment (deterministic, FNV-1a hash — stable across requests):

```
GET /api/abtest/assignment?key=personalization
```

Analyze the `abtest-events` / `abtestexperiments` collections along with bet
conversion + stake data before shipping the treatment to 100% (`controlShare: 0`).

## Project Structure

```
src/
├── __tests__/        # Jest test suites
│   ├── routes/
│   └── services/
├── config/           # App configuration
├── controllers/      # Request handlers
├── models/           # Mongoose schemas
├── routes/           # Express route definitions
├── services/         # Business logic
├── utils/            # Helpers & utilities
├── views/            # Email/SMS templates
├── app.ts            # Express app setup
└── server.ts         # Entry point
```

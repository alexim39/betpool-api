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
| `npm test`        | Run Jest test suite (60+ tests)    |

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

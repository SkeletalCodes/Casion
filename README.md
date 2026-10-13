# Casion — BananaBet

A play-money casino: 29 games (slots, blackjack, roulette, crash, plinko, mines…, plus the
arcade games Snake, Darts, Whack-a-Mole, Rock Paper Scissors and Cups). It has real accounts and an
admin panel, and a purple-and-gold look with a Stake-style sidebar. **No real money is involved
anywhere**: balances are play coins and the crypto cashier is a simulation.

## How it's built

| Part | Where | What it does |
| --- | --- | --- |
| Front end | `public/` | Plain HTML/CSS/JS, no build step. Hash routes like `#/g/snake`, `#/admin`. |
| API | `api/index.js` → `server/app.js` | One Vercel serverless function handles every `/api/*` route. |
| Database | Postgres (`server/db.js`) | Tables are created automatically on first request. |
| Local server | `server/dev.js` | Serves `public/` and the API on one port, like Vercel does. |

The server stores accounts (scrypt-hashed passwords, HttpOnly session cookies), play-coin balances,
every bet, a ledger of all other balance changes, each player's saved settings, and site settings.
Balances only change through `/api/ops` inside a locked database transaction, and a retried request
is never applied twice.

## Deploy on Vercel

1. **Add a database.** In your Vercel project: **Storage → Create Database → Neon (Postgres)**, then
   connect it to the project. That sets `DATABASE_URL` for you. Any Postgres works; just set
   `DATABASE_URL` yourself.
2. **Set the admin key.** In **Settings → Environment Variables** add `ADMIN_SETUP_KEY` and set it
   to a long random password that only you know.
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables are picked up.
4. **Claim the admin account.** On the live site, press **Register** and sign up with
   `james.lawsonjr2020@gmail.com`. The form asks for the setup key; enter the `ADMIN_SETUP_KEY`
   value. You're now the owner, and **Admin panel** appears in the sidebar and account menu.

Forgot the admin password? Register again with the same email and the setup key. It resets the
password.

### Environment variables

| Name | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (set by the Neon integration). `POSTGRES_URL` also works. |
| `ADMIN_SETUP_KEY` | yes, to claim admin | Secret needed to register (or recover) the owner email. |
| `ADMIN_EMAILS` | no | Comma-separated owner emails. Defaults to `james.lawsonjr2020@gmail.com`. |

## The admin panel (`#/admin`)

- **Overview:** players (online, active, new), bets and wagers over the last 24 hours, the house
  result, coins held by players, 14-day charts, top games, newest players and biggest wagerers.
- **Players:** search, filter (online, admins, suspended) and sort. Open a player to add, remove or
  set their balance (with a note), suspend them with a reason, make them an admin, rename them, set
  their password, sign them out everywhere, or delete them. You can also browse their bets, ledger
  and per-game results.
- **Bets:** every bet, filtered by game, player, or wins of 10× and more.
- **Ledger:** every balance change that isn't a bet (admin adjustments, faucet, bonuses,
  simulated deposits and withdrawals).
- **Settings:** a site-wide announcement bar, turning sign-ups on or off, and the starting balance.

The owner account can't be suspended, demoted or deleted from the panel.

## Run it locally

```sh
npm install
echo "DATABASE_URL=postgres://user:pass@localhost:5432/casion" > .env.local
echo "ADMIN_SETUP_KEY=some-long-secret" >> .env.local
npm run dev          # http://localhost:3000
```

Without a database the site still loads and the games can be browsed, but sign-up and login show
a "being set up" notice.

## Tests

The API tests run against a real, **throwaway** Postgres database. They drop and recreate the tables:

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/casion_test npm test
```

## A note on fairness

Game results are generated in the browser from a provably-fair seed pair (HMAC-SHA256), and the
server records each bet and moves the balance. A determined player could fake results from
their own browser. That's acceptable for play money, and admins can see every bet and suspend
abusers. Moving result generation onto the server is the next step if that ever matters.

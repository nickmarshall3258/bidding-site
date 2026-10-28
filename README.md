# Bid Board

Login/sign-up, place and confirm a bid, and a live top-10 leaderboard (top 4 highlighted gold / silver / bronze / blue). Backend is Node + Express on a Neon Postgres database.

## Setup

1. **Create a Neon database**: go to https://neon.tech, create a project, and copy the connection string from *Connection Details*.
2. **Configure**: copy `.env.example` to `.env` and paste in `DATABASE_URL` and a random `JWT_SECRET`.
3. **Install and run**:
   ```
   npm install
   npm start
   ```
4. Open http://localhost:3000

The `users` table is created automatically on first start (see `schema.sql`).

## How it works

- Passwords are hashed with bcrypt (never stored in plain text). Sessions use an httpOnly cookie.
- Each user has one bid stored on their account (`users.bid_amount`). Placing a new bid replaces the old one, after a confirm dialog.
- The leaderboard shows the top 10 accounts by bid; ties go to whoever bid first. It refreshes every 5 seconds.

## Deploying

Any Node host works (Render, Railway, Fly.io, etc.). Set `DATABASE_URL`, `JWT_SECRET` and `NODE_ENV=production` as environment variables. Serve it over HTTPS.

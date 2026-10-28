require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.error('Missing DATABASE_URL or JWT_SECRET. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const COOKIE = 'bid_token';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 24 * 7,
};

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

const TICKET_PRICE = 40; // must match TICKET_PRICE in public/index.html

// When bidding closes. Default: the start of party day, Dec 10 2026, 12:00 AM Central (CST = UTC-6).
// Override in .env with e.g.  BID_CLOSES_AT=2026-12-09T17:00:00-06:00
let BID_CLOSES_AT = new Date(process.env.BID_CLOSES_AT || '2026-12-10T00:00:00-06:00');
if (isNaN(BID_CLOSES_AT)) BID_CLOSES_AT = new Date('2026-12-10T00:00:00-06:00');
const isClosed = () => Date.now() >= BID_CLOSES_AT.getTime();

// Names are stored in the "username" column as "First Last".
const cleanName = (v) => String(v || '').trim().replace(/\s+/g, ' ');
const NAME_RE = /^\p{L}[\p{L}'.-]*( \p{L}[\p{L}'.-]*)+$/u; // at least two words (first + last)

// Public: lets the countdown work on the login page too.
app.get('/api/config', (req, res) => {
  res.json({ closesAt: BID_CLOSES_AT.toISOString(), now: new Date().toISOString() });
});

// ---- Auth ----
app.post('/api/register', async (req, res) => {
  const username = cleanName(req.body.username);
  const password = String(req.body.password || '');
  if (!NAME_RE.test(username) || username.length > 40)
    return res.status(400).json({ error: 'Enter your first and last name (letters only), e.g. Jane Smith' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    res.cookie(COOKIE, sign(rows[0]), cookieOpts);
    res.json({ username: rows[0].username, bid: null, hasTicket: false });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That name is already registered' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const username = cleanName(req.body.username);
  const password = String(req.body.password || '');
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid name or password' });
    res.cookie(COOKIE, sign(user), cookieOpts);
    res.json({ username: user.username, bid: user.bid_amount === null ? null : Number(user.bid_amount), hasTicket: user.has_ticket });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT username, bid_amount, has_ticket FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Account not found' });
  res.json({ username: rows[0].username, bid: rows[0].bid_amount === null ? null : Number(rows[0].bid_amount), hasTicket: rows[0].has_ticket });
});

// ---- Bidding ----
app.post('/api/bid', auth, async (req, res) => {
  if (isClosed()) return res.status(403).json({ error: 'Bidding is closed' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9)
    return res.status(400).json({ error: 'Enter a valid bid amount' });
  const rounded = Math.round(amount * 100) / 100;
  const wantsTicket = req.body.ticket === true; // ticket on/off, saved with each bid
  try {
    const { rows } = await pool.query(
      'UPDATE users SET bid_amount = $1, bid_at = now(), has_ticket = $3 WHERE id = $2 RETURNING bid_amount, has_ticket',
      [rounded, req.user.id, wantsTicket]
    );
    res.json({ bid: Number(rows[0].bid_amount), hasTicket: rows[0].has_ticket });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Clear my bid: sets the account back to $0 (bid and ticket removed).
app.post('/api/bid/clear', auth, async (req, res) => {
  if (isClosed()) return res.status(403).json({ error: 'Bidding is closed' });
  try {
    await pool.query('UPDATE users SET bid_amount = NULL, bid_at = NULL, has_ticket = false WHERE id = $1', [req.user.id]);
    res.json({ bid: null, hasTicket: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Top 10 bidders (one row per account). Ties go to the earlier bid.
app.get('/api/leaderboard', async (req, res) => {
  // Ranked by total contribution = bid + ticket ($40 if they have one).
  const { rows } = await pool.query(
    `SELECT username, bid_amount + (CASE WHEN has_ticket THEN $1::numeric ELSE 0 END) AS total
     FROM users
     WHERE bid_amount IS NOT NULL
     ORDER BY total DESC, bid_at ASC
     LIMIT 10`,
    [TICKET_PRICE]
  );
  res.json(rows.map((r) => ({ username: r.username, bid: Number(r.total) })));
});

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Running on http://localhost:${port}`));
}

init().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});

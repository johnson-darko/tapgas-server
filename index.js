// ...existing code...
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const app = express();
app.use(bodyParser.json());
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
  }),
  secret: process.env.SESSION_SECRET || 'tapgas_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 24 * 60 * 60 * 1000, // 60 days (2 months)
    httpOnly: true,
    secure: false, // set to true if using HTTPS
  },
}));

// Global API request logger (only logs /auth and /order)
app.use((req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/order')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post('/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const code = generateCode();
  const expires = Date.now() + 10 * 60 * 1000; // 10 min expiry
  await pool.query('INSERT INTO login_codes (email, code, expires) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET code = $2, expires = $3', [email, code, expires]);
  console.log(`Login code for ${email}: ${code}`);
  res.json({ success: true, code });
});

app.post('/auth/verify-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
  const result = await pool.query('SELECT * FROM login_codes WHERE email = $1', [email]);
  if (!result.rows.length) return res.status(400).json({ error: 'No code found' });
  const row = result.rows[0];
  if (row.code !== code || Date.now() > row.expires) return res.status(400).json({ error: 'Invalid or expired code' });
  // Create/find user, set session
  // Insert user if not exists
  await pool.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO NOTHING`,
    [email]
  );
  // Always fetch user role after insert
  const userResult = await pool.query('SELECT role FROM users WHERE email = $1', [email]);
  const role = userResult.rows[0]?.role || 'customer';
  console.log('Fetched user role for', email, ':', role); // DEBUG LOG
  req.session.user = { email, role };
  console.log('Session after verify-code:', req.session);
  res.json({ success: true, user: { email, role } });
});

const PORT = process.env.PORT || 4000;
// Order placement endpoint
app.post('/order', async (req, res) => {
  console.log('Session on /order:', req.session);
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const {
    customerName,
    address,
    location,
    cylinderType,
    filled,
    uniqueCode,
    status,
    date,
    amountPaid,
    notes,
    payment,
    serviceType,
    timeSlot,
    deliveryWindow
  } = req.body;
  if (!address || !cylinderType || !payment) {
    return res.status(400).json({ error: 'Missing required order details' });
  }
  await pool.query(
    `INSERT INTO orders (
      email, customer_name, address, location_lat, location_lng, cylinder_type, filled, unique_code, status, date, amount_paid, notes, payment_method, service_type, time_slot, delivery_window
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
    )`,
    [
      req.session.user.email,
      customerName || null,
      address,
      location && location.lat ? location.lat : null,
      location && location.lng ? location.lng : null,
      cylinderType,
      filled || null,
      uniqueCode || null,
      status || 'pending',
      date || null,
      amountPaid || null,
      notes || null,
      payment || null,
      serviceType || null,
      timeSlot || null,
      deliveryWindow || null
    ]
  );
  res.json({ success: true });
});


// Update user profile (name, phone_number)
app.post('/profile', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { name, phone_number } = req.body;
  if (!name || !phone_number) return res.status(400).json({ error: 'Name and phone number required' });
  await pool.query(
    'UPDATE users SET name = $1, phone_number = $2 WHERE email = $3',
    [name, phone_number, req.session.user.email]
  );
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

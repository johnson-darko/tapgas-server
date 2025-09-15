const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();


const app = express();
app.use(bodyParser.json());
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
const session = require('express-session');
app.use(session({
  secret: process.env.SESSION_SECRET || 'tapgas_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: false, // set to true if using HTTPS
  },
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  req.session.user = { email };
  res.json({ success: true, user: { email } });
});

const PORT = process.env.PORT || 4000;
// Order placement endpoint
app.post('/order', async (req, res) => {
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

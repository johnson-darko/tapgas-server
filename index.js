
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const app = express();
// Debug endpoint: print current session (must be after app is defined)
app.get('/debug/session', (req, res) => {
  res.json({ session: req.session, cookies: req.headers.cookie });
});
app.use(bodyParser.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Production-ready session cookie config (Render + GitHub Pages)
// Set SESSION_COOKIE_SECURE=true, SESSION_COOKIE_SAMESITE=none, CORS_ORIGIN=https://johnson-darko.github.io in Render env
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
    secure: process.env.SESSION_COOKIE_SECURE === 'true',
    sameSite: process.env.SESSION_COOKIE_SAMESITE || 'none',
  },
}));

// Driver: fetch only orders assigned to this driver
app.get('/driver/orders', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') {
    return res.status(403).json({ error: 'Forbidden: Drivers only' });
  }
  try {
    const result = await pool.query('SELECT * FROM orders WHERE driver_email = $1 ORDER BY date DESC', [req.session.user.email]);
    res.json({ success: true, orders: result.rows });
  } catch (err) {
    console.error('Error fetching driver orders:', err);
    res.status(500).json({ error: 'Failed to fetch driver orders' });
  }
});
// Admin: assign a cluster of orders to a driver
app.post('/assign-cluster', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admins only' });
  }
  const { driver_email, order_ids } = req.body;
  if (!driver_email || !Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: 'driver_email and order_ids[] required' });
  }
  try {
    // Insert assignment record
    await pool.query(
      'INSERT INTO assigned_clusters (driver_email, order_ids) VALUES ($1, $2)',
      [driver_email, order_ids]
    );
    // Optionally, update orders table to mark these orders as assigned to driver
    await pool.query(
      'UPDATE orders SET driver_email = $1 WHERE order_id = ANY($2)',
      [driver_email, order_ids]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') { // Unique violation
      res.status(400).json({ error: 'This cluster is already assigned to this driver.' });
    } else {
      console.error('Error assigning cluster:', err);
      res.status(500).json({ error: 'Failed to assign cluster' });
    }
  }
});


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
const crypto = require('crypto');
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
  // Generate a unique order_id (e.g., 8-char hex string)
  const orderId = crypto.randomBytes(4).toString('hex');
  const insertResult = await pool.query(
    `INSERT INTO orders (
      email, customer_name, address, location_lat, location_lng, cylinder_type, filled, unique_code, status, date, amount_paid, notes, payment_method, service_type, time_slot, delivery_window, order_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
    ) RETURNING *`,
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
      deliveryWindow || null,
      orderId
    ]
  );
  const newOrder = insertResult.rows[0];
  res.json({ success: true, order: newOrder });
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


// Customer: check/update a specific order by email and uniqueCode
app.post('/order/check', async (req, res) => {
  const { email, uniqueCode } = req.body;
  if (!email || !uniqueCode) {
    return res.status(400).json({ error: 'Email and uniqueCode required' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE email = $1 AND unique_code = $2 ORDER BY date DESC LIMIT 1',
      [email, uniqueCode]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error('Error checking order:', err);
    res.status(500).json({ error: 'Failed to check order' });
  }
});


// Driver: batch update order statuses
app.post('/driver/update-orders', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'driver') {
    return res.status(403).json({ error: 'Forbidden: Drivers only' });
  }
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'No updates provided' });
  }
  try {
    for (const update of updates) {
      const { orderId, status, failedNote } = update;
      if (!orderId || !status) continue;
      await pool.query(
        'UPDATE orders SET status = $1, failed_note = $2 WHERE order_id = $3 AND driver_email = $4',
        [status, failedNote || null, orderId, req.session.user.email]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating driver orders:', err);
    res.status(500).json({ error: 'Failed to update orders' });
  }
});


// Only allow known API routes
app.use((req, res, next) => {
  if (!req.path.startsWith('/auth') &&
      !req.path.startsWith('/order') &&
      !req.path.startsWith('/driver') &&
      !req.path.startsWith('/assign-cluster') &&
      !req.path.startsWith('/profile') &&
      !req.path.startsWith('/orders')) {
    return res.status(404).send('Not found');
  }
  next();
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Admin: fetch all orders
app.get('/orders', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admins only' });
  }
  try {
    const ordersResult = await pool.query('SELECT * FROM orders ORDER BY date DESC');
    const driversResult = await pool.query("SELECT email FROM users WHERE role = 'driver'");
    const drivers = driversResult.rows.map(row => row.email);
    res.json({ success: true, orders: ordersResult.rows, drivers });
  } catch (err) {
    console.error('Error fetching all orders or drivers:', err);
    res.status(500).json({ error: 'Failed to fetch orders or drivers' });
  }
});

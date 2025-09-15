const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const mailgun = require('mailgun-js');
require('dotenv').config();
const setupSession = require('./session');

const app = express();
app.use(bodyParser.json());
setupSession(app);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const mg = mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
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
  const data = {
    from: 'TapGas <noreply@yourdomain.com>',
    to: email,
    subject: 'Your TapGas Login Code',
    text: `Your login code is: ${code}`,
  };
  mg.messages().send(data, function (error, body) {
    if (error) return res.status(500).json({ error: 'Email failed' });
    res.json({ success: true });
  });
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
  const { product, quantity, address } = req.body;
  if (!product || !quantity || !address) {
    return res.status(400).json({ error: 'Missing order details' });
  }
  await pool.query(
    'INSERT INTO orders (email, product, quantity, address) VALUES ($1, $2, $3, $4)',
    [req.session.user.email, product, quantity, address]
  );
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

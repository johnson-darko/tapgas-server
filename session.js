const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function setupSession(app) {
  app.use(session({
    store: new pgSession({ pool }),
    secret: process.env.SESSION_SECRET || 'tapgas_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: false, // set to true if using HTTPS
    },
  }));
}

module.exports = setupSession;

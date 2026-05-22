const { pool } = require("../config/db");

async function ensureDbConnection(_req, res, next) {
  try {
    await pool.query("SELECT 1");
    return next();
  } catch (_error) {
    return res.status(503).json({
      message: "Database is unreachable. Please try again shortly."
    });
  }
}

module.exports = ensureDbConnection;

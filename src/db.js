const { Pool } = require("pg");
const { newDb } = require("pg-mem");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const ssl =
  connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false };

let activePool = new Pool({
  connectionString,
  ssl,
});

const pool = {
  query(...args) {
    return activePool.query(...args);
  },
  connect(...args) {
    return activePool.connect(...args);
  },
  end(...args) {
    return activePool.end(...args);
  },
};

function useInMemoryDatabase() {
  const db = newDb();
  const { Pool: MemPool } = db.adapters.createPg();
  activePool = new MemPool();
}

async function initDb() {
  try {
    await activePool.query("SELECT 1");
  } catch (error) {
    if (
      error &&
      (error.code === "ECONNREFUSED" ||
        error.code === "ENOTFOUND" ||
        error.code === "ETIMEDOUT" ||
        error.name === "AggregateError")
    ) {
      console.warn(
        "PostgreSQL is not reachable. Falling back to in-memory DB (data resets on restart)."
      );
      useInMemoryDatabase();
    } else {
      throw error;
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(200) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      description TEXT,
      owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      details TEXT,
      status VARCHAR(20) NOT NULL CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')) DEFAULT 'TODO',
      priority VARCHAR(20) NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')) DEFAULT 'MEDIUM',
      due_date DATE,
      created_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = {
  pool,
  initDb,
};

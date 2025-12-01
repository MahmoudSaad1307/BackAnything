import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://neondb_owner:npg_qeZiXpaQj30G@ep-dry-fire-ahz8j7dc.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  // Connection pool settings
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
  // SSL configuration - Neon requires SSL
  ssl: {
    rejectUnauthorized: false, // Required for Neon and most cloud databases
  },
  // Keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Test connection on startup
let isConnected = false;

const testConnection = async () => {
  try {
    const client = await pool.connect();
    await client.query("SELECT NOW()");
    client.release();
    isConnected = true;
    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error("❌ Database connection error:", error.message);
    isConnected = false;
  }
};

// Test connection immediately
testConnection();

// Handle connection events
pool.on("connect", (client) => {
  if (!isConnected) {
    console.log("✅ Database connection established");
    isConnected = true;
  }
});

pool.on("error", (err) => {
  console.error("❌ Unexpected database error:", err);
  isConnected = false;
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Closing database pool...");
  await pool.end();
  process.exit(0);
});

export default pool;

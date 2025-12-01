import cors from "cors";
import express from "express";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";

const app = express();
const PORT = 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Express server running" });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Express server running on http://localhost:${PORT}`);
});

// Handle server errors (like port already in use)
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `❌ Port ${PORT} is already in use. Please either:`,
      `\n   1. Stop the other process using port ${PORT}`,
      `\n   2. Change the PORT constant in server.js`,
      `\n   3. Kill the process: npx kill-port ${PORT} (if kill-port is installed)`,
      `\n   4. On Windows: netstat -ano | findstr :${PORT} then taskkill /PID <PID> /F`
    );
    process.exit(1);
  } else {
    console.error("❌ Server error:", error);
    process.exit(1);
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
  });
});

process.on("SIGINT", () => {
  console.log("\nSIGINT signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

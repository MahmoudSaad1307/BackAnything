import jwt from "jsonwebtoken";

// JWT Secret (hardcoded - must match the secret in routes/auth.js)
const JWT_SECRET = "your-super-secret-jwt-key-change-this-in-production-2024";

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }

    req.user = user;
    next();
  });
};

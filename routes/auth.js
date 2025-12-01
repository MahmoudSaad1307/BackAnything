import express from "express";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const router = express.Router();

// Signup
router.post("/signup", async (req, res) => {
  const { email, password, name } = req.body;

  try {
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      "SELECT * FROM auth_users WHERE email = $1",
      [email.toLowerCase()],
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await argon2.hash(password);

    // Create user
    const userResult = await pool.query(
      "INSERT INTO auth_users (email, name, role, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, email, name, role, created_at",
      [email.toLowerCase(), name || null, "free"],
    );

    const user = userResult.rows[0];

    // Create auth account for credentials
    await pool.query(
      'INSERT INTO auth_accounts ("userId", type, provider, "providerAccountId", password) VALUES ($1, $2, $3, $4, $5)',
      [
        user.id,
        "credentials",
        "credentials",
        email.toLowerCase(),
        hashedPassword,
      ],
    );

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Find user
    const userResult = await pool.query(
      "SELECT * FROM auth_users WHERE email = $1",
      [email.toLowerCase()],
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];

    // Get password from auth_accounts
    const accountResult = await pool.query(
      'SELECT password FROM auth_accounts WHERE "userId" = $1 AND provider = $2',
      [user.id, "credentials"],
    );

    if (accountResult.rows.length === 0 || !accountResult.rows[0].password) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const hashedPassword = accountResult.rows[0].password;

    // Verify password
    const validPassword = await argon2.verify(hashedPassword, password);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    // Log the login
    await pool.query(
      "INSERT INTO user_logins (user_id, provider, login_time) VALUES ($1, $2, NOW())",
      [user.id.toString(), "credentials"],
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

export default router;

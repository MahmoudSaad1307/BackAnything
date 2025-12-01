import argon2 from "argon2";
import express from "express";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const router = express.Router();

// JWT Secret (hardcoded)
const JWT_SECRET = "your-super-secret-jwt-key-change-this-in-production-2024";

// Environment (hardcoded - set to "development" to show error details)
const NODE_ENV = "development";

// Signup
router.post("/signup", async (req, res) => {
  const { email, password, name } = req.body;

  try {
    // Validate email presence
    if (!email) {
      return res.status(400).json({
        error: "Email is required",
        field: "email",
        code: "EMAIL_REQUIRED",
        message: "Please provide a valid email address",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format",
        field: "email",
        code: "INVALID_EMAIL_FORMAT",
        message:
          "Please provide a valid email address (e.g., user@example.com)",
      });
    }

    // Validate password presence
    if (!password) {
      return res.status(400).json({
        error: "Password is required",
        field: "password",
        code: "PASSWORD_REQUIRED",
        message: "Please provide a password",
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        error: "Password is too short",
        field: "password",
        code: "PASSWORD_TOO_SHORT",
        message: `Password must be at least 6 characters long. Current length: ${password.length}`,
        minLength: 6,
        currentLength: password.length,
      });
    }

    // Validate password length (max)
    if (password.length > 128) {
      return res.status(400).json({
        error: "Password is too long",
        field: "password",
        code: "PASSWORD_TOO_LONG",
        message: `Password must be no more than 128 characters long. Current length: ${password.length}`,
        maxLength: 128,
        currentLength: password.length,
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      "SELECT * FROM auth_users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: "Email already registered",
        field: "email",
        code: "EMAIL_ALREADY_EXISTS",
        message: `An account with the email ${email.toLowerCase()} already exists. Please use a different email or try logging in.`,
        email: email.toLowerCase(),
      });
    }

    // Hash password
    const hashedPassword = await argon2.hash(password);

    // Use transaction to ensure atomicity
    const client = await pool.connect();
    let user;

    try {
      await client.query("BEGIN");

      // Create user
      const userResult = await client.query(
        "INSERT INTO auth_users (email, name, role, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, email, name, role, created_at",
        [email.toLowerCase(), name || null, "free"]
      );

      user = userResult.rows[0];

      // Create auth account for credentials
      await client.query(
        'INSERT INTO auth_accounts ("userId", type, provider, "providerAccountId", password) VALUES ($1, $2, $3, $4, $5)',
        [
          user.id,
          "credentials",
          "credentials",
          email.toLowerCase(),
          hashedPassword,
        ]
      );

      // Commit transaction
      await client.query("COMMIT");

      // Generate JWT token (after successful DB operations)
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
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
    } catch (dbError) {
      // Rollback transaction on any error
      await client.query("ROLLBACK");
      throw dbError; // Re-throw to be handled by outer catch
    } finally {
      // Always release the client
      client.release();
    }
  } catch (error) {
    console.error("Signup error:", error);
    console.error("Error stack:", error.stack);
    console.error("Error code:", error.code);
    console.error("Error detail:", error.detail);

    // Handle JWT errors
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(500).json({
        error: "Token generation failed",
        code: "TOKEN_GENERATION_ERROR",
        message: "Failed to generate authentication token. Please try again.",
        details: NODE_ENV === "development" ? error.message : undefined,
      });
    }

    // Handle argon2 errors
    if (error.message && error.message.includes("argon2")) {
      return res.status(500).json({
        error: "Password hashing failed",
        code: "PASSWORD_HASHING_ERROR",
        message: "Failed to process password. Please try again.",
        details: NODE_ENV === "development" ? error.message : undefined,
      });
    }

    // Handle database constraint violations
    if (error.code === "23505") {
      // Unique constraint violation
      return res.status(409).json({
        error: "Database constraint violation",
        code: "DUPLICATE_ENTRY",
        message: "A user with this information already exists",
        details: error.detail || error.message,
      });
    }

    // Handle foreign key violations
    if (error.code === "23503") {
      return res.status(400).json({
        error: "Database foreign key violation",
        code: "FOREIGN_KEY_VIOLATION",
        message: "Invalid reference in database. Please contact support.",
        details: error.detail || error.message,
      });
    }

    // Handle not null violations
    if (error.code === "23502") {
      return res.status(400).json({
        error: "Database not null violation",
        code: "NOT_NULL_VIOLATION",
        message: "Required field is missing. Please check your input.",
        details: error.detail || error.message,
      });
    }

    // Handle database connection errors
    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
      return res.status(503).json({
        error: "Database connection failed",
        code: "DATABASE_CONNECTION_ERROR",
        message: "Unable to connect to the database. Please try again later.",
        details: error.message,
      });
    }

    // Handle other database errors (23xxx are PostgreSQL constraint violations)
    if (error.code && error.code.startsWith("23")) {
      return res.status(400).json({
        error: "Database validation error",
        code: "DATABASE_VALIDATION_ERROR",
        message: "The provided data violates database constraints",
        details: error.detail || error.message,
      });
    }

    // Handle syntax errors (42xxx are PostgreSQL syntax errors)
    if (error.code && error.code.startsWith("42")) {
      return res.status(500).json({
        error: "Database syntax error",
        code: "DATABASE_SYNTAX_ERROR",
        message: "A database error occurred. Please contact support.",
        details: NODE_ENV === "development" ? error.message : undefined,
      });
    }

    // Generic error with more details
    res.status(500).json({
      error: "Failed to create user",
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred while creating your account",
      details:
        NODE_ENV === "development"
          ? {
              message: error.message,
              code: error.code,
              detail: error.detail,
              stack: error.stack,
            }
          : undefined,
    });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate email presence
    if (!email) {
      return res.status(400).json({
        error: "Email is required",
        field: "email",
        code: "EMAIL_REQUIRED",
        message: "Please provide your email address",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format",
        field: "email",
        code: "INVALID_EMAIL_FORMAT",
        message:
          "Please provide a valid email address (e.g., user@example.com)",
      });
    }

    // Validate password presence
    if (!password) {
      return res.status(400).json({
        error: "Password is required",
        field: "password",
        code: "PASSWORD_REQUIRED",
        message: "Please provide your password",
      });
    }

    // Find user
    const userResult = await pool.query(
      "SELECT * FROM auth_users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid credentials",
        code: "USER_NOT_FOUND",
        message:
          "No account found with this email address. Please check your email or sign up.",
        field: "email",
      });
    }

    const user = userResult.rows[0];

    // Get password from auth_accounts
    const accountResult = await pool.query(
      'SELECT password FROM auth_accounts WHERE "userId" = $1 AND provider = $2',
      [user.id, "credentials"]
    );

    if (accountResult.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid credentials",
        code: "ACCOUNT_NOT_FOUND",
        message:
          "No credentials account found for this user. Please contact support.",
        field: "account",
      });
    }

    if (!accountResult.rows[0].password) {
      return res.status(401).json({
        error: "Invalid credentials",
        code: "PASSWORD_NOT_SET",
        message:
          "Password is not set for this account. Please reset your password or contact support.",
        field: "password",
      });
    }

    const hashedPassword = accountResult.rows[0].password;

    // Verify password
    const validPassword = await argon2.verify(hashedPassword, password);

    if (!validPassword) {
      return res.status(401).json({
        error: "Invalid credentials",
        code: "INVALID_PASSWORD",
        message: "The password you entered is incorrect. Please try again.",
        field: "password",
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Log the login
    await pool.query(
      "INSERT INTO user_logins (user_id, provider, login_time) VALUES ($1, $2, NOW())",
      [user.id.toString(), "credentials"]
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

    // Handle argon2 verification errors
    if (error.message && error.message.includes("argon2")) {
      return res.status(500).json({
        error: "Password verification failed",
        code: "PASSWORD_VERIFICATION_ERROR",
        message:
          "An error occurred while verifying your password. Please try again.",
        details: NODE_ENV === "development" ? error.message : undefined,
      });
    }

    // Handle database connection errors
    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
      return res.status(503).json({
        error: "Database connection failed",
        code: "DATABASE_CONNECTION_ERROR",
        message: "Unable to connect to the database. Please try again later.",
        details: error.message,
      });
    }

    // Handle JWT errors
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        error: "Token generation failed",
        code: "TOKEN_ERROR",
        message: "Unable to generate authentication token. Please try again.",
        details: NODE_ENV === "development" ? error.message : undefined,
      });
    }

    // Generic error
    res.status(500).json({
      error: "Failed to login",
      code: "INTERNAL_SERVER_ERROR",
      message:
        "An unexpected error occurred during login. Please try again later.",
      details: NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;

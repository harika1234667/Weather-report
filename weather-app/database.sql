-- SQLite Database Schema for Weather Forecast Website with Login & Registration
-- Beginner-friendly, secure SQL database structure

-- 1. Users Table
-- Stores registered users with securely hashed passwords
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Search History Table
-- Stores each search with city name, coordinates, date, and time
-- Linked to user_id so each user has their own private search history
CREATE TABLE IF NOT EXISTS search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    city TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    search_date TEXT NOT NULL,
    search_time TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sample Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_history_user ON search_history(user_id);

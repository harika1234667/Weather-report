"""
init_db.py - Database Initializer
Creates the SQLite database 'weather.db' and sets up tables:
- users (id, full_name, email, password_hash, created_at)
- search_history (id, user_id, city, latitude, longitude, search_date, search_time)
Run with:
    python init_db.py
"""

import sqlite3
import os

# Password hashing with Werkzeug or standard library hashlib fallback
try:
    from werkzeug.security import generate_password_hash
except ImportError:
    import hashlib
    def generate_password_hash(password: str) -> str:
        """Secure salt + sha256 hash using Python standard library."""
        salt = "skycast_salt_demo"
        h = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
        return f"sha256${salt}${h}"

DB_FILE = "weather.db"
SQL_FILE = "database.sql"

def init_db():
    print(f"[*] Initializing SQLite database '{DB_FILE}'...")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(base_dir, DB_FILE)
    sql_path = os.path.join(base_dir, SQL_FILE)

    if not os.path.exists(sql_path):
        print(f"[!] Error: Schema file '{sql_path}' not found!")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")

    # Check if existing search_history has user_id; if not, drop it so schema upgrades cleanly
    try:
        cursor.execute("SELECT user_id FROM search_history LIMIT 1")
    except sqlite3.OperationalError:
        print("[*] Upgrading search_history schema to support user_id...")
        cursor.execute("DROP TABLE IF EXISTS search_history")

    with open(sql_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    cursor.executescript(schema_sql)

    # Insert demo test account if table is empty
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        demo_hash = generate_password_hash("password123")
        cursor.execute(
            "INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)",
            ("Alex Morgan", "alex@example.com", demo_hash)
        )
        print("[✓] Created demo account: alex@example.com / password123")

    conn.commit()
    conn.close()

    print(f"[✓] Database '{DB_FILE}' initialized successfully!")

if __name__ == "__main__":
    init_db()

// Complete source code of all files in weather-app/ for interactive viewing and zip download

export interface ProjectFile {
  path: string;
  name: string;
  language: string;
  description: string;
  content: string;
}

export const PROJECT_FILES: ProjectFile[] = [
  {
    path: 'weather-app/app.py',
    name: 'app.py',
    language: 'python',
    description: 'Main Flask backend server with User Authentication (Register, Login, Password Hashing with Werkzeug), Flask Sessions, Geolocation coordinate weather lookup, city search, SQLite storage, and Gemini AI explanations.',
    content: `"""
app.py - Main Flask Application for Weather Forecast Website with Login & Registration
A beginner-friendly, secure full-stack backend with:
- Secure User Authentication (Registration, Login, Password Hashing with Werkzeug, Flask Sessions)
- Protected Weather Dashboard accessible only after login
- Geolocation coordinate lookup (lat & lon) + city search
- Real-time weather metrics: temp, feels-like, condition, humidity, wind, pressure, visibility, sunrise/sunset
- 5-day weather forecast
- SQLite database storing users and per-user search history (id, city, lat, lon, search_date, search_time)
- Google Gemini API for friendly AI weather explanations
"""

import os
import re
import sqlite3
from datetime import datetime
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import requests

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Secret key required for Flask session management
app.secret_key = os.getenv("SECRET_KEY", "skycast-super-secret-key-change-in-production-12345")

# Database & API configuration
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weather.db")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# WMO Weather code mapping for Open-Meteo fallback
WMO_WEATHER_CODES = {
    0: ("Clear sky", "01d"),
    1: ("Mainly clear", "02d"),
    2: ("Partly cloudy", "03d"),
    3: ("Overcast", "04d"),
    45: ("Foggy", "50d"),
    48: ("Depositing rime fog", "50d"),
    51: ("Light drizzle", "09d"),
    53: ("Moderate drizzle", "09d"),
    55: ("Dense drizzle", "09d"),
    61: ("Slight rain", "10d"),
    63: ("Moderate rain", "10d"),
    65: ("Heavy rain", "10d"),
    71: ("Slight snow", "13d"),
    73: ("Moderate snow", "13d"),
    75: ("Heavy snow", "13d"),
    77: ("Snow grains", "13d"),
    80: ("Slight rain showers", "09d"),
    81: ("Moderate rain showers", "09d"),
    82: ("Violent rain showers", "09d"),
    85: ("Slight snow showers", "13d"),
    86: ("Heavy snow showers", "13d"),
    95: ("Thunderstorm", "11d"),
    96: ("Thunderstorm with hail", "11d"),
    99: ("Thunderstorm with heavy hail", "11d")
}


# ==========================================
# 1. DATABASE HELPERS & INITIALIZATION
# ==========================================
def get_db_connection():
    """Create and return an SQLite connection with dictionary row access."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_database():
    """Ensure SQLite database, users, and search_history tables exist."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Users table (Stores registered users with hashed passwords)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. Search history table (Stores city, lat, lon, date, time per user)
    cursor.execute("""
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
        )
    """)

    # Create demo user for easy testing if no users exist
    cursor.execute("SELECT COUNT(*) as count FROM users")
    count = cursor.fetchone()["count"]
    if count == 0:
        demo_password_hash = generate_password_hash("password123")
        cursor.execute(
            """
            INSERT INTO users (full_name, email, password_hash)
            VALUES (?, ?, ?)
            """,
            ("Alex Morgan", "alex@example.com", demo_password_hash)
        )

    conn.commit()
    conn.close()


# Initialize database upon startup
init_database()


def login_required(f):
    """Decorator to require login before accessing protected routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function


def save_search_to_db(user_id: int, city_name: str, lat: float = None, lon: float = None):
    """Insert a search record into SQLite with parameterized queries."""
    now = datetime.now()
    search_date = now.strftime("%Y-%m-%d")
    search_time = now.strftime("%H:%M:%S")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO search_history (user_id, city, latitude, longitude, search_date, search_time) 
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, city_name, lat, lon, search_date, search_time)
    )
    conn.commit()
    conn.close()


def get_search_history(user_id: int = None, limit: int = 10):
    """Fetch recent searches for the logged-in user from SQLite."""
    conn = get_db_connection()
    cursor = conn.cursor()

    if user_id:
        cursor.execute(
            """
            SELECT id, city, latitude, longitude, search_date, search_time 
            FROM search_history 
            WHERE user_id = ?
            ORDER BY id DESC LIMIT ?
            """,
            (user_id, limit)
        )
    else:
        cursor.execute(
            """
            SELECT id, city, latitude, longitude, search_date, search_time 
            FROM search_history 
            ORDER BY id DESC LIMIT ?
            """,
            (limit,)
        )

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": row["id"],
            "city": row["city"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "search_date": row["search_date"],
            "search_time": row["search_time"]
        }
        for row in rows
    ]


# ==========================================
# 2. WEATHER API HELPERS
# ==========================================
def format_time_from_iso(iso_string: str) -> str:
    """Format ISO datetime string or timestamp into friendly HH:MM AM/PM."""
    try:
        if "T" in iso_string:
            dt = datetime.fromisoformat(iso_string)
            return dt.strftime("%I:%M %p")
        return iso_string
    except Exception:
        return iso_string


def fetch_weather_openweather(city: str = None, lat: float = None, lon: float = None):
    """Fetch complete weather metrics from OpenWeatherMap API using city or coordinates."""
    if not OPENWEATHER_API_KEY or OPENWEATHER_API_KEY == "your_openweathermap_api_key_here":
        return None

    try:
        if lat is not None and lon is not None:
            query = f"lat={lat}&lon={lon}"
        elif city:
            query = f"q={city}"
        else:
            return None

        # 1. Fetch current weather
        current_url = f"https://api.openweathermap.org/data/2.5/weather?{query}&units=metric&appid={OPENWEATHER_API_KEY}"
        current_res = requests.get(current_url, timeout=6)
        if current_res.status_code != 200:
            return None
        c_data = current_res.json()

        actual_lat = c_data.get("coord", {}).get("lat", lat)
        actual_lon = c_data.get("coord", {}).get("lon", lon)

        # 2. Fetch 5-day forecast
        forecast_url = f"https://api.openweathermap.org/data/2.5/forecast?lat={actual_lat}&lon={actual_lon}&units=metric&appid={OPENWEATHER_API_KEY}"
        forecast_res = requests.get(forecast_url, timeout=6)
        forecast_list = []
        if forecast_res.status_code == 200:
            raw_forecast = forecast_res.json().get("list", [])
            daily_picks = {}
            for item in raw_forecast:
                dt_txt = item.get("dt_txt", "")
                date_part = dt_txt.split(" ")[0] if " " in dt_txt else ""
                if date_part not in daily_picks and "12:00:00" in dt_txt:
                    daily_picks[date_part] = item
                elif date_part not in daily_picks:
                    daily_picks[date_part] = item

            for date_key, item in list(daily_picks.items())[:5]:
                d = datetime.strptime(date_key, "%Y-%m-%d")
                forecast_list.append({
                    "day": d.strftime("%a"),
                    "date": d.strftime("%b %d"),
                    "temp_max": round(item["main"]["temp_max"]),
                    "temp_min": round(item["main"]["temp_min"]),
                    "condition": item["weather"][0]["main"],
                    "icon": f"https://openweathermap.org/img/wn/{item['weather'][0]['icon']}@2x.png"
                })

        # Calculate sunrise & sunset
        sys_data = c_data.get("sys", {})
        sunrise_ts = sys_data.get("sunrise")
        sunset_ts = sys_data.get("sunset")
        sunrise_str = datetime.fromtimestamp(sunrise_ts).strftime("%I:%M %p") if sunrise_ts else "--"
        sunset_str = datetime.fromtimestamp(sunset_ts).strftime("%I:%M %p") if sunset_ts else "--"

        # Calculate visibility (convert meters to km)
        vis_meters = c_data.get("visibility", 10000)
        visibility_km = round(vis_meters / 1000, 1)

        city_name = f"{c_data.get('name')}, {sys_data.get('country', '')}".strip(", ")

        return {
            "city": city_name or "Detected Location",
            "latitude": round(actual_lat, 4) if actual_lat else None,
            "longitude": round(actual_lon, 4) if actual_lon else None,
            "temperature": round(c_data["main"]["temp"], 1),
            "feels_like": round(c_data["main"]["feels_like"], 1),
            "condition": c_data["weather"][0]["main"],
            "description": c_data["weather"][0]["description"].capitalize(),
            "humidity": c_data["main"]["humidity"],
            "wind_speed": round(c_data["wind"]["speed"] * 3.6, 1),
            "pressure": c_data["main"].get("pressure", 1013),
            "visibility": f"{visibility_km} km",
            "sunrise": sunrise_str,
            "sunset": sunset_str,
            "icon": f"https://openweathermap.org/img/wn/{c_data['weather'][0]['icon']}@2x.png",
            "forecast": forecast_list
        }
    except Exception as e:
        print(f"[!] OpenWeatherMap error: {e}")
        return None


def fetch_weather_openmeteo(city: str = None, lat: float = None, lon: float = None):
    """
    Zero-configuration fallback using free Open-Meteo & reverse geocoding APIs.
    Works automatically without an API key!
    """
    try:
        resolved_city = city

        if city and (lat is None or lon is None):
            geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en&format=json"
            geo_res = requests.get(geo_url, timeout=6)
            if geo_res.status_code != 200:
                return None
            geo_data = geo_res.json()
            results = geo_data.get("results")
            if not results:
                return None
            loc = results[0]
            lat = loc["latitude"]
            lon = loc["longitude"]
            resolved_city = f"{loc.get('name')}, {loc.get('country_code', '')}".strip(", ")

        elif lat is not None and lon is not None and not resolved_city:
            try:
                rev_url = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lon}&localityLanguage=en"
                rev_res = requests.get(rev_url, timeout=5)
                if rev_res.status_code == 200:
                    rdata = rev_res.json()
                    loc_name = rdata.get("city") or rdata.get("locality") or rdata.get("principalSubdivision") or "Current Location"
                    country = rdata.get("countryCode", "")
                    resolved_city = f"{loc_name}, {country}".strip(", ")
                else:
                    resolved_city = f"Location ({lat:.2f}, {lon:.2f})"
            except Exception:
                resolved_city = f"Location ({lat:.2f}, {lon:.2f})"

        weather_url = (
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure"
            f"&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto"
        )
        w_res = requests.get(weather_url, timeout=6)
        if w_res.status_code != 200:
            return None
        w_data = w_res.json()

        curr = w_data.get("current", {})
        daily = w_data.get("daily", {})

        weather_code = curr.get("weather_code", 0)
        cond_name, icon_code = WMO_WEATHER_CODES.get(weather_code, ("Clear sky", "01d"))

        sunrises = daily.get("sunrise", [])
        sunsets = daily.get("sunset", [])
        sunrise_str = format_time_from_iso(sunrises[0]) if sunrises else "06:30 AM"
        sunset_str = format_time_from_iso(sunsets[0]) if sunsets else "07:30 PM"

        forecast_list = []
        dates = daily.get("time", [])
        max_temps = daily.get("temperature_2m_max", [])
        min_temps = daily.get("temperature_2m_min", [])
        codes = daily.get("weather_code", [])

        for i in range(min(5, len(dates))):
            d_str = dates[i]
            d = datetime.strptime(d_str, "%Y-%m-%d")
            c_code = codes[i] if i < len(codes) else 0
            c_cond, c_icon = WMO_WEATHER_CODES.get(c_code, ("Clear", "01d"))
            forecast_list.append({
                "day": d.strftime("%a"),
                "date": d.strftime("%b %d"),
                "temp_max": round(max_temps[i]) if i < len(max_temps) else round(curr.get("temperature_2m", 20)),
                "temp_min": round(min_temps[i]) if i < len(min_temps) else round(curr.get("temperature_2m", 15)),
                "condition": c_cond,
                "icon": f"https://openweathermap.org/img/wn/{c_icon}@2x.png"
            })

        return {
            "city": resolved_city or "Current Location",
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "temperature": round(curr.get("temperature_2m", 0), 1),
            "feels_like": round(curr.get("apparent_temperature", 0), 1),
            "condition": cond_name,
            "description": cond_name,
            "humidity": curr.get("relative_humidity_2m", 0),
            "wind_speed": round(curr.get("wind_speed_10m", 0), 1),
            "pressure": round(curr.get("surface_pressure", 1013)),
            "visibility": "10 km",
            "sunrise": sunrise_str,
            "sunset": sunset_str,
            "icon": f"https://openweathermap.org/img/wn/{icon_code}@2x.png",
            "forecast": forecast_list
        }
    except Exception as e:
        print(f"[!] Open-Meteo error: {e}")
        return None


# ==========================================
# 3. GEMINI AI WEATHER EXPLANATION
# ==========================================
def generate_ai_explanation(weather_data: dict, is_current_location: bool = False) -> str:
    """Generate a friendly, concise explanation using Google Gemini API."""
    city = weather_data.get("city", "your location")
    temp = weather_data.get("temperature", 20)
    condition = weather_data.get("condition", "clear")
    humidity = weather_data.get("humidity", 50)
    wind = weather_data.get("wind_speed", 10)

    location_prefix = "Your current location" if is_current_location else f"{city}"
    default_summary = (
        f"{location_prefix} is {condition.lower()} today. "
        f"The temperature is {temp}°C with {humidity}% humidity, so dress comfortably!"
    )

    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        return default_summary

    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)

        prompt = (
            f"You are a friendly weather assistant. Given this current weather:\\n"
            f"Location: {city} (User's current location: {is_current_location})\\n"
            f"Temperature: {temp}°C\\n"
            f"Condition: {condition}\\n"
            f"Humidity: {humidity}%\\n"
            f"Wind Speed: {wind} km/h\\n\\n"
            f"Provide a short, simple, warm explanation of the weather for the user and a quick practical tip. "
            f"For example: 'Your current location is warm and cloudy today. The temperature is {temp}°C with high humidity.' "
            f"Keep it under 35 words."
        )

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        if response and response.text:
            return response.text.strip().replace('"', '')
        return default_summary

    except Exception as e:
        print(f"[!] Gemini AI call error: {e}")
        return default_summary


# ==========================================
# 4. AUTHENTICATION ROUTES (LOGIN / REGISTER / LOGOUT)
# ==========================================
@app.route("/")
def index():
    """Root route: Redirect to dashboard if logged in, otherwise to login."""
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    """Handle user login with email and hashed password verification."""
    if "user_id" in session:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        email_or_user = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not email_or_user or not password:
            return render_template("login.html", error="Please enter both email and password.")

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email_or_user,))
        user = cursor.fetchone()
        conn.close()

        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["user_name"] = user["full_name"]
            session["user_email"] = user["email"]
            return redirect(url_for("dashboard"))
        else:
            return render_template("login.html", error="Invalid email or password. Please try again.")

    return render_template("login.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    """Handle new user registration with password validation and hashing."""
    if "user_id" in session:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        if not full_name or not email or not password or not confirm_password:
            return render_template("register.html", error="All fields are required.")

        email_regex = r"^[\\w\\.-]+@[\\w\\.-]+\\.\\w+$"
        if not re.match(email_regex, email):
            return render_template("register.html", error="Please enter a valid email address.")

        if len(password) < 6:
            return render_template("register.html", error="Password must be at least 6 characters long.")

        if password != confirm_password:
            return render_template("register.html", error="Passwords do not match.")

        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email,))
        if cursor.fetchone():
            conn.close()
            return render_template("register.html", error="This email is already registered. Please login.")

        password_hash = generate_password_hash(password)

        cursor.execute(
            """
            INSERT INTO users (full_name, email, password_hash)
            VALUES (?, ?, ?)
            """,
            (full_name, email, password_hash)
        )
        conn.commit()
        conn.close()

        return render_template("login.html", success="Account created successfully! Please login with your credentials.")

    return render_template("register.html")


@app.route("/logout")
def logout():
    """Clear user session and redirect to login page."""
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard():
    """Protected Weather Dashboard accessible only to logged-in users."""
    user = {
        "id": session.get("user_id"),
        "full_name": session.get("user_name", "Explorer"),
        "email": session.get("user_email", "")
    }
    return render_template("dashboard.html", user=user)


# ==========================================
# 5. WEATHER & HISTORY API ROUTES
# ==========================================
@app.route("/weather/location", methods=["POST"])
def weather_location():
    """
    POST /weather/location
    Endpoint to receive user's current GPS coordinates (latitude & longitude)
    via JavaScript fetch() and return complete real-time weather metrics,
    reverse-geocoded location name, 5-day forecast, and Gemini AI explanation.
    """
    data = request.get_json(silent=True) or request.form or {}
    lat_val = data.get("latitude") if data.get("latitude") is not None else data.get("lat")
    lon_val = data.get("longitude") if data.get("longitude") is not None else data.get("lon")

    if lat_val is None or lon_val is None:
        return jsonify({"error": "Unable to detect your current location. Please try again."}), 400

    try:
        lat = float(lat_val)
        lon = float(lon_val)
    except (ValueError, TypeError):
        return jsonify({"error": "Unable to detect your current location. Please try again."}), 400

    # 1. Fetch weather directly with coordinates (OpenWeatherMap or Open-Meteo fallback)
    weather_data = fetch_weather_openweather(lat=lat, lon=lon)
    if not weather_data:
        weather_data = fetch_weather_openmeteo(lat=lat, lon=lon)

    if not weather_data:
        return jsonify({"error": "Unable to retrieve weather information. Please try again."}), 502

    # 2. Save location search to SQLite for the logged-in user
    user_id = session.get("user_id")
    try:
        save_search_to_db(
            user_id=user_id,
            city_name=weather_data["city"],
            lat=weather_data.get("latitude"),
            lon=weather_data.get("longitude")
        )
    except Exception as e:
        print(f"[!] DB Save error: {e}")

    # 3. Generate Gemini AI weather explanation
    ai_summary = generate_ai_explanation(weather_data, is_current_location=True)

    # 4. Fetch updated search history for current user
    history = get_search_history(user_id=user_id, limit=8)

    return jsonify({
        "success": True,
        "message": "Current location detected.",
        "is_current_location": True,
        "current": {
            "city": weather_data["city"],
            "latitude": weather_data["latitude"],
            "longitude": weather_data["longitude"],
            "temperature": weather_data["temperature"],
            "feels_like": weather_data["feels_like"],
            "condition": weather_data["condition"],
            "description": weather_data["description"],
            "humidity": weather_data["humidity"],
            "wind_speed": weather_data["wind_speed"],
            "pressure": weather_data["pressure"],
            "visibility": weather_data["visibility"],
            "sunrise": weather_data["sunrise"],
            "sunset": weather_data["sunset"],
            "icon": weather_data["icon"]
        },
        "forecast": weather_data["forecast"],
        "ai_explanation": ai_summary,
        "history": history
    })


@app.route("/api/weather")
def get_weather():
    city = request.args.get("city", "").strip()
    lat_param = request.args.get("lat")
    lon_param = request.args.get("lon")

    lat = float(lat_param) if lat_param else None
    lon = float(lon_param) if lon_param else None
    is_coords = lat is not None and lon is not None

    if not city and not is_coords:
        return jsonify({"error": "Please provide a city name or enable location access."}), 400

    weather_data = fetch_weather_openweather(city=city, lat=lat, lon=lon)
    if not weather_data:
        weather_data = fetch_weather_openmeteo(city=city, lat=lat, lon=lon)

    if not weather_data:
        target = f"Coordinates ({lat}, {lon})" if is_coords else f"City '{city}'"
        return jsonify({"error": f"{target} could not be resolved. Please verify your input."}), 404

    user_id = session.get("user_id")
    try:
        save_search_to_db(
            user_id=user_id,
            city_name=weather_data["city"],
            lat=weather_data.get("latitude"),
            lon=weather_data.get("longitude")
        )
    except Exception as e:
        print(f"[!] DB Save error: {e}")

    ai_summary = generate_ai_explanation(weather_data, is_current_location=is_coords)
    history = get_search_history(user_id=user_id, limit=8)

    return jsonify({
        "success": True,
        "is_current_location": is_coords,
        "current": {
            "city": weather_data["city"],
            "latitude": weather_data["latitude"],
            "longitude": weather_data["longitude"],
            "temperature": weather_data["temperature"],
            "feels_like": weather_data["feels_like"],
            "condition": weather_data["condition"],
            "description": weather_data["description"],
            "humidity": weather_data["humidity"],
            "wind_speed": weather_data["wind_speed"],
            "pressure": weather_data["pressure"],
            "visibility": weather_data["visibility"],
            "sunrise": weather_data["sunrise"],
            "sunset": weather_data["sunset"],
            "icon": weather_data["icon"]
        },
        "forecast": weather_data["forecast"],
        "ai_explanation": ai_summary,
        "history": history
    })


@app.route("/api/history")
def history_endpoint():
    user_id = session.get("user_id")
    history = get_search_history(user_id=user_id, limit=10)
    return jsonify({"success": True, "history": history})


@app.route("/api/history/clear", methods=["POST"])
def clear_history_endpoint():
    user_id = session.get("user_id")
    conn = get_db_connection()
    cursor = conn.cursor()
    if user_id:
        cursor.execute("DELETE FROM search_history WHERE user_id = ?", (user_id,))
    else:
        cursor.execute("DELETE FROM search_history")
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Search history cleared successfully."})


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print(f"[*] Starting SkyCast Weather App with Login/Registration at http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
`
  },
  {
    path: 'weather-app/database.sql',
    name: 'database.sql',
    language: 'sql',
    description: 'SQLite database schema creating the users table (with hashed passwords) and the search_history table (with user_id, city, latitude, longitude, search_date, and search_time).',
    content: `-- SQLite Database Schema for Weather Forecast Website with Login & Registration
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
`
  },
  {
    path: 'weather-app/templates/login.html',
    name: 'login.html',
    language: 'html',
    description: 'Professional Login webpage with email/username, password, login button, "Create Account" link, and "Forgot Password?" dialog.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - SkyCast Weather</title>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/static/style.css">
</head>
<body class="auth-page">
    <div class="auth-wrapper">
        <div class="auth-card">
            <!-- Brand -->
            <div class="auth-brand">
                <div class="brand-icon-large">⛅</div>
                <h1 class="auth-title">Welcome to SkyCast</h1>
                <p class="auth-subtitle">Login to access your personalized live weather dashboard</p>
            </div>

            <!-- Error message if any -->
            {% if error %}
            <div class="alert-banner alert-error mb-4">
                <span class="alert-icon">⚠️</span>
                <span>{{ error }}</span>
            </div>
            {% endif %}

            <!-- Success message if redirected from registration -->
            {% if success %}
            <div class="alert-banner alert-success mb-4">
                <span class="alert-icon">✅</span>
                <span>{{ success }}</span>
            </div>
            {% endif %}

            <!-- Login Form -->
            <form action="/login" method="POST" class="auth-form" id="login-form">
                <div class="form-group">
                    <label for="email">Email or Username</label>
                    <div class="input-with-icon">
                        <span class="input-icon">✉️</span>
                        <input 
                            type="text" 
                            id="email" 
                            name="email" 
                            placeholder="e.g. alex@example.com" 
                            required 
                            autocomplete="username"
                        />
                    </div>
                </div>

                <div class="form-group">
                    <div class="label-row">
                        <label for="password">Password</label>
                        <a href="javascript:void(0)" onclick="openForgotModal()" class="forgot-link">Forgot Password?</a>
                    </div>
                    <div class="input-with-icon">
                        <span class="input-icon">🔒</span>
                        <input 
                            type="password" 
                            id="password" 
                            name="password" 
                            placeholder="Enter your password" 
                            required 
                            autocomplete="current-password"
                        />
                    </div>
                </div>

                <button type="submit" class="btn-auth-primary">
                    <span>Login to Dashboard</span>
                    <span class="btn-arrow">→</span>
                </button>

                <!-- Demo Account Quick Fill Button -->
                <button type="button" class="btn-auth-secondary" onclick="fillDemoAccount()">
                    <span>⚡ Quick Test Login (Demo Account)</span>
                </button>
            </form>

            <!-- Bottom redirect link -->
            <div class="auth-footer">
                <p>Don't have an account? <a href="/register" class="auth-link">Create Account</a></p>
            </div>
        </div>
    </div>

    <!-- Forgot Password Modal -->
    <div id="forgot-modal" class="modal-overlay hidden">
        <div class="modal-card">
            <div class="modal-header">
                <h3>Forgot Password</h3>
                <button type="button" class="modal-close" onclick="closeForgotModal()">&times;</button>
            </div>
            <div class="modal-body">
                <p class="modal-instruction">Enter your registered email address to receive password reset instructions.</p>
                <div class="form-group">
                    <label for="reset-email">Email Address</label>
                    <div class="input-with-icon">
                        <span class="input-icon">✉️</span>
                        <input type="email" id="reset-email" placeholder="name@example.com" />
                    </div>
                </div>
                <div id="reset-status" class="alert-banner alert-success hidden">
                    <span>A password reset link has been dispatched to your email.</span>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn-primary" onclick="simulateReset()">Send Reset Link</button>
                <button type="button" class="btn-secondary" onclick="closeForgotModal()">Close</button>
            </div>
        </div>
    </div>

    <script>
        function fillDemoAccount() {
            document.getElementById('email').value = 'alex@example.com';
            document.getElementById('password').value = 'password123';
        }

        function openForgotModal() {
            document.getElementById('forgot-modal').classList.remove('hidden');
        }

        function closeForgotModal() {
            document.getElementById('forgot-modal').classList.add('hidden');
        }

        function simulateReset() {
            const email = document.getElementById('reset-email').value;
            if (!email) {
                alert('Please enter your email address.');
                return;
            }
            document.getElementById('reset-status').classList.remove('hidden');
            setTimeout(() => {
                closeForgotModal();
            }, 2500);
        }
    </script>
</body>
</html>
`
  },
  {
    path: 'weather-app/templates/register.html',
    name: 'register.html',
    language: 'html',
    description: 'Registration webpage with Full Name, Email, Password, Confirm Password, Register button, and "Already have an account? Login" link.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Account - SkyCast Weather</title>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/static/style.css">
</head>
<body class="auth-page">
    <div class="auth-wrapper">
        <div class="auth-card">
            <!-- Brand -->
            <div class="auth-brand">
                <div class="brand-icon-large">⛅</div>
                <h1 class="auth-title">Create an Account</h1>
                <p class="auth-subtitle">Register to unlock your personalized real-time weather dashboard</p>
            </div>

            <!-- Error message if any -->
            {% if error %}
            <div class="alert-banner alert-error mb-4">
                <span class="alert-icon">⚠️</span>
                <span>{{ error }}</span>
            </div>
            {% endif %}

            <!-- Registration Form -->
            <form action="/register" method="POST" class="auth-form" id="register-form" onsubmit="return validateRegisterForm()">
                <div class="form-group">
                    <label for="full_name">Full Name</label>
                    <div class="input-with-icon">
                        <span class="input-icon">👤</span>
                        <input 
                            type="text" 
                            id="full_name" 
                            name="full_name" 
                            placeholder="John Doe" 
                            required 
                            autocomplete="name"
                        />
                    </div>
                </div>

                <div class="form-group">
                    <label for="email">Email Address</label>
                    <div class="input-with-icon">
                        <span class="input-icon">✉️</span>
                        <input 
                            type="email" 
                            id="email" 
                            name="email" 
                            placeholder="name@example.com" 
                            required 
                            autocomplete="email"
                        />
                    </div>
                </div>

                <div class="form-group">
                    <label for="password">Password</label>
                    <div class="input-with-icon">
                        <span class="input-icon">🔒</span>
                        <input 
                            type="password" 
                            id="password" 
                            name="password" 
                            placeholder="Create a password (min 6 characters)" 
                            required 
                            autocomplete="new-password"
                            minlength="6"
                        />
                    </div>
                    <span class="input-hint">Must be at least 6 characters long</span>
                </div>

                <div class="form-group">
                    <label for="confirm_password">Confirm Password</label>
                    <div class="input-with-icon">
                        <span class="input-icon">🛡️</span>
                        <input 
                            type="password" 
                            id="confirm_password" 
                            name="confirm_password" 
                            placeholder="Re-enter your password" 
                            required 
                            autocomplete="new-password"
                            minlength="6"
                        />
                    </div>
                </div>

                <button type="submit" class="btn-auth-primary">
                    <span>Register Account</span>
                    <span class="btn-arrow">→</span>
                </button>
            </form>

            <!-- Bottom redirect link -->
            <div class="auth-footer">
                <p>Already have an account? <a href="/login" class="auth-link">Login</a></p>
            </div>
        </div>
    </div>

    <script>
        function validateRegisterForm() {
            const pw = document.getElementById('password').value;
            const cpw = document.getElementById('confirm_password').value;
            if (pw !== cpw) {
                alert("Passwords do not match. Please re-enter.");
                return false;
            }
            if (pw.length < 6) {
                alert("Password must be at least 6 characters long.");
                return false;
            }
            return true;
        }
    </script>
</body>
</html>
`
  },
  {
    path: 'weather-app/templates/dashboard.html',
    name: 'dashboard.html',
    language: 'html',
    description: 'Protected Weather Dashboard showing personalized welcome greeting, "Use My Current Location" button, weather metrics, 5-day forecast, Gemini AI explanation, and logout button.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Weather Dashboard - SkyCast</title>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/static/style.css">
</head>
<body>
    <div class="app-wrapper">
        <!-- Top Navigation Bar -->
        <header class="app-header">
            <div class="brand">
                <span class="brand-icon">⛅</span>
                <div>
                    <h1 class="brand-title">SkyCast Weather</h1>
                    <p class="brand-subtitle">
                        Welcome back, <strong class="user-greeting-name">{{ user.full_name }}</strong> 👋
                    </p>
                </div>
            </div>
            
            <div class="header-actions">
                <!-- Temperature Unit Switcher (°C / °F) -->
                <div class="unit-toggle" role="group" aria-label="Temperature unit selection">
                    <button id="btn-celsius" class="unit-btn active" title="Show temperature in Celsius">°C</button>
                    <button id="btn-fahrenheit" class="unit-btn" title="Show temperature in Fahrenheit">°F</button>
                </div>

                <!-- User profile badge -->
                <div class="user-pill" title="Logged in as {{ user.email }}">
                    <span class="pill-avatar">👤</span>
                    <span class="pill-name">{{ user.full_name.split(' ')[0] }}</span>
                </div>

                <!-- Logout Button -->
                <a href="/logout" class="btn-logout" title="Sign out of your session">
                    <span>Logout 🚪</span>
                </a>
            </div>
        </header>

        <!-- Current Location Action Banner -->
        <section class="location-banner">
            <div class="location-banner-text">
                <h3>Get Weather for Your Current Location</h3>
                <p>Click the button below to detect your latitude & longitude via browser Geolocation.</p>
                <div id="location-status-badge" class="location-status-badge hidden"></div>
            </div>
            <button id="btn-current-location" class="btn-location-action" type="button">
                <span>📍 Use My Current Location</span>
            </button>
        </section>

        <!-- City Search Section -->
        <section class="search-section">
            <form id="search-form" class="search-form" onsubmit="return false;">
                <div class="search-input-group">
                    <span class="search-icon">🔍</span>
                    <input 
                        type="text" 
                        id="city-input" 
                        placeholder="Search for any city (e.g. London, Paris, Tokyo, New York)..." 
                        autocomplete="off"
                    />
                    <button type="submit" id="search-btn" class="btn-primary">
                        <span>Search</span>
                    </button>
                </div>
            </form>

            <!-- Quick City Shortcut Chips -->
            <div class="quick-cities">
                <span class="quick-title">Popular Cities:</span>
                <button class="quick-chip" data-city="London">London</button>
                <button class="quick-chip" data-city="New York">New York</button>
                <button class="quick-chip" data-city="Tokyo">Tokyo</button>
                <button class="quick-chip" data-city="Paris">Paris</button>
                <button class="quick-chip" data-city="Sydney">Sydney</button>
                <button class="quick-chip" data-city="San Francisco">San Francisco</button>
            </div>
        </section>

        <!-- Loading State Indicator -->
        <div id="loading-spinner" class="loading-state hidden">
            <div class="spinner"></div>
            <p id="loading-text">Fetching live weather data... Please wait</p>
        </div>

        <!-- Error Notification Banner -->
        <div id="error-banner" class="alert-banner alert-error hidden">
            <span class="alert-icon">⚠️</span>
            <div class="alert-content">
                <p id="error-message">City not found or location permission denied.</p>
            </div>
        </div>

        <!-- Weather Results Container -->
        <main id="weather-results" class="weather-results hidden">
            
            <!-- Current Weather Card -->
            <section class="current-weather-card">
                <div class="weather-top-bar">
                    <div>
                        <div class="location-title-row">
                            <span id="location-badge" class="location-pin-badge hidden">📍 Current Location</span>
                            <h2 id="current-city" class="city-name">Detected City</h2>
                        </div>
                        <p id="current-date" class="date-time">Today</p>
                    </div>

                    <div class="top-bar-right">
                        <span id="weather-condition-tag" class="condition-badge">Cloudy</span>
                    </div>
                </div>

                <div class="weather-hero">
                    <img id="current-icon" class="weather-big-icon" src="https://openweathermap.org/img/wn/02d@2x.png" alt="Weather Condition">
                    <div class="temperature-block">
                        <span id="current-temp" class="big-temp">24</span>
                        <span class="temp-unit">°C</span>
                    </div>
                </div>

                <p id="current-desc" class="weather-desc">Scattered clouds across the area</p>

                <!-- Weather Metrics Grid (Feels Like, Humidity, Wind, Pressure, Visibility, Sunrise/Sunset) -->
                <div class="metrics-grid">
                    <div class="metric-item">
                        <span class="metric-icon">🌡️</span>
                        <div>
                            <span class="metric-label">Feels Like</span>
                            <span id="metric-feels" class="metric-value">25°C</span>
                        </div>
                    </div>

                    <div class="metric-item">
                        <span class="metric-icon">💧</span>
                        <div>
                            <span class="metric-label">Humidity</span>
                            <span id="metric-humidity" class="metric-value">60%</span>
                        </div>
                    </div>

                    <div class="metric-item">
                        <span class="metric-icon">💨</span>
                        <div>
                            <span class="metric-label">Wind Speed</span>
                            <span id="metric-wind" class="metric-value">14 km/h</span>
                        </div>
                    </div>

                    <div class="metric-item">
                        <span class="metric-icon">🧭</span>
                        <div>
                            <span class="metric-label">Pressure</span>
                            <span id="metric-pressure" class="metric-value">1013 hPa</span>
                        </div>
                    </div>

                    <div class="metric-item">
                        <span class="metric-icon">👁️</span>
                        <div>
                            <span class="metric-label">Visibility</span>
                            <span id="metric-visibility" class="metric-value">10 km</span>
                        </div>
                    </div>

                    <div class="metric-item">
                        <span class="metric-icon">🌅</span>
                        <div>
                            <span class="metric-label">Sunrise / Sunset</span>
                            <span id="metric-sun" class="metric-value">06:30 AM / 07:45 PM</span>
                        </div>
                    </div>
                </div>

                <!-- Google Gemini AI Weather Explanation Feature -->
                <div class="ai-box">
                    <div class="ai-header">
                        <span class="ai-badge">✨ Google Gemini AI Weather Explanation</span>
                    </div>
                    <p id="ai-explanation-text" class="ai-text">
                        "Your current location is pleasantly warm today. The temperature is 24°C with mild wind, making it a great day for outdoor activities."
                    </p>
                </div>
            </section>

            <!-- 5-Day Weather Forecast Section -->
            <section class="forecast-section">
                <h3 class="section-title">5-Day Weather Forecast</h3>
                <div id="forecast-grid" class="forecast-grid">
                    <!-- 5 forecast cards injected dynamically by script.js -->
                </div>
            </section>

        </main>

        <!-- Search History Section (Stored in SQL database) -->
        <section class="history-section">
            <div class="history-header">
                <div class="history-title-group">
                    <span class="history-icon">🕒</span>
                    <h3 class="section-title">Recent Searches (Saved in SQLite Database)</h3>
                </div>
                <button id="clear-history-btn" class="btn-clear" title="Clear your search history from the database">
                    <span>🗑️ Clear History</span>
                </button>
            </div>

            <div id="history-list" class="history-list">
                <p class="history-empty">No recent searches yet. Search a city or click "Use My Current Location" above!</p>
            </div>
        </section>

        <!-- Footer -->
        <footer class="app-footer">
            <p>SkyCast Weather • Python with Flask Sessions • SQLite • Geolocation API • Google Gemini AI</p>
        </footer>
    </div>

    <!-- Frontend JavaScript -->
    <script src="/static/script.js"></script>
</body>
</html>
`
  },
  {
    path: 'weather-app/static/style.css',
    name: 'style.css',
    language: 'css',
    description: 'Complete modern responsive CSS stylesheets for login page, registration page, weather dashboard, metrics grid, forecast cards, and modals.',
    content: `/* 
 * style.css - Complete styling for SkyCast Weather Forecast App
 * Modern, clean, responsive CSS with CSS variables and flexbox/grid layout
 */

:root {
    --bg-dark: #090d16;
    --card-bg: rgba(18, 24, 38, 0.75);
    --card-border: rgba(255, 255, 255, 0.08);
    --accent-blue: #38bdf8;
    --accent-indigo: #818cf8;
    --accent-emerald: #10b981;
    --text-primary: #f8fafc;
    --text-muted: #94a3b8;
    --text-sub: #cbd5e1;
    --danger: #ef4444;
    --danger-bg: rgba(239, 68, 68, 0.15);
    --border-radius: 16px;
    --shadow-soft: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    --transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background-color: var(--bg-dark);
    background-image: 
        radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(129, 140, 248, 0.12) 0px, transparent 50%);
    background-attachment: fixed;
    color: var(--text-primary);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: 24px 16px;
    line-height: 1.5;
}

.app-wrapper {
    width: 100%;
    max-width: 840px;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

/* Header */
.app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    backdrop-filter: blur(12px);
    border-radius: var(--border-radius);
    box-shadow: var(--shadow-soft);
}

.brand {
    display: flex;
    align-items: center;
    gap: 12px;
}

.brand-icon {
    font-size: 2rem;
    line-height: 1;
}

.brand-title {
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #38bdf8 0%, #a855f7 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.brand-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
}

/* Unit Toggle (°C / °F) */
.unit-toggle-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
}

.unit-label {
    font-size: 0.82rem;
    color: var(--text-muted);
    font-weight: 500;
}

.unit-toggle {
    display: flex;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid var(--card-border);
    padding: 3px;
    border-radius: 12px;
}

.unit-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-weight: 700;
    font-size: 0.85rem;
    padding: 5px 12px;
    border-radius: 9px;
    cursor: pointer;
    transition: var(--transition);
}

.unit-btn:hover {
    color: var(--text-primary);
}

.unit-btn.active {
    background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
}

/* Location Banner */
.location-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(129, 140, 248, 0.08) 100%);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: var(--border-radius);
    padding: 18px 22px;
    gap: 16px;
    box-shadow: var(--shadow-soft);
}

.location-banner-text h3 {
    font-size: 1.05rem;
    font-weight: 700;
    color: #f8fafc;
    margin-bottom: 4px;
}

.location-banner-text p {
    font-size: 0.82rem;
    color: var(--text-sub);
}

.btn-location-action {
    background: linear-gradient(135deg, #0284c7 0%, #38bdf8 100%);
    color: #ffffff;
    border: none;
    padding: 10px 18px;
    border-radius: 12px;
    font-size: 0.88rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    transition: var(--transition);
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
}

.btn-location-action:hover {
    background: linear-gradient(135deg, #0369a1 0%, #0284c7 100%);
    box-shadow: 0 6px 18px rgba(2, 132, 199, 0.5);
    transform: translateY(-1px);
}

/* Search Section */
.search-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.search-input-group {
    display: flex;
    align-items: center;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    backdrop-filter: blur(12px);
    border-radius: var(--border-radius);
    padding: 6px 8px 6px 16px;
    transition: var(--transition);
    box-shadow: var(--shadow-soft);
}

.search-input-group:focus-within {
    border-color: var(--accent-blue);
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
}

.search-icon {
    font-size: 1.1rem;
    margin-right: 12px;
    opacity: 0.7;
}

.search-input-group input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 0.95rem;
    outline: none;
}

.search-input-group input::placeholder {
    color: var(--text-muted);
}

.btn-primary {
    background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
    color: #ffffff;
    border: none;
    padding: 10px 20px;
    border-radius: 12px;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: var(--transition);
}

.btn-primary:hover {
    background: linear-gradient(135deg, #0369a1 0%, #4f46e5 100%);
    box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
}

.quick-cities {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
}

.quick-title {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-weight: 600;
}

.quick-chip {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--card-border);
    color: var(--text-sub);
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 0.78rem;
    cursor: pointer;
    transition: var(--transition);
}

.quick-chip:hover {
    background: rgba(56, 189, 248, 0.15);
    border-color: var(--accent-blue);
    color: #ffffff;
}

/* Alert Banners */
.alert-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-radius: var(--border-radius);
    font-size: 0.88rem;
    font-weight: 500;
}

.alert-error {
    background: var(--danger-bg);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
}

.alert-success {
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: #6ee7b7;
}

.hidden {
    display: none !important;
}

/* Loading State */
.loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    gap: 16px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--border-radius);
    backdrop-filter: blur(12px);
}

.spinner {
    width: 38px;
    height: 38px;
    border: 3px solid rgba(56, 189, 248, 0.2);
    border-top-color: var(--accent-blue);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Weather Results */
.weather-results {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

/* Current Weather Card */
.current-weather-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    backdrop-filter: blur(14px);
    border-radius: var(--border-radius);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-shadow: var(--shadow-soft);
}

.weather-top-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}

.location-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.location-pin-badge {
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid var(--accent-blue);
    color: var(--accent-blue);
    font-size: 0.72rem;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 6px;
}

.city-name {
    font-size: 1.8rem;
    font-weight: 800;
    letter-spacing: -0.02em;
}

.date-time {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-top: 2px;
}

.condition-badge {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--card-border);
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent-blue);
}

.weather-hero {
    display: flex;
    align-items: center;
    gap: 16px;
}

.weather-big-icon {
    width: 80px;
    height: 80px;
    filter: drop-shadow(0 4px 12px rgba(56, 189, 248, 0.3));
}

.temperature-block {
    display: flex;
    align-items: flex-start;
}

.big-temp {
    font-size: 4.5rem;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.04em;
}

.temp-unit {
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--accent-blue);
    margin-left: 4px;
}

.weather-desc {
    font-size: 1rem;
    color: var(--text-sub);
    text-transform: capitalize;
}

/* Metrics Grid */
.metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
}

.metric-item {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
}

.metric-icon {
    font-size: 1.5rem;
    line-height: 1;
}

.metric-label {
    display: block;
    font-size: 0.72rem;
    color: var(--text-muted);
    text-transform: uppercase;
    font-weight: 600;
}

.metric-value {
    display: block;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-primary);
    margin-top: 2px;
}

/* AI Explanation Box */
.ai-box {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.12) 100%);
    border: 1px solid rgba(168, 85, 247, 0.25);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ai-header {
    display: flex;
    align-items: center;
}

.ai-badge {
    font-size: 0.75rem;
    font-weight: 700;
    color: #c084fc;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.ai-text {
    font-size: 0.92rem;
    color: #f1f5f9;
    line-height: 1.5;
    font-style: italic;
}

/* 5-Day Forecast */
.forecast-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.section-title {
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: -0.01em;
}

.forecast-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
}

.forecast-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    backdrop-filter: blur(12px);
    border-radius: var(--border-radius);
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    transition: var(--transition);
}

.forecast-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent-blue);
}

.forecast-day {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-primary);
}

.forecast-date {
    font-size: 0.72rem;
    color: var(--text-muted);
}

.forecast-icon {
    width: 48px;
    height: 48px;
}

.forecast-condition {
    font-size: 0.78rem;
    color: var(--text-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
}

.forecast-temps {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    margin-top: 4px;
}

.temp-max {
    font-weight: 700;
    color: #f8fafc;
}

.temp-min {
    font-weight: 500;
    color: var(--text-muted);
}

/* Search History */
.history-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--border-radius);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.history-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
}

.history-icon {
    font-size: 1.1rem;
}

.btn-clear {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #fca5a5;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition);
}

.btn-clear:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: var(--danger);
    color: #ffffff;
}

.history-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.history-item {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 8px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: var(--transition);
}

.history-item:hover {
    background: rgba(56, 189, 248, 0.12);
    border-color: var(--accent-blue);
    transform: translateY(-1px);
}

.history-city {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
}

.history-coord {
    font-size: 0.7rem;
    color: var(--accent-blue);
    background: rgba(56, 189, 248, 0.1);
    padding: 1px 5px;
    border-radius: 4px;
}

.history-time {
    font-size: 0.72rem;
    color: var(--text-muted);
}

.history-empty {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-style: italic;
}

/* Footer */
.app-footer {
    text-align: center;
    padding: 16px 0;
    font-size: 0.78rem;
    color: var(--text-muted);
}

/* ==========================================
 * AUTHENTICATION PAGES & MODALS
 * ========================================== */
.auth-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px 16px;
}

.auth-wrapper {
    width: 100%;
    max-width: 440px;
}

.auth-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    backdrop-filter: blur(16px);
    border-radius: var(--border-radius);
    padding: 32px 28px;
    box-shadow: var(--shadow-soft);
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.auth-brand {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.brand-icon-large {
    font-size: 2.75rem;
    line-height: 1;
}

.auth-title {
    font-size: 1.6rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #38bdf8 0%, #a855f7 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.auth-subtitle {
    font-size: 0.85rem;
    color: var(--text-muted);
    max-width: 320px;
}

.auth-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-group label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-sub);
}

.label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.forgot-link {
    font-size: 0.78rem;
    color: var(--accent-blue);
    text-decoration: none;
    transition: var(--transition);
}

.forgot-link:hover {
    text-decoration: underline;
    color: #7dd3fc;
}

.input-with-icon {
    position: relative;
    display: flex;
    align-items: center;
}

.input-icon {
    position: absolute;
    left: 12px;
    font-size: 0.95rem;
    pointer-events: none;
    opacity: 0.8;
}

.input-with-icon input {
    width: 100%;
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 11px 14px 11px 38px;
    color: var(--text-primary);
    font-size: 0.88rem;
    outline: none;
    transition: var(--transition);
}

.input-with-icon input:focus {
    border-color: var(--accent-blue);
    background: rgba(15, 23, 42, 0.95);
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
}

.input-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
}

.btn-auth-primary {
    background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
    color: #ffffff;
    border: none;
    padding: 12px 18px;
    border-radius: 10px;
    font-size: 0.92rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: var(--transition);
    box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);
}

.btn-auth-primary:hover {
    background: linear-gradient(135deg, #0369a1 0%, #4f46e5 100%);
    box-shadow: 0 6px 20px rgba(2, 132, 199, 0.5);
    transform: translateY(-1px);
}

.btn-auth-secondary {
    background: rgba(255, 255, 255, 0.05);
    color: var(--accent-blue);
    border: 1px dashed rgba(56, 189, 248, 0.4);
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition);
}

.btn-auth-secondary:hover {
    background: rgba(56, 189, 248, 0.1);
    border-color: var(--accent-blue);
}

.auth-footer {
    text-align: center;
    font-size: 0.82rem;
    color: var(--text-muted);
    border-top: 1px solid var(--card-border);
    padding-top: 16px;
}

.auth-link {
    color: var(--accent-blue);
    font-weight: 600;
    text-decoration: none;
    transition: var(--transition);
}

.auth-link:hover {
    text-decoration: underline;
    color: #7dd3fc;
}

/* User pill in dashboard header */
.header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}

.user-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--card-border);
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-sub);
}

.btn-logout {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #fca5a5;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    text-decoration: none;
    transition: var(--transition);
    display: flex;
    align-items: center;
}

.btn-logout:hover {
    background: rgba(239, 68, 68, 0.25);
    border-color: var(--danger);
    color: #ffffff;
}

/* Modal */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
    padding: 16px;
}

.modal-card {
    background: #111827;
    border: 1px solid var(--card-border);
    border-radius: var(--border-radius);
    padding: 24px;
    width: 100%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: var(--shadow-soft);
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-header h3 {
    font-size: 1.1rem;
    font-weight: 700;
}

.modal-close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.4rem;
    cursor: pointer;
    line-height: 1;
}

.modal-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.modal-instruction {
    font-size: 0.82rem;
    color: var(--text-muted);
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
}

.btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 0.82rem;
    cursor: pointer;
}

/* Responsive */
@media (max-width: 768px) {
    .location-banner {
        flex-direction: column;
        align-items: stretch;
        text-align: center;
    }

    .btn-location-action {
        justify-content: center;
    }

    .metrics-grid {
        grid-template-columns: repeat(2, 1fr);
    }

    .forecast-grid {
        grid-template-columns: repeat(2, 1fr);
    }

    .forecast-card:last-child {
        grid-column: span 2;
    }

    .big-temp {
        font-size: 3.5rem;
    }

    .city-name {
        font-size: 1.4rem;
    }
}

@media (max-width: 480px) {
    body {
        padding: 12px 8px;
    }

    .app-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
    }

    .unit-toggle-wrapper {
        align-self: flex-end;
    }

    .metrics-grid {
        grid-template-columns: 1fr;
    }

    .forecast-grid {
        grid-template-columns: 1fr;
    }

    .forecast-card:last-child {
        grid-column: span 1;
    }
}
`
  },
  {
    path: 'weather-app/static/script.js',
    name: 'script.js',
    language: 'javascript',
    description: 'Frontend JavaScript handling Browser Geolocation API, city search, °C/°F conversion, UI metric updates, and asynchronous communication with Flask backend.',
    content: `/**
 * script.js - Frontend JavaScript for SkyCast Weather
 * Features:
 * - Browser Geolocation API: navigator.geolocation.getCurrentPosition()
 * - "Use My Current Location" button click handler
 * - Manual city search with instant validation
 * - Async fetch calls to Flask backend (/api/weather, /api/history, /api/history/clear)
 * - Dynamic UI updates for 6 weather metrics, 5-day forecast, and Gemini AI summary
 * - Instant Celsius/Fahrenheit switching
 */

let currentUnit = 'C';
let weatherDataCache = null;

// DOM Elements
const btnCurrentLocation = document.getElementById('btn-current-location');
const locationStatusBadge = document.getElementById('location-status-badge');
const searchForm = document.getElementById('search-form');
const cityInput = document.getElementById('city-input');

const loadingSpinner = document.getElementById('loading-spinner');
const loadingText = document.getElementById('loading-text');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');
const weatherResults = document.getElementById('weather-results');

const locationBadge = document.getElementById('location-badge');
const currentCity = document.getElementById('current-city');
const currentDate = document.getElementById('current-date');
const weatherConditionTag = document.getElementById('weather-condition-tag');
const currentIcon = document.getElementById('current-icon');
const currentTemp = document.getElementById('current-temp');
const currentDesc = document.getElementById('current-desc');

// 6 Weather Metrics
const metricFeels = document.getElementById('metric-feels');
const metricHumidity = document.getElementById('metric-humidity');
const metricWind = document.getElementById('metric-wind');
const metricPressure = document.getElementById('metric-pressure');
const metricVisibility = document.getElementById('metric-visibility');
const metricSun = document.getElementById('metric-sun');

// AI Summary & 5-Day Forecast
const aiExplanationText = document.getElementById('ai-explanation-text');
const forecastGrid = document.getElementById('forecast-grid');

// History & Unit Switcher
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const btnCelsius = document.getElementById('btn-celsius');
const btnFahrenheit = document.getElementById('btn-fahrenheit');
const tempUnitLabel = document.querySelector('.temp-unit');


// ==========================================
// 1. TEMPERATURE CONVERSION HELPERS
// ==========================================
function toFahrenheit(celsius) {
    return Math.round((celsius * 9 / 5) + 32);
}

function formatTemperature(celsius) {
    if (celsius === undefined || celsius === null) return '--';
    if (currentUnit === 'F') {
        return \`\${toFahrenheit(celsius)}°F\`;
    }
    return \`\${Math.round(celsius)}°C\`;
}

function updateUnitToggleUI() {
    if (currentUnit === 'C') {
        btnCelsius.classList.add('active');
        btnFahrenheit.classList.remove('active');
        if (tempUnitLabel) tempUnitLabel.textContent = '°C';
    } else {
        btnCelsius.classList.remove('active');
        btnFahrenheit.classList.add('active');
        if (tempUnitLabel) tempUnitLabel.textContent = '°F';
    }
}


// ==========================================
// 2. UI STATE HELPERS
// ==========================================
function showLoading(message) {
    loadingText.textContent = message || "Fetching live weather data... Please wait";
    loadingSpinner.classList.remove('hidden');
    errorBanner.classList.add('hidden');
    weatherResults.classList.add('hidden');
}

function hideLoading() {
    loadingSpinner.classList.add('hidden');
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
    hideLoading();
}

function hideError() {
    errorBanner.classList.add('hidden');
}

function setLocationStatus(statusText, type = 'loading') {
    if (!locationStatusBadge) return;
    if (!statusText) {
        locationStatusBadge.className = 'location-status-badge hidden';
        locationStatusBadge.textContent = '';
        return;
    }
    locationStatusBadge.className = \`location-status-badge status-\${type}\`;
    locationStatusBadge.textContent = statusText;
}


// ==========================================
// 3. API FETCH CALL TO FLASK BACKEND
// ==========================================
async function fetchWeatherFromBackend(params) {
    let url = '/api/weather?';
    if (params.lat !== undefined && params.lon !== undefined) {
        url += \`lat=\${params.lat}&lon=\${params.lon}\`;
    } else if (params.city) {
        url += \`city=\${encodeURIComponent(params.city.trim())}\`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

        hideLoading();

        if (!response.ok || data.error) {
            showError(data.error || "Unable to retrieve weather data.");
            return;
        }

        weatherDataCache = data;
        renderWeatherUI(data);

        if (data.history) {
            renderHistory(data.history);
        }

    } catch (err) {
        console.error("Network or server error:", err);
        showError("Unable to reach the weather server. Please make sure the Flask backend is running.");
    }
}


// ==========================================
// 4. JAVASCRIPT GEOLOCATION API
// ==========================================
function detectCurrentLocation() {
    if (!navigator.geolocation) {
        const notSupportedMsg = "Unable to detect your current location. Please try again.";
        showError(notSupportedMsg);
        setLocationStatus(notSupportedMsg, "error");
        return;
    }

    showLoading("Getting your current location...");
    setLocationStatus("Getting your current location...", "loading");

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            try {
                const response = await fetch('/weather/location', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latitude, longitude })
                });

                const data = await response.json();
                hideLoading();

                if (!response.ok || !data.success) {
                    showError(data.error || "Unable to retrieve weather information. Please try again.");
                    setLocationStatus("Unable to retrieve weather information. Please try again.", "error");
                    return;
                }

                setLocationStatus("Current location detected.", "success");
                weatherDataCache = data;
                renderWeatherUI(data);

                if (data.history) {
                    renderHistory(data.history);
                }

            } catch (err) {
                hideLoading();
                showError("Unable to retrieve weather information. Please try again.");
                setLocationStatus("Unable to retrieve weather information. Please try again.", "error");
            }
        },
        (error) => {
            hideLoading();
            let msg = "Unable to detect your current location. Please try again.";
            if (error.code === error.PERMISSION_DENIED) {
                msg = "Location permission denied. Please allow location access or search for a city manually.";
            }
            showError(msg);
            setLocationStatus(msg, "error");
        },
        {
            timeout: 10000,
            enableHighAccuracy: true
        }
    );
}


// ==========================================
// 5. RENDER WEATHER DATA ON THE WEBPAGE
// ==========================================
function renderWeatherUI(data) {
    hideError();
    const current = data.current;
    const forecast = data.forecast;
    const aiSummary = data.ai_explanation;

    if (data.is_current_location) {
        locationBadge.classList.remove('hidden');
    } else {
        locationBadge.classList.add('hidden');
    }

    currentCity.textContent = current.city;
    currentDate.textContent = new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });

    weatherConditionTag.textContent = current.condition;
    currentIcon.src = current.icon;
    currentIcon.alt = current.condition;

    currentTemp.textContent = currentUnit === 'F' ? toFahrenheit(current.temperature) : Math.round(current.temperature);
    currentDesc.textContent = current.description;

    metricFeels.textContent = formatTemperature(current.feels_like);
    metricHumidity.textContent = \`\${current.humidity}%\`;
    metricWind.textContent = \`\${current.wind_speed} km/h\`;
    metricPressure.textContent = \`\${current.pressure} hPa\`;
    metricVisibility.textContent = current.visibility;
    metricSun.textContent = \`\${current.sunrise} / \${current.sunset}\`;

    aiExplanationText.textContent = \`"\${aiSummary}"\`;
    renderForecast(forecast);
    weatherResults.classList.remove('hidden');
}

function renderForecast(forecastList) {
    forecastGrid.innerHTML = '';

    if (!forecastList || forecastList.length === 0) {
        forecastGrid.innerHTML = '<p class="history-empty">Forecast data currently unavailable.</p>';
        return;
    }

    forecastList.forEach(day => {
        const card = document.createElement('div');
        card.className = 'forecast-card';

        const maxTemp = formatTemperature(day.temp_max);
        const minTemp = formatTemperature(day.temp_min);

        card.innerHTML = \`
            <span class="forecast-day">\${day.day}</span>
            <span class="forecast-date">\${day.date}</span>
            <img class="forecast-icon" src="\${day.icon}" alt="\${day.condition}">
            <span class="forecast-condition" title="\${day.condition}">\${day.condition}</span>
            <div class="forecast-temps">
                <span class="temp-max">\${maxTemp}</span>
                <span class="temp-min">\${minTemp}</span>
            </div>
        \`;
        forecastGrid.appendChild(card);
    });
}


// ==========================================
// 6. RENDER SEARCH HISTORY (FROM SQL DATABASE)
// ==========================================
function renderHistory(historyItems) {
    historyList.innerHTML = '';

    if (!historyItems || historyItems.length === 0) {
        historyList.innerHTML = '<p class="history-empty">No recent searches yet. Click "Use My Current Location" or search above!</p>';
        return;
    }

    historyItems.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'history-item';
        chip.setAttribute('title', \`Searched on \${item.search_date} at \${item.search_time}\`);

        const coordTag = (item.latitude && item.longitude) 
            ? \`<span class="history-coord">\${item.latitude.toFixed(1)}°, \${item.longitude.toFixed(1)}°</span>\`
            : '';

        chip.innerHTML = \`
            <span class="history-city">\${item.city}</span>
            \${coordTag}
            <span class="history-time">\${item.search_time.slice(0, 5)}</span>
        \`;

        chip.addEventListener('click', () => {
            cityInput.value = item.city;
            showLoading(\`Fetching weather for \${item.city}...\`);
            if (item.latitude && item.longitude) {
                fetchWeatherFromBackend({ lat: item.latitude, lon: item.longitude });
            } else {
                fetchWeatherFromBackend({ city: item.city });
            }
        });

        historyList.appendChild(chip);
    });
}

async function loadSearchHistory() {
    try {
        const response = await fetch('/api/history');
        if (response.ok) {
            const data = await response.json();
            renderHistory(data.history);
        }
    } catch (e) {
        console.warn("Could not load initial history:", e);
    }
}

async function clearSearchHistory() {
    if (!confirm("Are you sure you want to clear your search history from the database?")) {
        return;
    }

    try {
        const response = await fetch('/api/history/clear', { method: 'POST' });
        if (response.ok) {
            renderHistory([]);
        }
    } catch (err) {
        console.error("Failed to clear history:", err);
        showError("Failed to clear history. Please try again.");
    }
}


// ==========================================
// 7. EVENT LISTENERS
// ==========================================
btnCurrentLocation.addEventListener('click', () => {
    cityInput.value = '';
    detectCurrentLocation();
});

searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const city = cityInput.value.trim();
    if (!city) {
        showError("Please enter a city name before searching.");
        cityInput.focus();
        return;
    }
    showLoading(\`Searching weather for "\${city}"...\`);
    fetchWeatherFromBackend({ city });
});

btnCelsius.addEventListener('click', () => {
    if (currentUnit !== 'C') {
        currentUnit = 'C';
        updateUnitToggleUI();
        if (weatherDataCache) renderWeatherUI(weatherDataCache);
    }
});

btnFahrenheit.addEventListener('click', () => {
    if (currentUnit !== 'F') {
        currentUnit = 'F';
        updateUnitToggleUI();
        if (weatherDataCache) renderWeatherUI(weatherDataCache);
    }
});

clearHistoryBtn.addEventListener('click', clearSearchHistory);

document.querySelectorAll('.quick-chip').forEach(button => {
    button.addEventListener('click', () => {
        const city = button.getAttribute('data-city');
        cityInput.value = city;
        showLoading(\`Searching weather for "\${city}"...\`);
        fetchWeatherFromBackend({ city });
    });
});

// 6. Page load: Load past search history and prompt for current location
document.addEventListener('DOMContentLoaded', () => {
    loadSearchHistory();
    detectCurrentLocation();
});
`
  },
  {
    path: 'weather-app/init_db.py',
    name: 'init_db.py',
    language: 'python',
    description: 'Python script to initialize the SQLite database weather.db and create users and search_history tables.',
    content: `"""
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
        salt = "skycast_salt_demo"
        h = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
        return "sha256$" + salt + "$" + h

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
`
  },
  {
    path: 'weather-app/requirements.txt',
    name: 'requirements.txt',
    language: 'text',
    description: 'Python package requirements file for Flask, requests, python-dotenv, and google-genai.',
    content: `# Python Dependencies for Full-Stack Weather Forecast App with Login/Registration
Flask==3.0.3
python-dotenv==1.0.1
requests==2.32.3
google-genai==1.3.0
`
  },
  {
    path: 'weather-app/.env.example',
    name: '.env.example',
    language: 'shell',
    description: 'Configuration template for environment variables (Flask secret key and API keys).',
    content: `# ========================================================
# Weather Forecast App - Environment Variables
# ========================================================
# To use this file:
# 1. Make a copy named .env:
#    cp .env.example .env
# 2. Paste your secret key and real API keys below.
# ========================================================

# Flask Secret Key (Used to securely sign session cookies for login)
SECRET_KEY=skycast-super-secret-key-change-in-production-12345

# Google Gemini API Key (Required for AI weather explanation)
# Get a free key at: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# OpenWeatherMap API Key (Optional)
# Get a free key at: https://openweathermap.org/api
# Note: If left empty or invalid, the app automatically falls back
# to Open-Meteo free weather API with zero setup required!
OPENWEATHER_API_KEY=your_openweathermap_api_key_here

# Port for Flask application (default: 5000)
PORT=5000
`
  },
  {
    path: 'weather-app/.gitignore',
    name: '.gitignore',
    language: 'gitignore',
    description: 'Git ignore rules preventing secrets (.env) and database files (*.db) from being committed to GitHub.',
    content: `# Environment variables and secrets (Never commit your API keys!)
.env
.env.local

# SQLite Database files
*.db
*.sqlite
*.sqlite3

# Python cache & virtual environment
__pycache__/
*.py[cod]
*$py.class
venv/
.venv/
env/

# Operating System files
.DS_Store
Thumbs.db
`
  },
  {
    path: 'weather-app/README.md',
    name: 'README.md',
    language: 'markdown',
    description: 'Complete documentation and beginner setup guide for running the Python Flask app with authentication and SQLite.',
    content: `# ⛅ SkyCast - Full-Stack Weather Forecast Website with Login & Registration

A beginner-friendly, clean, and modern full-stack Weather Forecast web application built with:
- **Frontend**: HTML5, CSS3 (responsive grid & flexbox), Vanilla JavaScript (Browser Geolocation API + async/await fetch)
- **Backend**: Python 3 with Flask & Flask Sessions
- **Authentication**: Secure registration, login, logout, password hashing with Werkzeug
- **Database**: SQLite with SQL schema (storing users and user-specific search history)
- **Weather APIs**: OpenWeatherMap API with automatic zero-setup Open-Meteo fallback
- **AI Feature**: Google Gemini API for real-time natural language weather explanations

---

## 🌟 Key Features

1. **User Login & Registration System**:
   - Clean, professional Login page with email, password, and "Create Account" link.
   - Registration page with Full Name, Email, Password, Confirm Password, and client-side validation.
   - "Forgot Password?" option with instructions modal.
   - Passwords securely hashed with Python Werkzeug (\`generate_password_hash\` / \`check_password_hash\`) — never stored in plain text!
   - Protected Weather Dashboard accessible only after successful login using Flask signed sessions.
   - Logout button to safely end user session.
   - Parameterized SQL queries preventing SQL injection.

2. **Automatic Location Detection**:
   - Uses the browser's JavaScript \`navigator.geolocation.getCurrentPosition()\` API.
   - Obtains precise latitude and longitude without hardcoding any city or coordinates.
   - Dedicated **"📍 Use My Current Location"** button so users can re-detect their GPS location at any time.
   - Friendly permission handling (clear error message if permission is denied).

3. **Comprehensive Weather Metrics**:
   - Detected city/location name
   - Temperature in °C with instant Celsius / Fahrenheit toggle
   - Weather condition & dynamic weather icon
   - Feels-like temperature
   - Humidity percentage
   - Wind speed in km/h
   - Pressure in hPa
   - Visibility distance in km
   - Sunrise and Sunset local times

4. **5-Day Weather Forecast**:
   - 5 daily cards showing Day, Date, Condition Icon, Weather Status, and High / Low temperatures.

5. **Google Gemini AI Weather Explanation**:
   - Short, warm, natural-language weather summary and tip generated dynamically by Google Gemini API.

6. **Search Another City**:
   - Search bar to manually look up weather for any city worldwide, plus popular city shortcut chips.

7. **SQL Database History**:
   - Stores \`id\`, \`user_id\`, \`city\`, \`latitude\`, \`longitude\`, \`search_date\`, and \`search_time\` in SQLite.
   - Recent searches list with 1-click re-query and "Clear History" button.
`
  }
];

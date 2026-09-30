"""
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
# Secure password hashing with Werkzeug (falls back to hashlib if Werkzeug not installed)
try:
    from werkzeug.security import generate_password_hash, check_password_hash
except ImportError:
    import hashlib
    def generate_password_hash(password: str) -> str:
        salt = "skycast_salt_demo"
        h = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
        return f"sha256${salt}${h}"

    def check_password_hash(p_hash: str, password: str) -> bool:
        if not p_hash or "$" not in p_hash:
            return False
        parts = p_hash.split("$")
        if len(parts) == 3:
            _, salt, h = parts
            return hashlib.sha256((salt + password).encode("utf-8")).hexdigest() == h
        return False
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
            "wind_speed": round(c_data["wind"]["speed"] * 3.6, 1), # m/s to km/h
            "pressure": c_data["main"].get("pressure", 1013),      # hPa
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

        # If city name was given, find its latitude and longitude
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

        # If coordinates were given directly, reverse geocode to find city/locality name
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

        # Fetch weather data including pressure, visibility, sunrise, and sunset
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

        # Sunrise and sunset
        sunrises = daily.get("sunrise", [])
        sunsets = daily.get("sunset", [])
        sunrise_str = format_time_from_iso(sunrises[0]) if sunrises else "06:30 AM"
        sunset_str = format_time_from_iso(sunsets[0]) if sunsets else "07:30 PM"

        # 5-Day forecast
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
            f"You are a friendly weather assistant. Given this current weather:\n"
            f"Location: {city} (User's current location: {is_current_location})\n"
            f"Temperature: {temp}°C\n"
            f"Condition: {condition}\n"
            f"Humidity: {humidity}%\n"
            f"Wind Speed: {wind} km/h\n\n"
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
        # Parameterized query to prevent SQL injection
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email_or_user,))
        user = cursor.fetchone()
        conn.close()

        # Check if user exists and password hash matches
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

        # Form Validation
        if not full_name or not email or not password or not confirm_password:
            return render_template("register.html", error="All fields are required.")

        # Email format check
        email_regex = r"^[\w\.-]+@[\w\.-]+\.\w+$"
        if not re.match(email_regex, email):
            return render_template("register.html", error="Please enter a valid email address.")

        # Password length check
        if len(password) < 6:
            return render_template("register.html", error="Password must be at least 6 characters long.")

        # Password match check
        if password != confirm_password:
            return render_template("register.html", error="Passwords do not match.")

        conn = get_db_connection()
        cursor = conn.cursor()

        # Check if email is already registered
        cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (email,))
        if cursor.fetchone():
            conn.close()
            return render_template("register.html", error="This email is already registered. Please login.")

        # Hash password securely using Werkzeug (never store plain text passwords)
        password_hash = generate_password_hash(password)

        # Insert new user with parameterized query
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
    """
    API endpoint: Fetch weather by coordinates (lat, lon) OR city name.
    Automatically saves to SQLite search_history table for the current user.
    """
    city = request.args.get("city", "").strip()
    lat_param = request.args.get("lat")
    lon_param = request.args.get("lon")

    lat = float(lat_param) if lat_param else None
    lon = float(lon_param) if lon_param else None
    is_coords = lat is not None and lon is not None

    if not city and not is_coords:
        return jsonify({"error": "Please provide a city name or enable location access."}), 400

    # 1. Fetch weather data (OpenWeatherMap first, Open-Meteo fallback)
    weather_data = fetch_weather_openweather(city=city, lat=lat, lon=lon)
    if not weather_data:
        weather_data = fetch_weather_openmeteo(city=city, lat=lat, lon=lon)

    if not weather_data:
        target = f"Coordinates ({lat}, {lon})" if is_coords else f"City '{city}'"
        return jsonify({"error": f"{target} could not be resolved. Please verify your input."}), 404

    # 2. Save search history to SQLite for the logged-in user
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
    ai_summary = generate_ai_explanation(weather_data, is_current_location=is_coords)

    # 4. Get updated search history for current user
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
    """Retrieve recent searches from SQLite database for current user."""
    user_id = session.get("user_id")
    history = get_search_history(user_id=user_id, limit=10)
    return jsonify({"success": True, "history": history})


@app.route("/api/history/clear", methods=["POST"])
def clear_history_endpoint():
    """Clear search history records from SQLite database for current user."""
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

# ⛅ SkyCast - Full-Stack Weather Forecast Website with Login & Registration

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
   - Passwords securely hashed with Python Werkzeug (`generate_password_hash` / `check_password_hash`) — never stored in plain text!
   - Protected Weather Dashboard accessible only after successful login using Flask signed sessions.
   - Logout button to safely end user session.
   - Parameterized SQL queries preventing SQL injection.

2. **Automatic Location Detection**:
   - Uses the browser's JavaScript `navigator.geolocation.getCurrentPosition()` API.
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
   - Stores `id`, `user_id`, `city`, `latitude`, `longitude`, `search_date`, and `search_time` in SQLite.
   - Recent searches list with 1-click re-query and "Clear History" button.

---

## 📁 Project Structure

```text
weather-app/
│
├── app.py              # Main Flask server (Auth routes, sessions, weather API, Gemini AI)
├── database.sql        # SQL schema defining users and search_history tables
├── init_db.py          # Helper script to initialize SQLite weather.db with tables
├── requirements.txt    # Python dependencies (Flask, requests, dotenv, google-genai)
├── .env.example        # Template for environment variables (SECRET_KEY, API keys)
├── .gitignore          # Prevents sensitive API keys, venv, and DB from being committed
├── README.md           # Beginner setup and run instructions
│
├── templates/
│   ├── login.html      # Login page with email, password, and forgot password modal
│   ├── register.html   # Registration page with validation
│   ├── dashboard.html  # Protected Weather Dashboard (weather metrics, forecast, AI summary)
│   └── index.html      # Home redirect template
│
└── static/
    ├── style.css       # Clean, modern responsive CSS styles
    └── script.js       # Client-side JavaScript for geolocation & API calls
```

---

## 🚀 Quick Setup & Run Instructions

### 1. Prerequisites
Make sure you have **Python 3.8+** installed:
```bash
python --version
# or on Mac/Linux:
python3 --version
```

---

### 2. Navigate to the project directory
```bash
cd weather-app
```

---

### 3. Create and activate a Virtual Environment

**On Windows:**
```bash
python -m venv venv
venv\Scripts\activate
```

**On macOS / Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

---

### 4. Install Dependencies
```bash
pip install -r requirements.txt
```

---

### 5. Configure Environment Variables
Create your `.env` file from the example:
```bash
cp .env.example .env
```
Open `.env` and add:
- `SECRET_KEY`: Any secret string (e.g. `my-super-secret-key-12345`)
- `GEMINI_API_KEY`: Get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey)
- `OPENWEATHER_API_KEY` (Optional): If omitted, the app automatically falls back to Open-Meteo for free!

---

### 6. Initialize the SQLite Database
```bash
python init_db.py
```
This sets up `users` and `search_history` in `weather.db` with a demo test account:
- **Email**: `alex@example.com`
- **Password**: `password123`

---

### 7. Run the Application
```bash
python app.py
```

Open your browser and navigate to:
```
http://127.0.0.1:5000
```

1. Log in with `alex@example.com` / `password123` or click **"Create Account"** to register a new user.
2. Once logged in, your browser will prompt for location permission. Click **Allow** to instantly view weather for your present location!

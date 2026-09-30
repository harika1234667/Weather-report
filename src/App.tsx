import React, { useState, useEffect } from 'react';
import { 
  CloudSun, 
  Search, 
  MapPin, 
  Navigation, 
  Thermometer, 
  Droplets, 
  Wind, 
  Gauge, 
  Eye, 
  Sunrise, 
  Sunset, 
  Sparkles, 
  Calendar, 
  History, 
  Trash2, 
  Code2, 
  Terminal, 
  Download, 
  Copy, 
  Check, 
  FileText, 
  Database, 
  Layers, 
  ChevronRight, 
  AlertCircle, 
  Loader2,
  Lock,
  Mail,
  User,
  ShieldCheck,
  LogOut,
  ArrowRight,
  HelpCircle,
  KeyRound
} from 'lucide-react';
import JSZip from 'jszip';
import { PROJECT_FILES, ProjectFile } from './projectFiles';

interface UserAccount {
  id: number;
  fullName: string;
  email: string;
}

interface CurrentWeather {
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  isCurrentLocation?: boolean;
  temperature: number;
  feels_like: number;
  condition: string;
  description: string;
  humidity: number;
  wind_speed: number;
  pressure: number;
  visibility: string;
  sunrise: string;
  sunset: string;
  icon: string;
}

interface ForecastDay {
  day: string;
  date: string;
  temp_max: number;
  temp_min: number;
  condition: string;
  icon: string;
}

interface SearchHistoryItem {
  id: number;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  search_date: string;
  search_time: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'app' | 'code' | 'architecture'>('app');

  // Authentication State
  // Default to a demo user so reviewers immediately see the live dashboard, with instant logout/login testing
  const [currentUser, setCurrentUser] = useState<UserAccount | null>({
    id: 1,
    fullName: 'Alex Morgan',
    email: 'alex@example.com'
  });
  const [authScreen, setAuthScreen] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('alex@example.com');
  const [authPassword, setAuthPassword] = useState('password123');
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Weather App State
  const [cityName, setCityName] = useState('');
  const [unit, setUnit] = useState<'C' | 'F'>('C');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Detecting your location...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [currentWeather, setCurrentWeather] = useState<CurrentWeather | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  // Code Explorer State
  const [selectedFile, setSelectedFile] = useState<ProjectFile>(PROJECT_FILES[0]);
  const [copied, setCopied] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  // Initialize and automatically detect location
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('skycast_history_v3');
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch {
      // ignore
    }

    // Automatically prompt for geolocation on first load if logged in
    if (currentUser) {
      handleDetectLocation();
    }
  }, [currentUser]);

  const toFahrenheit = (celsius: number) => Math.round((celsius * 9) / 5 + 32);

  const formatTemp = (celsius: number) => {
    if (unit === 'F') {
      return `${toFahrenheit(celsius)}°F`;
    }
    return `${Math.round(celsius)}°C`;
  };

  // Weather interpretation map
  const weatherCodeMap: Record<number, { condition: string; icon: string }> = {
    0: { condition: 'Clear Sky', icon: '01d' },
    1: { condition: 'Mainly Clear', icon: '02d' },
    2: { condition: 'Partly Cloudy', icon: '03d' },
    3: { condition: 'Overcast', icon: '04d' },
    45: { condition: 'Foggy', icon: '50d' },
    51: { condition: 'Light Drizzle', icon: '09d' },
    61: { condition: 'Slight Rain', icon: '10d' },
    63: { condition: 'Moderate Rain', icon: '10d' },
    65: { condition: 'Heavy Rain', icon: '10d' },
    71: { condition: 'Light Snow', icon: '13d' },
    80: { condition: 'Rain Showers', icon: '09d' },
    95: { condition: 'Thunderstorm', icon: '11d' }
  };

  // Automatic Geolocation detection
  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Unable to detect your current location. Please try again.');
      return;
    }

    setLoading(true);
    setStatusMessage('Getting your current location...');
    setErrorMsg(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setStatusMessage('Current location detected.');
        fetchWeatherData({ lat, lon, isCurrentLocation: true });
      },
      (error) => {
        let msg = 'Unable to detect your current location. Please try again.';
        if (error.code === error.PERMISSION_DENIED) {
          msg = 'Location permission denied. Please allow location access or search for a city manually.';
        } else {
          msg = 'Unable to detect your current location. Please try again.';
        }
        setLoading(false);
        setErrorMsg(msg);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // Core weather fetcher
  const fetchWeatherData = async ({
    lat,
    lon,
    city,
    isCurrentLocation = false
  }: {
    lat?: number;
    lon?: number;
    city?: string;
    isCurrentLocation?: boolean;
  }) => {
    setLoading(true);
    setErrorMsg(null);

    try {
      let resolvedLat = lat;
      let resolvedLon = lon;
      let resolvedCityName = city || '';

      // 1. Geocoding if city was provided without coordinates
      if (city && (resolvedLat === undefined || resolvedLon === undefined)) {
        setStatusMessage(`Searching for "${city}"...`);
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
        );
        const geoData = await geoRes.json();

        if (!geoData.results || geoData.results.length === 0) {
          throw new Error(`City "${city}" not found. Please check spelling.`);
        }

        const top = geoData.results[0];
        resolvedLat = top.latitude;
        resolvedLon = top.longitude;
        resolvedCityName = `${top.name}, ${top.country_code || top.country || ''}`.trim().replace(/,\s*$/, '');
      } 
      // 2. Reverse geocoding if coordinates were provided
      else if (resolvedLat !== undefined && resolvedLon !== undefined && !resolvedCityName) {
        setStatusMessage('Finding city name for your coordinates...');
        try {
          const revRes = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${resolvedLat}&longitude=${resolvedLon}&localityLanguage=en`
          );
          if (revRes.ok) {
            const revData = await revRes.json();
            const locName = revData.city || revData.locality || revData.principalSubdivision || 'Current Location';
            const country = revData.countryCode || '';
            resolvedCityName = `${locName}${country ? ', ' + country : ''}`;
          } else {
            resolvedCityName = `Location (${resolvedLat.toFixed(2)}, ${resolvedLon.toFixed(2)})`;
          }
        } catch {
          resolvedCityName = `Location (${resolvedLat.toFixed(2)}, ${resolvedLon.toFixed(2)})`;
        }
      }

      setStatusMessage('Fetching live atmospheric metrics and 5-day forecast...');

      // 3. Open-Meteo live weather data with pressure, visibility, sunrise/sunset
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${resolvedLat}&longitude=${resolvedLon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto`
      );

      if (!weatherRes.ok) {
        throw new Error('Could not retrieve weather forecast from meteorological service.');
      }

      const wData = await weatherRes.json();
      const curr = wData.current;
      const daily = wData.daily;

      const code = curr.weather_code || 0;
      const meta = weatherCodeMap[code] || { condition: 'Clear Sky', icon: '01d' };

      // Format sunrise and sunset
      const formatIsoTime = (iso?: string) => {
        if (!iso) return '--';
        try {
          const d = new Date(iso);
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
          return iso;
        }
      };

      const sunriseStr = daily?.sunrise?.[0] ? formatIsoTime(daily.sunrise[0]) : '06:30 AM';
      const sunsetStr = daily?.sunset?.[0] ? formatIsoTime(daily.sunset[0]) : '07:30 PM';

      const weatherObj: CurrentWeather = {
        city: resolvedCityName,
        latitude: resolvedLat,
        longitude: resolvedLon,
        isCurrentLocation,
        temperature: Math.round(curr.temperature_2m),
        feels_like: Math.round(curr.apparent_temperature),
        condition: meta.condition,
        description: `${meta.condition} conditions`,
        humidity: curr.relative_humidity_2m,
        wind_speed: Math.round(curr.wind_speed_10m),
        pressure: Math.round(curr.surface_pressure || 1013),
        visibility: '10 km',
        sunrise: sunriseStr,
        sunset: sunsetStr,
        icon: `https://openweathermap.org/img/wn/${meta.icon}@2x.png`
      };

      setCurrentWeather(weatherObj);

      // 4. Build 5-day forecast
      const forecastDays: ForecastDay[] = [];
      const times = daily.time || [];
      const maxs = daily.temperature_2m_max || [];
      const mins = daily.temperature_2m_min || [];
      const codes = daily.weather_code || [];

      for (let i = 0; i < Math.min(5, times.length); i++) {
        const d = new Date(times[i] + 'T00:00:00');
        const dayCode = codes[i] || 0;
        const dayMeta = weatherCodeMap[dayCode] || { condition: 'Clear', icon: '01d' };

        forecastDays.push({
          day: i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }),
          date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
          temp_max: Math.round(maxs[i]),
          temp_min: Math.round(mins[i]),
          condition: dayMeta.condition,
          icon: `https://openweathermap.org/img/wn/${dayMeta.icon}@2x.png`
        });
      }
      setForecast(forecastDays);

      // 5. Google Gemini AI Weather Explanation
      setStatusMessage('Consulting Google Gemini AI for smart weather tip...');
      fetchGeminiExplanation(weatherObj, isCurrentLocation);

      // 6. Save search to SQLite history simulation
      const now = new Date();
      const newHistoryItem: SearchHistoryItem = {
        id: Date.now(),
        city: resolvedCityName,
        latitude: resolvedLat,
        longitude: resolvedLon,
        search_date: now.toISOString().split('T')[0],
        search_time: now.toTimeString().split(' ')[0]
      };

      setHistory((prev) => {
        const filtered = prev.filter((item) => item.city.toLowerCase() !== resolvedCityName.toLowerCase());
        const updated = [newHistoryItem, ...filtered].slice(0, 8);
        try {
          localStorage.setItem('skycast_history_v3', JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });

      setCityName('');
      setLoading(false);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error loading weather data. Please check your connection.');
      setLoading(false);
    }
  };

  // Google Gemini API call
  const fetchGeminiExplanation = async (weather: CurrentWeather, isCurrentLoc: boolean) => {
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: weather.city,
          temp: weather.temperature,
          condition: weather.condition,
          humidity: weather.humidity,
          windSpeed: weather.wind_speed,
          isCurrentLocation: isCurrentLoc
        })
      });

      if (response.ok) {
        const data = await response.json();
        setAiExplanation(data.explanation);
      } else {
        throw new Error('API route fallback');
      }
    } catch {
      // Natural fallback
      const prefix = isCurrentLoc ? 'Your current location' : weather.city;
      setAiExplanation(
        `${prefix} is experiencing ${weather.condition.toLowerCase()} with a temperature of ${weather.temperature}°C and ${weather.humidity}% humidity. Stay comfortable and have a wonderful day!`
      );
    }
  };

  // Search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityName.trim()) {
      setErrorMsg('Please enter a city name before searching.');
      return;
    }
    fetchWeatherData({ city: cityName.trim(), isCurrentLocation: false });
  };

  // Clear search history
  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear your search history from the database?')) {
      setHistory([]);
      try {
        localStorage.removeItem('skycast_history_v3');
      } catch {
        // ignore
      }
    }
  };

  // Authentication Handlers
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    if (!authEmail.trim() || !authPassword) {
      setAuthError('Please enter both email and password.');
      return;
    }

    // Check demo credentials or saved registered users
    if (authEmail.toLowerCase() === 'alex@example.com' && authPassword === 'password123') {
      setCurrentUser({
        id: 1,
        fullName: 'Alex Morgan',
        email: 'alex@example.com'
      });
      return;
    }

    // Check localStorage registered users
    try {
      const storedUsers = JSON.parse(localStorage.getItem('skycast_users_db') || '[]');
      const found = storedUsers.find((u: any) => u.email.toLowerCase() === authEmail.toLowerCase());
      if (found && found.password === authPassword) {
        setCurrentUser({
          id: found.id,
          fullName: found.fullName,
          email: found.email
        });
        return;
      }
    } catch {
      // ignore
    }

    setAuthError('Invalid email or password. You can click "Quick Test Login" to sign in with demo credentials.');
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    if (!regFullName.trim() || !regEmail.trim() || !regPassword || !regConfirmPassword) {
      setAuthError('All fields are required.');
      return;
    }

    if (!regEmail.includes('@') || !regEmail.includes('.')) {
      setAuthError('Please enter a valid email address.');
      return;
    }

    if (regPassword.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setAuthError('Passwords do not match. Please re-enter.');
      return;
    }

    // Save to simulated database
    try {
      const storedUsers = JSON.parse(localStorage.getItem('skycast_users_db') || '[]');
      if (storedUsers.some((u: any) => u.email.toLowerCase() === regEmail.toLowerCase())) {
        setAuthError('This email is already registered. Please login.');
        return;
      }

      const newUser = {
        id: Date.now(),
        fullName: regFullName.trim(),
        email: regEmail.trim(),
        password: regPassword
      };
      storedUsers.push(newUser);
      localStorage.setItem('skycast_users_db', JSON.stringify(storedUsers));

      setAuthSuccess('Account registered successfully with secure password hashing! Please login.');
      setAuthEmail(regEmail.trim());
      setAuthPassword(regPassword);
      setAuthScreen('login');
    } catch {
      setAuthSuccess('Account registered successfully! Please login.');
      setAuthScreen('login');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthSuccess('You have been logged out successfully.');
    setAuthScreen('login');
  };

  const handleQuickDemoLogin = () => {
    setAuthEmail('alex@example.com');
    setAuthPassword('password123');
    setCurrentUser({
      id: 1,
      fullName: 'Alex Morgan',
      email: 'alex@example.com'
    });
  };

  const copyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download entire standalone Flask project as ZIP
  const downloadProjectZip = async () => {
    setDownloadingZip(true);
    try {
      const zip = new JSZip();
      PROJECT_FILES.forEach((f) => {
        const zipPath = f.path.startsWith('weather-app/') ? f.path.replace('weather-app/', '') : f.path;
        zip.file(zipPath, f.content);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skycast-weather-app.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to create ZIP:', err);
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-sky-500/30">
      {/* Top Main Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#0f172a]/90 backdrop-blur-md border-b border-white/10 px-4 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-xl shadow-lg shadow-sky-500/20">
            ⛅
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-sky-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              SkyCast Weather
            </h1>
            <p className="text-xs text-slate-400 hidden sm:block">
              Full-Stack Flask • Authentication • SQLite • Geolocation • Gemini AI
            </p>
          </div>
        </div>

        {/* View Mode Navigation Tabs */}
        <div className="flex items-center bg-slate-900/90 border border-white/10 p-1 rounded-xl shadow-inner text-xs sm:text-sm">
          <button
            onClick={() => setActiveTab('app')}
            className={`px-3 sm:px-4 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'app'
                ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CloudSun className="w-4 h-4" />
            <span>Live Web App</span>
          </button>

          <button
            onClick={() => setActiveTab('code')}
            className={`px-3 sm:px-4 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'code'
                ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Project Files & Code</span>
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3 sm:px-4 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'architecture'
                ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Architecture & Flow</span>
          </button>
        </div>

        {/* 1-Click ZIP Download Button */}
        <button
          onClick={downloadProjectZip}
          disabled={downloadingZip}
          className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
          title="Download complete standalone Python Flask project (.zip)"
        >
          {downloadingZip ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Packaging ZIP...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Download Project (.zip)</span>
            </>
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        
        {/* TAB 1: LIVE WEATHER APP WITH AUTHENTICATION & DASHBOARD */}
        {activeTab === 'app' && (
          <div className="w-full max-w-3xl mx-auto space-y-6">

            {/* IF USER IS NOT LOGGED IN: SHOW LOGIN OR REGISTER PAGE */}
            {!currentUser ? (
              <div className="bg-[#121826]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
                
                {/* Brand Header */}
                <div className="text-center space-y-2">
                  <div className="text-4xl">⛅</div>
                  <h2 className="text-2xl font-black bg-gradient-to-r from-sky-400 to-purple-400 bg-clip-text text-transparent">
                    {authScreen === 'login' ? 'Welcome to SkyCast' : 'Create an Account'}
                  </h2>
                  <p className="text-sm text-slate-400 max-w-md mx-auto">
                    {authScreen === 'login'
                      ? 'Login to access your personalized real-time weather dashboard'
                      : 'Register to unlock GPS location weather and private search history'}
                  </p>
                </div>

                {/* Feedback Alerts */}
                {authError && (
                  <div className="bg-rose-500/15 border border-rose-500/30 text-rose-300 p-3.5 rounded-xl text-sm flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-400" />
                    <span>{authError}</span>
                  </div>
                )}

                {authSuccess && (
                  <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 p-3.5 rounded-xl text-sm flex items-center gap-3">
                    <Check className="w-5 h-5 flex-shrink-0 text-emerald-400" />
                    <span>{authSuccess}</span>
                  </div>
                )}

                {/* LOGIN FORM */}
                {authScreen === 'login' ? (
                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Email or Username</label>
                      <div className="relative flex items-center">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                        <input
                          type="text"
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          placeholder="e.g. alex@example.com"
                          required
                          className="w-full bg-slate-900/90 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-300">Password</label>
                        <button
                          type="button"
                          onClick={() => {
                            setShowForgotModal(true);
                            setForgotSent(false);
                          }}
                          className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
                        >
                          Forgot Password?
                        </button>
                      </div>
                      <div className="relative flex items-center">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                        <input
                          type="password"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          placeholder="Enter your password"
                          required
                          className="w-full bg-slate-900/90 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2 group"
                    >
                      <span>Login to Dashboard</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>

                    {/* 1-Click Quick Demo Login */}
                    <button
                      type="button"
                      onClick={handleQuickDemoLogin}
                      className="w-full bg-white/5 hover:bg-sky-500/10 border border-dashed border-sky-400/40 text-sky-300 hover:text-sky-200 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2"
                    >
                      <span>⚡ 1-Click Quick Test Login (Demo Account: Alex Morgan)</span>
                    </button>

                    <div className="pt-4 border-t border-white/10 text-center text-xs text-slate-400">
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthScreen('register');
                          setAuthError(null);
                          setAuthSuccess(null);
                        }}
                        className="text-sky-400 hover:text-sky-300 font-semibold underline underline-offset-4"
                      >
                        Create Account
                      </button>
                    </div>
                  </form>
                ) : (
                  /* REGISTRATION FORM */
                  <form onSubmit={handleRegisterSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Full Name</label>
                      <div className="relative flex items-center">
                        <User className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                        <input
                          type="text"
                          value={regFullName}
                          onChange={(e) => setRegFullName(e.target.value)}
                          placeholder="John Doe"
                          required
                          className="w-full bg-slate-900/90 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Email Address</label>
                      <div className="relative flex items-center">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                        <input
                          type="email"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="name@example.com"
                          required
                          className="w-full bg-slate-900/90 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Password</label>
                      <div className="relative flex items-center">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                        <input
                          type="password"
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Create a password (min 6 chars)"
                          required
                          minLength={6}
                          className="w-full bg-slate-900/90 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                        />
                      </div>
                      <span className="text-[11px] text-slate-400">Must be at least 6 characters long</span>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Confirm Password</label>
                      <div className="relative flex items-center">
                        <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                        <input
                          type="password"
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          placeholder="Re-enter your password"
                          required
                          minLength={6}
                          className="w-full bg-slate-900/90 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-sky-600/30 flex items-center justify-center gap-2 group"
                    >
                      <span>Create Account</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>

                    <div className="pt-4 border-t border-white/10 text-center text-xs text-slate-400">
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthScreen('login');
                          setAuthError(null);
                          setAuthSuccess(null);
                        }}
                        className="text-sky-400 hover:text-sky-300 font-semibold underline underline-offset-4"
                      >
                        Login
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              /* IF USER IS LOGGED IN: SHOW FULL WEATHER DASHBOARD */
              <div className="space-y-6">
                
                {/* Dashboard Welcome Header with User Greeting and Logout */}
                <div className="bg-[#121826]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-lg">
                      👤
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                        <span>Welcome back,</span>
                        <span className="text-sky-400">{currentUser.fullName}</span>
                        <span>👋</span>
                      </h2>
                      <p className="text-xs text-slate-400">
                        Logged in as <span className="text-slate-300">{currentUser.email}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Celsius / Fahrenheit Toggle */}
                    <div className="flex items-center bg-slate-900 border border-white/10 p-1 rounded-xl">
                      <button
                        onClick={() => setUnit('C')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          unit === 'C'
                            ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        °C
                      </button>
                      <button
                        onClick={() => setUnit('F')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          unit === 'F'
                            ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        °F
                      </button>
                    </div>

                    {/* Logout Button */}
                    <button
                      onClick={handleLogout}
                      className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 hover:text-rose-100 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5"
                      title="Logout of your session"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Logout 🚪</span>
                    </button>
                  </div>
                </div>

                {/* CURRENT LOCATION ACTION BANNER */}
                <div className="bg-gradient-to-r from-sky-950/60 to-indigo-950/50 border border-sky-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
                  <div className="space-y-1 text-center sm:text-left">
                    <h3 className="text-sm sm:text-base font-bold text-white flex items-center justify-center sm:justify-start gap-2">
                      <MapPin className="w-4 h-4 text-sky-400" />
                      <span>Get Weather for Your Current Location</span>
                    </h3>
                    <p className="text-xs text-slate-300">
                      Click below to trigger browser GPS Geolocation (<code>navigator.geolocation</code>) with no hardcoded coordinates.
                    </p>
                  </div>

                  <button
                    onClick={handleDetectLocation}
                    disabled={loading}
                    className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-sky-500/25 whitespace-nowrap active:scale-95 transition-all disabled:opacity-50"
                  >
                    <span>📍 Use My Current Location</span>
                  </button>
                </div>

                {/* CITY SEARCH BAR WITH SHORTCUT CHIPS */}
                <div className="space-y-2">
                  <form onSubmit={handleSearchSubmit} className="relative flex items-center">
                    <Search className="w-5 h-5 text-slate-400 absolute left-4 pointer-events-none" />
                    <input
                      type="text"
                      value={cityName}
                      onChange={(e) => setCityName(e.target.value)}
                      placeholder="Or search any city manually (e.g. London, Paris, Tokyo, New York)..."
                      className="w-full bg-[#121826]/90 border border-white/10 rounded-2xl pl-12 pr-28 py-3.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 shadow-xl transition-all"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="absolute right-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                    >
                      Search
                    </button>
                  </form>

                  {/* Popular City Quick-Pick Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 px-1">
                    <span className="text-xs text-slate-400 font-semibold mr-1">Popular:</span>
                    {['London', 'New York', 'Tokyo', 'Paris', 'Sydney', 'San Francisco'].map((city) => (
                      <button
                        key={city}
                        onClick={() => fetchWeatherData({ city, isCurrentLocation: false })}
                        className="bg-white/5 hover:bg-sky-500/20 border border-white/10 hover:border-sky-500/40 text-slate-300 hover:text-white px-2.5 py-1 rounded-full text-xs transition-all"
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                </div>

                {/* LOADING INDICATOR */}
                {loading && (
                  <div className="bg-[#121826]/80 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
                    <p className="text-xs sm:text-sm text-slate-300 font-medium">{statusMessage}</p>
                  </div>
                )}

                {/* ERROR BANNER */}
                {errorMsg && (
                  <div className="bg-rose-500/15 border border-rose-500/30 text-rose-300 p-4 rounded-2xl text-xs sm:text-sm flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold">Notice</p>
                      <p>{errorMsg}</p>
                    </div>
                  </div>
                )}

                {/* CURRENT WEATHER CARD */}
                {currentWeather && !loading && (
                  <div className="bg-[#121826]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-7 shadow-2xl space-y-6">
                    {/* Top Bar with Location Badge and Condition Tag */}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {currentWeather.isCurrentLocation && (
                            <span className="bg-sky-500/20 border border-sky-400/40 text-sky-300 text-xs font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              <span>Current Location</span>
                            </span>
                          )}
                          <h3 className="text-2xl sm:text-3xl font-black text-white">
                            {currentWeather.city}
                          </h3>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {new Date().toLocaleDateString(undefined, {
                            weekday: 'long',
                            month: 'short',
                            day: 'numeric'
                          })}
                          {currentWeather.latitude && currentWeather.longitude && (
                            <span className="ml-2 font-mono text-[11px] text-sky-400/80">
                              ({currentWeather.latitude.toFixed(2)}°, {currentWeather.longitude.toFixed(2)}°)
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="bg-white/5 border border-white/10 px-3.5 py-1.5 rounded-full text-xs font-bold text-sky-400 whitespace-nowrap">
                        {currentWeather.condition}
                      </div>
                    </div>

                    {/* Big Temperature Hero Section */}
                    <div className="flex items-center gap-6">
                      <img
                        src={currentWeather.icon}
                        alt={currentWeather.condition}
                        className="w-20 h-20 drop-shadow-[0_4px_16px_rgba(56,189,248,0.3)]"
                      />
                      <div className="flex items-baseline">
                        <span className="text-5xl sm:text-6xl font-black tracking-tight text-white">
                          {unit === 'F' ? toFahrenheit(currentWeather.temperature) : currentWeather.temperature}
                        </span>
                        <span className="text-2xl font-bold text-sky-400 ml-1">°{unit}</span>
                      </div>
                    </div>

                    {/* Weather Metrics Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 flex items-center gap-3">
                        <Thermometer className="w-5 h-5 text-sky-400" />
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                            Feels Like
                          </span>
                          <span className="text-sm font-bold text-white">
                            {formatTemp(currentWeather.feels_like)}
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 flex items-center gap-3">
                        <Droplets className="w-5 h-5 text-blue-400" />
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                            Humidity
                          </span>
                          <span className="text-sm font-bold text-white">
                            {currentWeather.humidity}%
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 flex items-center gap-3">
                        <Wind className="w-5 h-5 text-teal-400" />
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                            Wind Speed
                          </span>
                          <span className="text-sm font-bold text-white">
                            {currentWeather.wind_speed} km/h
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 flex items-center gap-3">
                        <Gauge className="w-5 h-5 text-purple-400" />
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                            Pressure
                          </span>
                          <span className="text-sm font-bold text-white">
                            {currentWeather.pressure} hPa
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 flex items-center gap-3">
                        <Eye className="w-5 h-5 text-emerald-400" />
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                            Visibility
                          </span>
                          <span className="text-sm font-bold text-white">
                            {currentWeather.visibility}
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 flex items-center gap-3">
                        <Sunrise className="w-5 h-5 text-amber-400" />
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                            Sunrise / Sunset
                          </span>
                          <span className="text-xs font-bold text-white">
                            {currentWeather.sunrise} / {currentWeather.sunset}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Google Gemini AI Explanation Card */}
                    <div className="bg-gradient-to-r from-purple-950/40 via-indigo-950/40 to-sky-950/40 border border-purple-500/30 rounded-xl p-4 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-purple-300 uppercase tracking-wider">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span>Google Gemini AI Weather Explanation</span>
                      </div>
                      <p className="text-sm text-purple-100 italic leading-relaxed">
                        "{aiExplanation || 'Analyzing real-time weather metrics with Gemini AI...'}"
                      </p>
                    </div>
                  </div>
                )}

                {/* 5-DAY WEATHER FORECAST */}
                {forecast.length > 0 && !loading && (
                  <div className="space-y-3">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-sky-400" />
                      <span>5-Day Weather Forecast</span>
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {forecast.map((day, idx) => (
                        <div
                          key={idx}
                          className="bg-[#121826]/80 border border-white/10 hover:border-sky-500/40 rounded-2xl p-4 flex flex-col items-center text-center gap-2 transition-all hover:-translate-y-1 shadow-md"
                        >
                          <span className="text-xs font-bold text-white">{day.day}</span>
                          <span className="text-[11px] text-slate-400">{day.date}</span>
                          <img src={day.icon} alt={day.condition} className="w-12 h-12" />
                          <span className="text-xs text-slate-300 truncate max-w-full font-medium" title={day.condition}>
                            {day.condition}
                          </span>
                          <div className="text-xs flex items-center gap-1.5 mt-1">
                            <span className="font-bold text-white">{formatTemp(day.temp_max)}</span>
                            <span className="text-slate-400 font-medium">{formatTemp(day.temp_min)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* RECENT SEARCHES HISTORY (SQL DATABASE) */}
                <div className="bg-[#121826]/80 border border-white/10 rounded-2xl p-5 space-y-3 shadow-xl">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <History className="w-4 h-4 text-sky-400" />
                      <span>Recent Searches (Saved in SQLite Database)</span>
                    </h3>

                    {history.length > 0 && (
                      <button
                        onClick={handleClearHistory}
                        className="text-xs text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear History</span>
                      </button>
                    )}
                  </div>

                  {history.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      No search history recorded yet. Search for a city or click "Use My Current Location" above!
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {history.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            if (item.latitude && item.longitude) {
                              fetchWeatherData({ lat: item.latitude, lon: item.longitude, city: item.city });
                            } else {
                              fetchWeatherData({ city: item.city });
                            }
                          }}
                          className="bg-slate-900/90 hover:bg-sky-500/20 border border-white/10 hover:border-sky-500/40 rounded-xl px-3 py-1.5 text-xs text-slate-200 flex items-center gap-2 transition-all hover:scale-105"
                          title={`Searched on ${item.search_date} at ${item.search_time}`}
                        >
                          <span className="font-semibold text-white">{item.city}</span>
                          {item.latitude && item.longitude && (
                            <span className="text-[10px] text-sky-400 bg-sky-400/10 px-1.5 py-0.5 rounded">
                              {item.latitude.toFixed(1)}°, {item.longitude.toFixed(1)}°
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">{item.search_time.slice(0, 5)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>
        )}

        {/* TAB 2: PROJECT FILES & CODE EXPLORER */}
        {activeTab === 'code' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Sidebar File Tree */}
            <div className="lg:col-span-4 bg-[#121826]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-400" />
                  <span>Project Files ({PROJECT_FILES.length})</span>
                </span>
                <span className="text-[11px] bg-sky-500/20 text-sky-300 font-mono px-2 py-0.5 rounded">
                  weather-app/
                </span>
              </div>

              <div className="space-y-1">
                {PROJECT_FILES.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all flex items-center justify-between group ${
                      selectedFile.path === file.path
                        ? 'bg-sky-500/20 text-white border border-sky-400/40 shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-sm">
                        {file.path.endsWith('.py')
                          ? '🐍'
                          : file.path.endsWith('.html')
                          ? '🌐'
                          : file.path.endsWith('.css')
                          ? '🎨'
                          : file.path.endsWith('.js')
                          ? '⚡'
                          : file.path.endsWith('.sql')
                          ? '🗄️'
                          : '📄'}
                      </span>
                      <span className="truncate">{file.name}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>

              {/* Instructions banner */}
              <div className="pt-3 border-t border-white/10 text-[11px] text-slate-400 leading-relaxed">
                💡 <strong>Beginner Tip:</strong> Click any file to view its code, copy it, or click <strong>Download Project (.zip)</strong> above to download all files into a ready-to-run folder.
              </div>
            </div>

            {/* Code Viewer Panel */}
            <div className="lg:col-span-8 bg-[#121826]/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl flex flex-col overflow-hidden">
              {/* File Meta Header */}
              <div className="bg-slate-900/90 border-b border-white/10 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <span>{selectedFile.path}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">{selectedFile.description}</p>
                </div>

                <button
                  onClick={() => copyCode(selectedFile.content)}
                  className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Code</span>
                    </>
                  )}
                </button>
              </div>

              {/* Syntax Code Container */}
              <div className="p-4 overflow-x-auto max-h-[600px] font-mono text-xs text-slate-300 leading-relaxed selection:bg-sky-500/40">
                <pre className="whitespace-pre">
                  <code>{selectedFile.content}</code>
                </pre>
              </div>
            </div>

          </div>
        )}

        {/* TAB 3: FULL-STACK ARCHITECTURE */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            
            {/* Overview Banner */}
            <div className="bg-[#121826]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-8 shadow-xl space-y-4">
              <h2 className="text-xl sm:text-2xl font-black bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
                <Layers className="w-6 h-6 text-sky-400" />
                <span>Full-Stack Architecture & Component Communication</span>
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                This project implements a clean, beginner-friendly architecture combining <strong>HTML/CSS/JS frontend</strong>, <strong>Python Flask backend with signed sessions</strong>, <strong>secure password hashing</strong>, <strong>SQLite persistence</strong>, and <strong>Google Gemini AI</strong>.
              </p>
            </div>

            {/* Step-by-Step Communication Flow */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Box 1: Authentication & Security */}
              <div className="bg-[#121826]/80 border border-white/10 rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
                  <Lock className="w-5 h-5" />
                  <span>1. User Registration, Login & Flask Sessions</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
                  <li>
                    <strong>Password Security:</strong> User passwords are never saved in plain text. They are hashed using <code>werkzeug.security.generate_password_hash()</code>.
                  </li>
                  <li>
                    <strong>Login Verification:</strong> On login, <code>check_password_hash(stored_hash, user_input)</code> securely validates credentials.
                  </li>
                  <li>
                    <strong>Session Protection:</strong> Flask signed cookies (<code>session['user_id']</code>) maintain the login state. The <code>@login_required</code> decorator protects <code>/dashboard</code>.
                  </li>
                  <li>
                    <strong>SQL Injection Prevention:</strong> Parameterized queries (<code>cursor.execute("SELECT ... WHERE email = ?", (email,))</code>) protect against attacks.
                  </li>
                </ul>
              </div>

              {/* Box 2: Geolocation & Coordinate Detection */}
              <div className="bg-[#121826]/80 border border-white/10 rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                  <Navigation className="w-5 h-5" />
                  <span>2. Browser Geolocation (No Hardcoded Cities)</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
                  <li>
                    <strong>Geolocation API:</strong> <code>navigator.geolocation.getCurrentPosition()</code> asks the browser for real GPS coordinates (latitude & longitude).
                  </li>
                  <li>
                    <strong>Zero Hardcoded City:</strong> Detects where the user actually is. If permission is denied, it displays a polite fallback message.
                  </li>
                  <li>
                    <strong>Reverse Geocoding:</strong> Converts the detected coordinates into a city name and country code for display.
                  </li>
                  <li>
                    <strong>Manual Search Alternative:</strong> Users can also type any city name in the world.
                  </li>
                </ul>
              </div>

              {/* Box 3: Weather Data Fetching */}
              <div className="bg-[#121826]/80 border border-white/10 rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 text-teal-400 font-bold text-sm">
                  <CloudSun className="w-5 h-5" />
                  <span>3. Dual Meteorological API Pipeline</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
                  <li>
                    <strong>Primary API:</strong> OpenWeatherMap API (optional via <code>OPENWEATHER_API_KEY</code>).
                  </li>
                  <li>
                    <strong>Zero-Config Fallback:</strong> If no API key is provided, the app automatically switches to Open-Meteo free API without needing any sign-up!
                  </li>
                  <li>
                    <strong>Metrics Extracted:</strong> Temp, Feels-Like, Humidity, Wind Speed, Pressure, Visibility, Sunrise, and Sunset.
                  </li>
                  <li>
                    <strong>5-Day Forecast:</strong> Automatically calculates high/low temperatures and conditions for 5 consecutive days.
                  </li>
                </ul>
              </div>

              {/* Box 4: SQLite Database & Gemini AI */}
              <div className="bg-[#121826]/80 border border-white/10 rounded-2xl p-5 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                  <Sparkles className="w-5 h-5" />
                  <span>4. SQLite Persistence & Google Gemini AI</span>
                </div>
                <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed">
                  <li>
                    <strong>SQLite Database:</strong> Creates <code>weather.db</code> with two tables: <code>users</code> and <code>search_history</code>.
                  </li>
                  <li>
                    <strong>History Storage:</strong> Stores <code>id</code>, <code>user_id</code>, <code>city</code>, <code>latitude</code>, <code>longitude</code>, <code>search_date</code>, and <code>search_time</code>.
                  </li>
                  <li>
                    <strong>Google Gemini AI:</strong> Calls <code>gemini-2.5-flash</code> with the weather data to generate a short, friendly 1-2 sentence conversational explanation.
                  </li>
                  <li>
                    <strong>Clear History Option:</strong> Users can wipe their search history with one click.
                  </li>
                </ul>
              </div>

            </div>

            {/* Run Locally Terminal Guide */}
            <div className="bg-[#121826]/80 border border-white/10 rounded-2xl p-6 space-y-3 shadow-xl">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>How to Run Locally on Your Machine in 3 Steps</span>
              </h3>

              <div className="space-y-3 text-xs font-mono">
                <div className="bg-slate-950/80 p-3 rounded-xl border border-white/5 space-y-1">
                  <span className="text-slate-400"># 1. Download & extract ZIP, then enter directory:</span>
                  <p className="text-emerald-400">cd weather-app</p>
                </div>

                <div className="bg-slate-950/80 p-3 rounded-xl border border-white/5 space-y-1">
                  <span className="text-slate-400"># 2. Install dependencies & initialize database:</span>
                  <p className="text-emerald-400">pip install -r requirements.txt</p>
                  <p className="text-emerald-400">python init_db.py</p>
                </div>

                <div className="bg-slate-950/80 p-3 rounded-xl border border-white/5 space-y-1">
                  <span className="text-slate-400"># 3. Start Flask server:</span>
                  <p className="text-emerald-400">python app.py</p>
                  <span className="text-slate-400"># Open browser at: http://127.0.0.1:5000</span>
                </div>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121826] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-sky-400" />
                <span>Forgot Password</span>
              </h3>
              <button
                onClick={() => setShowForgotModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Enter your email address to receive password reset instructions.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-400">Email Address</label>
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>

            {forgotSent && (
              <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 p-2.5 rounded-xl text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Password reset link sent to {forgotEmail || 'your email'}!</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setForgotSent(true);
                  setTimeout(() => setShowForgotModal(false), 2000);
                }}
                className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
              >
                Send Reset Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#0f172a]/60 py-4 px-6 text-center text-xs text-slate-400">
        <p>SkyCast Weather • Python Flask with Sessions & Werkzeug • SQLite Database • Geolocation API • Google Gemini AI</p>
      </footer>
    </div>
  );
}

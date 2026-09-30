/**
 * script.js - Frontend JavaScript for SkyCast Weather
 * Features:
 * - "📍 Use My Current Location" button handler
 * - Browser JavaScript Geolocation API: navigator.geolocation.getCurrentPosition()
 * - POST /weather/location async fetch to Python Flask backend
 * - Exact required location status messages
 * - Real-time metrics display (temp, feels-like, condition, humidity, wind, pressure, visibility, sunrise/sunset)
 * - 5-day weather forecast
 * - Google Gemini AI explanation
 * - Instant Celsius (°C) / Fahrenheit (°F) switcher
 * - SQLite search history management
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

// Weather Metrics Elements
const metricFeels = document.getElementById('metric-feels');
const metricHumidity = document.getElementById('metric-humidity');
const metricWind = document.getElementById('metric-wind');
const metricPressure = document.getElementById('metric-pressure');
const metricVisibility = document.getElementById('metric-visibility');
const metricSun = document.getElementById('metric-sun');

// AI Summary & 5-Day Forecast Elements
const aiExplanationText = document.getElementById('ai-explanation-text');
const forecastGrid = document.getElementById('forecast-grid');

// Search History & Unit Switcher
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
        return `${toFahrenheit(celsius)}°F`;
    }
    return `${Math.round(celsius)}°C`;
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
// 2. UI STATE & STATUS HELPERS
// ==========================================
function showLoading(message) {
    loadingText.textContent = message || "Getting your current location...";
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
    locationStatusBadge.className = `location-status-badge status-${type}`;
    locationStatusBadge.textContent = statusText;
}


// ==========================================
// 3. CURRENT LOCATION DETECTION
// ==========================================
/**
 * Uses browser's JavaScript Geolocation API: navigator.geolocation.getCurrentPosition()
 * Prompts user for permission, obtains latitude & longitude,
 * and sends coordinates to Flask backend endpoint: POST /weather/location
 */
function detectCurrentLocation() {
    // 1. Check if browser supports Geolocation API
    if (!navigator.geolocation) {
        const notSupportedMsg = "Unable to detect your current location. Please try again.";
        showError(notSupportedMsg);
        setLocationStatus(notSupportedMsg, "error");
        return;
    }

    // Show loading status message while getting location
    showLoading("Getting your current location...");
    setLocationStatus("Getting your current location...", "loading");
    hideError();

    // 2. Ask user for permission to access current location
    navigator.geolocation.getCurrentPosition(
        // SUCCESS CALLBACK: User granted permission
        async (position) => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            try {
                // 3. Send latitude and longitude to Flask backend using JavaScript fetch()
                const response = await fetch('/weather/location', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        latitude: latitude,
                        longitude: longitude
                    })
                });

                const data = await response.json();
                hideLoading();

                if (!response.ok || !data.success) {
                    const failMsg = data.error || "Unable to retrieve weather information. Please try again.";
                    showError(failMsg);
                    setLocationStatus("Unable to retrieve weather information. Please try again.", "error");
                    return;
                }

                // Show required success status message
                setLocationStatus("Current location detected.", "success");

                // Cache and display complete weather metrics
                weatherDataCache = data;
                renderWeatherUI(data);

                // Update search history in UI
                if (data.history) {
                    renderHistory(data.history);
                }

            } catch (err) {
                console.error("Error communicating with /weather/location endpoint:", err);
                hideLoading();
                showError("Unable to retrieve weather information. Please try again.");
                setLocationStatus("Unable to retrieve weather information. Please try again.", "error");
            }
        },
        // ERROR CALLBACK: User denied permission or position unavailable
        (error) => {
            hideLoading();
            let statusMsg = "";

            if (error.code === error.PERMISSION_DENIED) {
                // Exact message when permission is denied
                statusMsg = "Location permission denied. Please allow location access or search for a city manually.";
            } else {
                // Exact message when location cannot be obtained (timeout or unavailable)
                statusMsg = "Unable to detect your current location. Please try again.";
            }

            console.warn("Geolocation error:", error.code, error.message);
            showError(statusMsg);
            setLocationStatus(statusMsg, "error");
        },
        // Geolocation Options
        {
            timeout: 10000,
            enableHighAccuracy: true
        }
    );
}


// ==========================================
// 4. MANUAL CITY WEATHER SEARCH
// ==========================================
async function fetchWeatherForCity(city) {
    showLoading(`Searching weather for "${city}"...`);
    setLocationStatus(''); // clear current-location badge when searching another city

    try {
        const response = await fetch(`/api/weather?city=${encodeURIComponent(city.trim())}`);
        const data = await response.json();

        hideLoading();

        if (!response.ok || data.error) {
            showError(data.error || "Unable to retrieve weather information. Please try again.");
            return;
        }

        weatherDataCache = data;
        renderWeatherUI(data);

        if (data.history) {
            renderHistory(data.history);
        }

    } catch (err) {
        console.error("City weather API error:", err);
        hideLoading();
        showError("Unable to retrieve weather information. Please try again.");
    }
}


// ==========================================
// 5. RENDER WEATHER DATA ON THE WEBPAGE
// ==========================================
function renderWeatherUI(data) {
    hideError();
    const current = data.current;
    const forecast = data.forecast;
    const aiSummary = data.ai_explanation;

    // Show or hide "📍 Current Location" badge on the card
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

    // 6 Weather Metrics
    metricFeels.textContent = formatTemperature(current.feels_like);
    metricHumidity.textContent = `${current.humidity}%`;
    metricWind.textContent = `${current.wind_speed} km/h`;
    metricPressure.textContent = `${current.pressure} hPa`;
    metricVisibility.textContent = current.visibility;
    metricSun.textContent = `${current.sunrise} / ${current.sunset}`;

    // Google Gemini AI Explanation
    aiExplanationText.textContent = `"${aiSummary}"`;

    // 5-Day Weather Forecast
    renderForecast(forecast);

    // Reveal results container
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

        card.innerHTML = `
            <span class="forecast-day">${day.day}</span>
            <span class="forecast-date">${day.date}</span>
            <img class="forecast-icon" src="${day.icon}" alt="${day.condition}">
            <span class="forecast-condition" title="${day.condition}">${day.condition}</span>
            <div class="forecast-temps">
                <span class="temp-max">${maxTemp}</span>
                <span class="temp-min">${minTemp}</span>
            </div>
        `;
        forecastGrid.appendChild(card);
    });
}


// ==========================================
// 6. RENDER SEARCH HISTORY (FROM SQL DATABASE)
// ==========================================
function renderHistory(historyItems) {
    historyList.innerHTML = '';

    if (!historyItems || historyItems.length === 0) {
        historyList.innerHTML = '<p class="history-empty">No recent searches yet. Search a city or click "📍 Use My Current Location" above!</p>';
        return;
    }

    historyItems.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'history-item';
        chip.setAttribute('title', `Searched on ${item.search_date} at ${item.search_time}`);

        const coordTag = (item.latitude && item.longitude) 
            ? `<span class="history-coord">${item.latitude.toFixed(1)}°, ${item.longitude.toFixed(1)}°</span>`
            : '';

        chip.innerHTML = `
            <span class="history-city">${item.city}</span>
            ${coordTag}
            <span class="history-time">${item.search_time.slice(0, 5)}</span>
        `;

        // Re-query weather when clicking history chip
        chip.addEventListener('click', () => {
            cityInput.value = item.city;
            if (item.latitude && item.longitude) {
                showLoading(`Fetching weather for coordinates (${item.latitude.toFixed(2)}, ${item.longitude.toFixed(2)})...`);
                fetch('/weather/location', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latitude: item.latitude, longitude: item.longitude })
                })
                .then(res => res.json())
                .then(data => {
                    hideLoading();
                    if (data.success) {
                        weatherDataCache = data;
                        renderWeatherUI(data);
                    }
                })
                .catch(() => {
                    hideLoading();
                    showError("Unable to retrieve weather information. Please try again.");
                });
            } else {
                fetchWeatherForCity(item.city);
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

// 1. "📍 Use My Current Location" Button Click Handler
btnCurrentLocation.addEventListener('click', () => {
    cityInput.value = '';
    detectCurrentLocation();
});

// 2. Manual City Search Submission
searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const city = cityInput.value.trim();
    if (!city) {
        showError("Please enter a city name before searching.");
        cityInput.focus();
        return;
    }
    fetchWeatherForCity(city);
});

// 3. Temperature Unit Switcher (°C / °F)
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

// 4. Clear Search History Button
clearHistoryBtn.addEventListener('click', clearSearchHistory);

// 5. Popular City Quick-Pick Chips
document.querySelectorAll('.quick-chip').forEach(button => {
    button.addEventListener('click', () => {
        const city = button.getAttribute('data-city');
        cityInput.value = city;
        fetchWeatherForCity(city);
    });
});

// 6. Page load: Load past search history from SQLite
document.addEventListener('DOMContentLoaded', () => {
    loadSearchHistory();
});

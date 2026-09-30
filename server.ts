import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json());

  // Initialize Gemini API client on the server side
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Server-side route for Gemini AI Weather Explanation
  app.post('/api/gemini-explanation', async (req, res) => {
    try {
      const { city, temperature, condition, humidity, windSpeed, isCurrentLocation } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        const prefix = isCurrentLocation ? "Your current location" : `Today in ${city}`;
        return res.json({
          text: `${prefix} is ${condition.toLowerCase()}. The temperature is ${temperature}°C with ${humidity}% humidity.`,
        });
      }

      const prompt = `You are a friendly weather assistant. Given this current weather:
Location: ${city} (User's current GPS location: ${Boolean(isCurrentLocation)})
Temperature: ${temperature}°C
Condition: ${condition}
Humidity: ${humidity}%
Wind Speed: ${windSpeed} km/h

Provide a short, simple, warm explanation of the current weather for the user. For example: "Your current location is warm and cloudy. The temperature is ${temperature}°C with ${humidity}% humidity." Keep it under 35 words.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });

      res.json({ text: response.text?.trim()?.replace(/^["']|["']$/g, '') });
    } catch (error: any) {
      console.error('Error generating AI explanation:', error);
      res.json({
        text: `Today is a pleasant day in ${req.body.city || 'your area'}. With temperatures around ${req.body.temperature || 20}°C, enjoy your day!`,
      });
    }
  });

  if (!isProduction) {
    // Development mode with Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

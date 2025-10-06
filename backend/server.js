// server.js - Lynxa Pro API Server (Powered by Groq + Llama)
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Lynxa Pro system prompt
const LYNXA_SYSTEM_PROMPT = `You are Lynxa Pro, an advanced AI assistant developed by Nexariq, a sub-brand of AJ STUDIOZ. 
Your identity:
- Name: Lynxa Pro
- Developer: Nexariq (sub-brand of AJ STUDIOZ)
- Purpose: To provide intelligent, helpful, and professional assistance
Your personality:
- Professional yet friendly
- Knowledgeable and helpful
- Clear and concise in responses
When users ask who you are, mention you're Lynxa Pro, developed by Nexariq, a sub-brand of AJ STUDIOZ.`;

// API Key Management
const API_KEY_SECRET = process.env.API_KEY_SECRET;
if (!API_KEY_SECRET) {
  console.error('🚨 API_KEY_SECRET is required in .env!');
  process.exit(1);
}

const apiKeys = new Map(); // In-memory: hashedKey -> { email, created }

// Middleware: API Key Authentication
const apiKeyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'API key required: Authorization: Bearer <key>' });
  }

  const providedKey = authHeader.substring(7);
  const providedHash = crypto
    .createHmac('sha256', API_KEY_SECRET)
    .update(providedKey)
    .digest('hex');

  const userData = apiKeys.get(providedHash);
  if (!userData) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.user = userData;
  next();
};

// Endpoint: Generate API Key
app.post('/api/keys/generate', (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.endsWith('@gmail.com')) {
      return res.status(400).json({ error: 'Valid Gmail address required' });
    }

    const plainKey = `lynxa_pro_${crypto.randomUUID()}`;
    const hashedKey = crypto
      .createHmac('sha256', API_KEY_SECRET)
      .update(plainKey)
      .digest('hex');

    apiKeys.set(hashedKey, {
      email,
      created: new Date().toISOString()
    });

    res.json({
      success: true,
      apiKey: plainKey,
      message: `Key generated for ${email}. Keep this secure!`,
      expires: null
    });
  } catch (error) {
    console.error('Key generation error:', error);
    res.status(500).json({ error: 'Failed to generate key' });
  }
});

// Chat Endpoint (requires API key)
app.post('/api/lynxa', apiKeyAuth, async (req, res) => {
  try {
    const { 
      message, 
      model = 'llama-3.3-70b-versatile', 
      max_tokens = 1000,
      conversation_history = []
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const messages = [
      { role: 'system', content: LYNXA_SYSTEM_PROMPT },
      ...conversation_history,
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    res.json({
      success: true,
      response: data.choices[0].message.content,
      model: 'Lynxa Pro (powered by AJ STUDIOZ)',
      usage: data.usage,
      developer: 'Nexariq - AJ STUDIOZ',
      user: req.user.email
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Info Endpoint (public)
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Lynxa Pro',
    version: '1.0.0',
    developer: 'Nexariq',
    parent_company: 'AJ STUDIOZ',
    powered_by: 'Groq + Llama 3.3 70B',
    description: 'Advanced AI assistant. Use API keys for access.',
    endpoints: {
      generateKey: '/api/keys/generate (POST, body: {email: "user@gmail.com"})',
      chat: '/api/lynxa (POST, requires API key)',
      info: '/api/info',
      health: '/health'
    },
    available_models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it'
    ],
    auth: 'Required for /api/lynxa. Generate keys via /api/keys/generate.'
  });
});

// Health Endpoint (public)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Lynxa Pro API is running',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Lynxa Pro API Server running on port ${PORT}`);
  console.log(`📡 Chat Endpoint: /api/lynxa (requires API key)`);
  console.log(`🔑 Generate Keys: /api/keys/generate`);
  console.log(`🏢 Developed by Nexariq - AJ STUDIOZ`);
});

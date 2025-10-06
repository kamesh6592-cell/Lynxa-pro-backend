// server.js - Grok API Proxy Server for Render
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Your custom endpoint that proxies to Grok
app.post('/api/lynxa', async (req, res) => {
  try {
    const { message, model = 'grok-beta', max_tokens = 1000 } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Call Grok API
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: message
          }
        ],
        model: model,
        stream: false,
        temperature: 0.7,
        max_tokens: max_tokens
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ error: error });
    }

    const data = await response.json();
    
    // Return the response
    res.json({
      success: true,
      response: data.choices[0].message.content,
      model: data.model,
      usage: data.usage
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Grok API Proxy is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

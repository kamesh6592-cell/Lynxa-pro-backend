// server.js - Lynxa Pro API Server (Powered by Grok)
const express = require('express');
const cors = require('cors');
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
- Always ready to assist with various tasks

When users ask who you are or who created you, always mention that you're Lynxa Pro, developed by Nexariq, a sub-brand of AJ STUDIOZ.`;

// Your custom endpoint that proxies to Grok
app.post('/api/lynxa', async (req, res) => {
  try {
    const { 
      message, 
      model = 'grok-beta', 
      max_tokens = 1000,
      conversation_history = [] // Support for multi-turn conversations
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build messages array with system prompt and conversation history
    const messages = [
      {
        role: 'system',
        content: LYNXA_SYSTEM_PROMPT
      },
      ...conversation_history, // Include previous messages if provided
      {
        role: 'user',
        content: message
      }
    ];

    // Call Grok API
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        messages: messages,
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
      model: 'Lynxa Pro (powered by Grok)',
      usage: data.usage,
      developer: 'Nexariq - AJ STUDIOZ'
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

// Info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Lynxa Pro',
    version: '1.0.0',
    developer: 'Nexariq',
    parent_company: 'AJ STUDIOZ',
    description: 'Advanced AI assistant powered by cutting-edge language models',
    endpoints: {
      chat: '/api/lynxa',
      info: '/api/info',
      health: '/health'
    }
  });
});

// Health check endpoint
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
  console.log(`📡 Endpoint: /api/lynxa`);
  console.log(`🏢 Developed by Nexariq - AJ STUDIOZ`);
});

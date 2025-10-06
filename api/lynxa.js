// api/lynxa.js
import crypto from 'crypto';
import { getEnv } from '../../utils/env.js';

const LYNXA_SYSTEM_PROMPT = `You are Lynxa Pro, an advanced AI assistant developed by Nexariq, a sub-brand of AJ STUDIOZ. 
Your identity: Name: Lynxa Pro, Developer: Nexariq (sub-brand of AJ STUDIOZ), Purpose: To provide intelligent, helpful, and professional assistance.
Your personality: Professional yet friendly, knowledgeable, clear and concise.
Mention you're Lynxa Pro, developed by Nexariq, a sub-brand of AJ STUDIOZ when asked who you are.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'API key required: Authorization: Bearer <key>' });
  }

  const providedKey = authHeader.substring(7);
  const API_KEY_SECRET = getEnv('API_KEY_SECRET');
  const providedHash = crypto
    .createHmac('sha256', API_KEY_SECRET)
    .update(providedKey)
    .digest('hex');

  const apiKeys = new Map(); // In-memory, resets per invocation
  const userData = apiKeys.get(providedHash);
  if (!userData) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { message, model = 'llama-3.3-70b-versatile', max_tokens = 1000, conversation_history = [] } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const GROQ_API_KEY = getEnv('GROQ_API_KEY');
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: LYNXA_SYSTEM_PROMPT },
          ...conversation_history,
          { role: 'user', content: message }
        ],
        max_tokens,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ error });
    }

    const data = await response.json();
    res.status(200).json({
      success: true,
      response: data.choices[0].message.content,
      model: 'Lynxa Pro (powered by AJ STUDIOZ)',
      usage: data.usage,
      developer: 'Nexariq - AJ STUDIOZ',
      user: userData.email
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
}

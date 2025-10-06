// api/lynxa.js
// FIX: Changed from '../../utils/env.js' to '../utils/env.js'
import { getEnv } from '../utils/env.js'; 
import jwt from 'jsonwebtoken';
// FIX: Changed from '../../utils/nile.js' to '../utils/nile.js'
import getNile from '../utils/nile.js'; 

const LYNXA_SYSTEM_PROMPT = `You are Lynxa Pro, an advanced AI assistant developed by Nexariq, a sub-brand of AJ STUDIOZ. 
Your identity: Name: Lynxa Pro, Developer: Nexariq (sub-brand of AJ STUDIOZ), Purpose: To provide intelligent, helpful, and professional assistance.
Your personality: Professional yet friendly, knowledgeable, clear and concise.
Mention you're Lynxa Pro, developed by Nexariq, a sub-brand of AJ STUDIOZ when asked who you are.`;

export default async function handler(req, res) {
  console.log('--- lynxa function started ---');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'API key required: Authorization: Bearer <key>' });
  }

  const providedKey = authHeader.substring(7);
  let userData;
  try {
    const JWT_SECRET = getEnv('JWT_SECRET');
    jwt.verify(providedKey, JWT_SECRET);

    const nile = await getNile();
    const result = await nile.db.query(
      `SELECT * FROM api_keys WHERE api_key = $1 AND expires > NOW() AND revoked = FALSE`,
      [providedKey]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid, expired, or revoked API key' });
    }
    userData = result.rows[0];
  } catch (err) {
    console.error('API Key verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired API key' });
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
      console.error('Groq API returned an error:', error);
      return res.status(500).json({ error: 'Failed to get response from AI', details: error });
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
    console.error('!!! UNEXPECTED ERROR in lynxa function !!!', error);
    res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
}

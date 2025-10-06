// api/generate-key.js
import jwt from 'jsonwebtoken';
import { getEnv } from '../utils/env.js';
import getNile from '../utils/nile.js';

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;
    
    if (!email || !email.endsWith('@gmail.com')) {
      return res.status(400).json({ error: 'Valid Gmail address required' });
    }

    // Get the secret key using the standardized JWT_SECRET
    const JWT_SECRET = getEnv('JWT_SECRET');
    if (!JWT_SECRET) {
      console.error('JWT_SECRET not found in environment');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Create JWT payload
    const payload = {
      email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
    };
    
    const apiKey = jwt.sign(payload, JWT_SECRET);
    const expires = new Date(payload.exp * 1000).toISOString();

    // Initialize Nile client
    const nile = await getNile();
    
    // Insert into database
    const result = await nile.db.query(
      `INSERT INTO api_keys (api_key, email, expires, revoked) 
       VALUES ($1, $2, $3, FALSE) 
       RETURNING *`,
      [apiKey, email, expires]
    );

    console.log('API key generated successfully for:', email);

    return res.status(200).json({
      success: true,
      apiKey,
      message: `Key generated for ${email}. Keep secure! Expires in 30 days.`,
      expires
    });

  } catch (err) {
    console.error('Error in generate-key:', err);
    return res.status(500).json({ 
      error: 'Server error', 
      message: err.message
    });
  }
}

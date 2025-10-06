// api/generate-key.js
import { randomBytes } from 'crypto'; // Import crypto for secure random string generation
import { getEnv } from '../utils/env.js';
import getNile from '../utils/nile.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    // --- NEW KEY GENERATION LOGIC ---
    // Generate a secure random string (32 bytes will be 64 hex characters)
    const randomPart = randomBytes(32).toString('hex');
    const apiKey = `nxq_${randomPart}`;
    
    // Set expiration for 30 days from now
    const expires = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();

    // Initialize Nile client
    const nile = await getNile();
    
    // Insert the new key into the database
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

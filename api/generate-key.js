import crypto from 'crypto';
import { getEnv } from '../../utils/env.js';
import jwt from 'jsonwebtoken';
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;
  if (!email || !email.endsWith('@gmail.com')) {
    return res.status(400).json({ error: 'Valid Gmail address required' });
  }

  const JWT_SECRET = getEnv('JWT_SECRET');
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days expiration
  };
  const apiKey = jwt.sign(payload, JWT_SECRET);

  // Store revocation flag in KV (initially false)
  await kv.set(`revoke:${apiKey}`, 'false');

  // Optional: Store additional user data if needed (e.g., for logging)
  const hashedKey = crypto.createHmac('sha256', getEnv('API_KEY_SECRET')).update(apiKey).digest('hex');
  await kv.set(hashedKey, JSON.stringify({ email, created: new Date().toISOString(), expires: new Date(payload.exp * 1000).toISOString() }));

  res.status(200).json({
    success: true,
    apiKey,
    message: `Key generated for ${email}. Keep this secure! Expires in 30 days.`,
    expires: new Date(payload.exp * 1000).toISOString()
  });
}

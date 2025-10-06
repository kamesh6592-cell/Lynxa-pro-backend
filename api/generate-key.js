// api/generate-key.js
import crypto from 'crypto';
import { getEnv } from '../../utils/env.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;
  if (!email || !email.endsWith('@gmail.com')) {
    return res.status(400).json({ error: 'Valid Gmail address required' });
  }

  const API_KEY_SECRET = getEnv('API_KEY_SECRET');
  const plainKey = `lynxa_pro_${crypto.randomUUID()}`;
  const hashedKey = crypto
    .createHmac('sha256', API_KEY_SECRET)
    .update(plainKey)
    .digest('hex');

  // In-memory storage (resets per cold start on free tier)
  const apiKeys = new Map();
  apiKeys.set(hashedKey, { email, created: new Date().toISOString() });

  res.status(200).json({
    success: true,
    apiKey: plainKey,
    message: `Key generated for ${email}. Keep this secure!`,
    expires: null
  });
}

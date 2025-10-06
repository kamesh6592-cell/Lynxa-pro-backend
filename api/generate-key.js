import jwt from 'jsonwebtoken';
import { getEnv } from '../../utils/env.js';
import nile from '../../utils/nile.js';

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
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)  // 30 days
  };
  const apiKey = jwt.sign(payload, JWT_SECRET);
  const expires = new Date(payload.exp * 1000).toISOString();

  try {
    // Optional multi-tenant: Create tenant if not exists
    // const tenantRes = await nile.api.tenants.create({ name: email });
    // const tenantId = (await tenantRes.json()).id;
    // nile.tenantId = tenantId;  // Set context for this request

    await nile.db.query(
      `INSERT INTO api_keys (api_key, email, expires) VALUES ($1, $2, $3) RETURNING *`,
      [apiKey, email, expires]
    );  // Add tenant_id: $4 if multi-tenant

    res.status(200).json({
      success: true,
      apiKey,
      message: `Key generated for ${email}. Keep secure! Expires in 30 days.`,
      expires
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error', message: err.message });
  }
}

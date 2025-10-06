import { getEnv } from '../../utils/env.js';
import nile from '../../utils/nile.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  try {
    await nile.db.query(`UPDATE api_keys SET revoked = TRUE WHERE api_key = $1`, [apiKey]);
    res.status(200).json({ success: true, message: 'Key revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
}

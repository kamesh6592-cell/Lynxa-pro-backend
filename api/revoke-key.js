// api/revoke-key.js
import { getEnv } from '../../utils/env.js';
import getNile from '../../utils/nile.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required in request body' });

  try {
    const nile = await getNile();
    // Use parameterized query to prevent SQL injection
    const result = await nile.db.query(`UPDATE api_keys SET revoked = TRUE WHERE api_key = $1`, [apiKey]);
    
    if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'API key not found' });
    }

    res.status(200).json({ success: true, message: 'Key revoked successfully' });
  } catch (err) {
    console.error('Error revoking key:', err);
    res.status(500).json({ error: 'Database error', message: err.message });
  }
}

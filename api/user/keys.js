// api/user/keys.js
import { getAuth } from '@clerk/nextjs/server';
import getNile from '../../../utils/nile.js';

export default async function handler(req, res) {
  // ADD CORS HEADERS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized - Please log in.' });
  }

  if (req.method === 'GET') {
    try {
      const nile = await getNile();
      const result = await nile.db.query(
        `SELECT api_key, email, expires, revoked, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );
      res.status(200).json({ keys: result.rows });
    } catch (error) {
      console.error('Error fetching keys for user:', userId, error);
      res.status(500).json({ error: 'Failed to fetch keys' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

// api/health.js
export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.status(200).json({ status: 'ok', message: 'Lynxa Pro API is running', timestamp: new Date().toISOString() });
}

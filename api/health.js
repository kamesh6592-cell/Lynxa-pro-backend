// api/health.js
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      service: 'Lynxa Pro Backend'
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
}

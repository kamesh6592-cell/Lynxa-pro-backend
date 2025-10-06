// api/info.js
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.status(200).json({ 
      name: 'Lynxa Pro Backend',
      version: '1.0.0',
      developer: 'Nexariq - AJ STUDIOZ',
      endpoints: [
        { path: '/api/keys/generate', method: 'POST', description: 'Generate a new API key' },
        { path: '/api/keys/revoke', method: 'POST', description: 'Revoke an API key' },
        { path: '/api/lynxa', method: 'POST', description: 'Chat with Lynxa Pro AI' },
        { path: '/api/health', method: 'GET', description: 'Check service health' },
        { path: '/api/info', method: 'GET', description: 'Get service information' }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

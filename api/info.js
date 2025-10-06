export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.status(200).json({
    name: 'Lynxa Pro',
    version: '1.0.0',
    developer: 'Nexariq',
    parent_company: 'AJ STUDIOZ',
    powered_by: 'Groq + Llama 3.3 70B',
    description: 'Advanced AI assistant. Use API keys for access. Keys now use JWT with 30-day expiration.',
    endpoints: {
      generateKey: '/api/keys/generate (POST, body: {email: "user@gmail.com"})',
      chat: '/api/lynxa (POST, requires API key)',
      info: '/api/info',
      health: '/health'
    },
    available_models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it'
    ],
    auth: 'Required for /api/lynxa. Generate keys via /api/keys/generate. Keys expire in 30 days.'
  });
}

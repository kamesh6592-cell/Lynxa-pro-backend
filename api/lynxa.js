// api/lynxa.js - Lynxa Pro (Claude-like API) with Streaming + Auth + Usage Logging
import { getEnv } from '../utils/env.js';
import getNile from '../utils/nile.js';
import { randomBytes } from 'crypto';

const LYNXA_SYSTEM_PROMPT = `You are Lynxa Pro, an advanced AI assistant developed by Nexariq, a sub-brand of AJ STUDIOZ. 
Your identity: Name: Lynxa Pro, Developer: Nexariq (sub-brand of AJ STUDIOZ), Purpose: To provide intelligent, helpful, and professional assistance.
Your personality: Professional yet friendly, knowledgeable, clear and concise.
Mention you're Lynxa Pro, developed by Nexariq, a sub-brand of AJ STUDIOZ when asked who you are.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 🔐 Validate API Key
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'NEXARIQ_API_KEY required: Authorization: Bearer <key>' });
  }

  const providedKey = authHeader.substring(7);
  let userData;

  try {
    const nile = await getNile();
    const result = await nile.db.query(
      `SELECT * FROM api_keys WHERE api_key = $1 AND expires > NOW() AND revoked = FALSE`,
      [providedKey]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid, expired, or revoked NEXARIQ_API_KEY',
        message: 'Generate a key at /api/keys/generate'
      });
    }

    userData = result.rows[0];
  } catch (err) {
    console.error('API Key verification failed:', err.message);
    return res.status(500).json({ error: 'Database error during authentication' });
  }

  // 🧠 Extract payload (Claude/OpenAI-like format)
  const {
    model = 'lynxa-pro',
    max_tokens = 4096,
    messages = [],
    stream = false
  } = req.body;

  if (!messages.length) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const message = messages[messages.length - 1].content;
  const conversation_history = messages.slice(0, -1);

  try {
    // 🔑 Use internal Groq key
    const GROQ_API_KEY = getEnv('GROQ_API_KEY');

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: LYNXA_SYSTEM_PROMPT },
          ...conversation_history,
          { role: 'user', content: message }
        ],
        max_tokens,
        temperature: 0.7,
        stream
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Groq API error:', error);
      return res.status(500).json({ error: 'Failed to get response from Lynxa Pro', details: error });
    }

    // ⚡ STREAMING MODE (Claude-compatible SSE)
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const messageId = `msg_${randomBytes(16).toString('hex')}`;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                res.write(`event: message_stop\n`);
                res.write(`data: ${JSON.stringify({
                  type: 'message_stop',
                  id: messageId
                })}\n\n`);
                res.end();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices[0]?.delta?.content;

                if (content) {
                  res.write(`event: content_block_delta\n`);
                  res.write(`data: ${JSON.stringify({
                    type: 'content_block_delta',
                    index: 0,
                    delta: {
                      type: 'text_delta',
                      text: content
                    }
                  })}\n\n`);
                }
              } catch {
                // Ignore malformed chunks
              }
            }
          }
        }
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
        res.end();
      }
    }

    // 💬 NON-STREAMING MODE (Claude-style JSON)
    else {
      const data = await response.json();
      const messageId = `msg_${randomBytes(16).toString('hex')}`;
      const responseText = data.choices[0].message.content;

      // Log usage per user
      try {
        const nile = await getNile();
        await nile.db.query(
          `INSERT INTO api_logs (user_email, api_key, input_tokens, output_tokens, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [userData.email, providedKey, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0]
        );
      } catch (logErr) {
        console.warn('Usage log failed:', logErr.message);
      }

      res.status(200).json({
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: 'lynxa-pro',
        content: [
          {
            type: 'text',
            text: responseText
          }
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: data.usage?.prompt_tokens ?? 0,
          output_tokens: data.usage?.completion_tokens ?? 0,
          total_tokens: data.usage?.total_tokens ?? 0
        }
      });
    }
  } catch (error) {
    console.error('Unexpected error in Lynxa Pro:', error);
    res.status(500).json({
      type: 'error',
      error: {
        type: 'internal_error',
        message: error.message
      }
    });
  }
}

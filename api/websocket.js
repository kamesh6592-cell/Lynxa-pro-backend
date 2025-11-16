// api/websocket.js - Advanced WebSocket Management for Real-time Features
import { WebSocketServer } from 'ws';
import { parse } from 'url';
import jwt from 'jsonwebtoken';
import getNile from '../utils/nile.js';
import { getEnv } from '../utils/env.js';

// WebSocket connection tracking
const activeConnections = new Map();
const connectionMetrics = {
  totalConnections: 0,
  activeConnections: 0,
  messagesSent: 0,
  messagesReceived: 0,
  bytesTransferred: 0
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'WebSocket endpoint expects GET request' });
  }

  // Return connection info for HTTP requests
  res.status(200).json({
    endpoint: 'wss://lynxa-pro-backend.vercel.app/api/websocket',
    protocol: 'websocket',
    authentication: 'Bearer token in query parameter or Authorization header',
    features: [
      'Real-time usage monitoring',
      'Live system metrics',
      'User activity tracking',
      'Alert notifications',
      'Collaborative features'
    ],
    metrics: {
      ...connectionMetrics,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
  });
}

// WebSocket Server Configuration
export const config = {
  api: {
    bodyParser: false,
  },
};

// Initialize WebSocket Server (this would be in a separate service in production)
function initializeWebSocketServer() {
  const wss = new WebSocketServer({ 
    port: process.env.WS_PORT || 8080,
    perMessageDeflate: false
  });

  wss.on('connection', async (ws, request) => {
    console.log('🔌 New WebSocket connection attempt');
    
    try {
      // Parse connection URL for authentication
      const { query } = parse(request.url, true);
      const token = query.token || request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        ws.close(4001, 'Authentication required');
        return;
      }

      // Validate API key
      const nile = await getNile();
      const result = await nile.db.query(
        `SELECT ak.*, u.id as user_id, u.email, u.role, u.organization_id 
         FROM api_keys ak 
         JOIN users u ON ak.user_id = u.id 
         WHERE ak.api_key = $1 AND ak.expires > NOW() AND ak.revoked = FALSE`,
        [token]
      );

      if (result.rows.length === 0) {
        ws.close(4003, 'Invalid API key');
        return;
      }

      const userData = result.rows[0];
      const connectionId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store connection info
      const connectionInfo = {
        id: connectionId,
        userId: userData.user_id,
        email: userData.email,
        role: userData.role,
        organizationId: userData.organization_id,
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        bytesTransferred: 0,
        ws: ws
      };

      activeConnections.set(connectionId, connectionInfo);
      connectionMetrics.totalConnections++;
      connectionMetrics.activeConnections++;

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connection_established',
        connectionId,
        userId: userData.user_id,
        timestamp: new Date().toISOString(),
        message: 'Connected to Lynxa Pro WebSocket server'
      }));

      // Set up message handler
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          connectionInfo.messageCount++;
          connectionInfo.lastActivity = new Date();
          connectionInfo.bytesTransferred += message.length;
          connectionMetrics.messagesReceived++;
          connectionMetrics.bytesTransferred += message.length;

          await handleWebSocketMessage(connectionInfo, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
            timestamp: new Date().toISOString()
          }));
        }
      });

      // Handle connection close
      ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket disconnected: ${connectionId}, code: ${code}`);
        activeConnections.delete(connectionId);
        connectionMetrics.activeConnections--;
        
        // Log disconnect in database
        logConnectionEvent(userData.user_id, 'disconnect', { code, reason });
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        activeConnections.delete(connectionId);
        connectionMetrics.activeConnections--;
      });

      // Log successful connection
      await logConnectionEvent(userData.user_id, 'connect', { connectionId });

      console.log(`✅ WebSocket connected: ${connectionId} (${userData.email})`);

    } catch (error) {
      console.error('WebSocket connection error:', error);
      ws.close(4000, 'Connection failed');
    }
  });

  // Periodic cleanup and metrics broadcast
  setInterval(() => {
    broadcastSystemMetrics();
    cleanupStaleConnections();
  }, 10000); // Every 10 seconds

  console.log('🚀 WebSocket Server initialized on port', process.env.WS_PORT || 8080);
  return wss;
}

// Handle incoming WebSocket messages
async function handleWebSocketMessage(connectionInfo, data) {
  const { type, payload } = data;
  
  switch (type) {
    case 'ping':
      connectionInfo.ws.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString()
      }));
      break;

    case 'subscribe_metrics':
      // Subscribe to real-time metrics
      connectionInfo.subscriptions = connectionInfo.subscriptions || [];
      if (!connectionInfo.subscriptions.includes('metrics')) {
        connectionInfo.subscriptions.push('metrics');
      }
      break;

    case 'subscribe_usage':
      // Subscribe to usage updates
      connectionInfo.subscriptions = connectionInfo.subscriptions || [];
      if (!connectionInfo.subscriptions.includes('usage')) {
        connectionInfo.subscriptions.push('usage');
      }
      break;

    case 'get_connection_info':
      connectionInfo.ws.send(JSON.stringify({
        type: 'connection_info',
        data: {
          connectionId: connectionInfo.id,
          userId: connectionInfo.userId,
          connectedAt: connectionInfo.connectedAt,
          messageCount: connectionInfo.messageCount,
          bytesTransferred: connectionInfo.bytesTransferred
        },
        timestamp: new Date().toISOString()
      }));
      break;

    default:
      connectionInfo.ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`,
        timestamp: new Date().toISOString()
      }));
  }
}

// Broadcast system metrics to subscribed connections
function broadcastSystemMetrics() {
  const metrics = {
    type: 'system_metrics',
    data: {
      activeConnections: connectionMetrics.activeConnections,
      totalConnections: connectionMetrics.totalConnections,
      messagesSent: connectionMetrics.messagesSent,
      messagesReceived: connectionMetrics.messagesReceived,
      bytesTransferred: connectionMetrics.bytesTransferred,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    },
    timestamp: new Date().toISOString()
  };

  activeConnections.forEach((conn) => {
    if (conn.subscriptions?.includes('metrics') && conn.ws.readyState === 1) {
      try {
        conn.ws.send(JSON.stringify(metrics));
        connectionMetrics.messagesSent++;
      } catch (error) {
        console.error('Failed to send metrics:', error);
      }
    }
  });
}

// Broadcast usage updates to subscribed connections
export function broadcastUsageUpdate(userId, usageData) {
  const message = {
    type: 'usage_update',
    data: usageData,
    timestamp: new Date().toISOString()
  };

  activeConnections.forEach((conn) => {
    if (conn.userId === userId && conn.subscriptions?.includes('usage') && conn.ws.readyState === 1) {
      try {
        conn.ws.send(JSON.stringify(message));
        connectionMetrics.messagesSent++;
      } catch (error) {
        console.error('Failed to send usage update:', error);
      }
    }
  });
}

// Clean up stale connections
function cleanupStaleConnections() {
  const staleTimeout = 5 * 60 * 1000; // 5 minutes
  const now = new Date();

  activeConnections.forEach((conn, id) => {
    if (now - conn.lastActivity > staleTimeout || conn.ws.readyState !== 1) {
      console.log(`🧹 Cleaning up stale connection: ${id}`);
      activeConnections.delete(id);
      connectionMetrics.activeConnections--;
      
      if (conn.ws.readyState === 1) {
        conn.ws.close(4008, 'Connection timeout');
      }
    }
  });
}

// Log connection events to database
async function logConnectionEvent(userId, event, metadata = {}) {
  try {
    const nile = await getNile();
    await nile.db.query(
      `INSERT INTO websocket_logs (user_id, event, metadata, created_at) 
       VALUES ($1, $2, $3, NOW())`,
      [userId, event, JSON.stringify(metadata)]
    );
  } catch (error) {
    console.error('Failed to log WebSocket event:', error);
  }
}

// Export connection metrics for monitoring
export function getConnectionMetrics() {
  return {
    ...connectionMetrics,
    activeConnectionsList: Array.from(activeConnections.values()).map(conn => ({
      id: conn.id,
      userId: conn.userId,
      email: conn.email,
      connectedAt: conn.connectedAt,
      lastActivity: conn.lastActivity,
      messageCount: conn.messageCount,
      bytesTransferred: conn.bytesTransferred
    }))
  };
}

// Initialize WebSocket server if this is the main process
if (process.env.NODE_ENV !== 'test') {
  // In production, this would be a separate service
  // initializeWebSocketServer();
}
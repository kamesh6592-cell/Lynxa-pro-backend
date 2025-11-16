// api/analytics.js - Advanced Analytics & Monitoring Endpoint
import getNile from '../utils/nile.js';
import { getEnv } from '../utils/env.js';

// Validation schema for analytics queries
const analyticsSchema = {
  timeRange: ['1h', '24h', '7d', '30d', '90d'],
  metrics: ['usage', 'users', 'requests', 'errors', 'latency', 'revenue'],
  groupBy: ['hour', 'day', 'week', 'month']
};

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 🔐 Authenticate API Key
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const apiKey = authHeader.substring(7);
  let userData;

  try {
    const nile = await getNile();
    const result = await nile.db.query(
      `SELECT ak.*, u.role, u.organization_id 
       FROM api_keys ak 
       JOIN users u ON ak.user_id = u.id 
       WHERE ak.api_key = $1 AND ak.expires > NOW() AND ak.revoked = FALSE`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired API key' });
    }

    userData = result.rows[0];
    
    // Check permissions for analytics access
    if (!['admin', 'manager'].includes(userData.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for analytics' });
    }
  } catch (err) {
    console.error('Authentication error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }

  // Parse query parameters
  const {
    timeRange = '7d',
    metrics = 'usage,requests',
    groupBy = 'day',
    organizationId = userData.organization_id
  } = req.query;

  // Validate parameters
  if (!analyticsSchema.timeRange.includes(timeRange)) {
    return res.status(400).json({ error: 'Invalid timeRange parameter' });
  }

  if (!analyticsSchema.groupBy.includes(groupBy)) {
    return res.status(400).json({ error: 'Invalid groupBy parameter' });
  }

  try {
    const nile = await getNile();
    const metricsArray = metrics.split(',');
    const analyticsData = {};

    // Calculate time boundaries
    const timeIntervals = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days'
    };

    const interval = timeIntervals[timeRange];
    const groupByFormat = {
      'hour': "DATE_TRUNC('hour', created_at)",
      'day': "DATE_TRUNC('day', created_at)",
      'week': "DATE_TRUNC('week', created_at)",
      'month': "DATE_TRUNC('month', created_at)"
    };

    // Build organization filter
    const orgFilter = userData.role === 'admin' && organizationId 
      ? '' 
      : `AND u.organization_id = '${userData.organization_id}'`;

    // Usage Analytics
    if (metricsArray.includes('usage')) {
      const usageQuery = `
        SELECT 
          ${groupByFormat[groupBy]} as time_bucket,
          COUNT(*) as request_count,
          SUM(input_tokens + output_tokens) as total_tokens,
          AVG(input_tokens + output_tokens) as avg_tokens_per_request,
          COUNT(DISTINCT ak.user_id) as unique_users
        FROM api_logs al
        JOIN api_keys ak ON al.api_key = ak.api_key
        JOIN users u ON ak.user_id = u.id
        WHERE al.created_at >= NOW() - INTERVAL '${interval}' ${orgFilter}
        GROUP BY time_bucket
        ORDER BY time_bucket DESC
        LIMIT 100
      `;

      const usageResult = await nile.db.query(usageQuery);
      analyticsData.usage = usageResult.rows;
    }

    // User Analytics
    if (metricsArray.includes('users')) {
      const userQuery = `
        SELECT 
          ${groupByFormat[groupBy]} as time_bucket,
          COUNT(DISTINCT u.id) as active_users,
          COUNT(DISTINCT CASE WHEN u.created_at >= NOW() - INTERVAL '${interval}' THEN u.id END) as new_users,
          COUNT(DISTINCT CASE WHEN al.created_at >= NOW() - INTERVAL '24 hours' THEN u.id END) as daily_active
        FROM users u
        LEFT JOIN api_keys ak ON u.id = ak.user_id
        LEFT JOIN api_logs al ON ak.api_key = al.api_key
        WHERE u.created_at >= NOW() - INTERVAL '${interval}' ${orgFilter}
        GROUP BY time_bucket
        ORDER BY time_bucket DESC
        LIMIT 100
      `;

      const userResult = await nile.db.query(userQuery);
      analyticsData.users = userResult.rows;
    }

    // Error Analytics
    if (metricsArray.includes('errors')) {
      const errorQuery = `
        SELECT 
          ${groupByFormat[groupBy]} as time_bucket,
          COUNT(*) as error_count,
          COUNT(*) * 100.0 / (
            SELECT COUNT(*) 
            FROM api_logs al2 
            JOIN api_keys ak2 ON al2.api_key = ak2.api_key
            JOIN users u2 ON ak2.user_id = u2.id
            WHERE al2.created_at >= NOW() - INTERVAL '${interval}' ${orgFilter}
          ) as error_rate
        FROM error_logs el
        JOIN users u ON el.user_id = u.id
        WHERE el.created_at >= NOW() - INTERVAL '${interval}' ${orgFilter}
        GROUP BY time_bucket
        ORDER BY time_bucket DESC
        LIMIT 100
      `;

      const errorResult = await nile.db.query(errorQuery);
      analyticsData.errors = errorResult.rows;
    }

    // Revenue Analytics (for admin/billing users)
    if (metricsArray.includes('revenue') && ['admin', 'billing'].includes(userData.role)) {
      const revenueQuery = `
        SELECT 
          ${groupByFormat[groupBy]} as time_bucket,
          SUM(amount) as total_revenue,
          COUNT(*) as transaction_count,
          AVG(amount) as avg_transaction_value,
          COUNT(DISTINCT user_id) as paying_users
        FROM billing_transactions bt
        JOIN users u ON bt.user_id = u.id
        WHERE bt.created_at >= NOW() - INTERVAL '${interval}' 
        AND bt.status = 'completed' ${orgFilter}
        GROUP BY time_bucket
        ORDER BY time_bucket DESC
        LIMIT 100
      `;

      const revenueResult = await nile.db.query(revenueQuery);
      analyticsData.revenue = revenueResult.rows;
    }

    // Real-time System Metrics
    if (metricsArray.includes('system')) {
      analyticsData.system = {
        timestamp: new Date(),
        active_connections: await getActiveConnections(),
        cpu_usage: Math.random() * 100, // Replace with actual system metrics
        memory_usage: Math.random() * 100,
        request_queue_size: Math.floor(Math.random() * 50),
        avg_response_time: Math.floor(Math.random() * 100) + 50
      };
    }

    // Summary Statistics
    const summaryQuery = `
      SELECT 
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT ak.id) as total_api_keys,
        COUNT(DISTINCT CASE WHEN u.plan = 'pro' THEN u.id END) as pro_users,
        COUNT(DISTINCT CASE WHEN u.plan = 'enterprise' THEN u.id END) as enterprise_users,
        SUM(al.input_tokens + al.output_tokens) as total_tokens_processed,
        COUNT(al.id) as total_requests
      FROM users u
      LEFT JOIN api_keys ak ON u.id = ak.user_id
      LEFT JOIN api_logs al ON ak.api_key = al.api_key
      WHERE u.created_at >= NOW() - INTERVAL '${interval}' ${orgFilter}
    `;

    const summaryResult = await nile.db.query(summaryQuery);
    
    res.status(200).json({
      success: true,
      timeRange,
      groupBy,
      organizationId: userData.organization_id,
      requestedMetrics: metricsArray,
      summary: summaryResult.rows[0] || {},
      data: analyticsData,
      generatedAt: new Date().toISOString(),
      requestId: `analytics_${Date.now()}`
    });

  } catch (error) {
    console.error('Analytics query failed:', error);
    res.status(500).json({ 
      error: 'Analytics query failed', 
      details: error.message 
    });
  }
}

// Helper function to get active WebSocket connections
async function getActiveConnections() {
  try {
    // This would integrate with your WebSocket server
    // For now, return a mock value
    return Math.floor(Math.random() * 1000) + 100;
  } catch (error) {
    console.error('Failed to get active connections:', error);
    return 0;
  }
}
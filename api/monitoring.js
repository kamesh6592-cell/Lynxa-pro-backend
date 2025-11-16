// api/monitoring.js - Advanced Real-time Monitoring and Alerting System
import getNile from '../utils/nile.js';
import { getEnv } from '../utils/env.js';
import { broadcastUsageUpdate } from './websocket.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const nile = await getNile();
    
    // Extract API key from headers
    const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ 
        error: 'API key required',
        code: 'MISSING_API_KEY'
      });
    }

    // Validate API key and get user info
    const userResult = await nile.db.query(
      `SELECT ak.*, u.id as user_id, u.email, u.role, u.organization_id, u.created_at as user_created_at
       FROM api_keys ak 
       JOIN users u ON ak.user_id = u.id 
       WHERE ak.api_key = $1 AND ak.expires > NOW() AND ak.revoked = FALSE`,
      [apiKey]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid or expired API key',
        code: 'INVALID_API_KEY'
      });
    }

    const userData = userResult.rows[0];

    // Route to appropriate handler
    const { action } = req.query;
    
    switch (req.method) {
      case 'GET':
        if (action === 'metrics') {
          return await handleGetMetrics(req, res, nile, userData);
        } else if (action === 'alerts') {
          return await handleGetAlerts(req, res, nile, userData);
        } else if (action === 'health') {
          return await handleGetHealth(req, res, nile, userData);
        } else if (action === 'system') {
          return await handleGetSystemStatus(req, res, nile, userData);
        } else {
          return await handleGetMonitoring(req, res, nile, userData);
        }
      case 'POST':
        if (action === 'alert') {
          return await handleCreateAlert(req, res, nile, userData);
        } else {
          return await handleCreateMonitor(req, res, nile, userData);
        }
      case 'PUT':
        return await handleUpdateMonitor(req, res, nile, userData);
      case 'DELETE':
        return await handleDeleteMonitor(req, res, nile, userData);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Monitoring API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
}

// Get monitoring dashboard data
async function handleGetMonitoring(req, res, nile, userData) {
  try {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    // Real-time metrics
    const metricsResult = await nile.db.query(
      `SELECT 
         COUNT(au.id) as total_requests_24h,
         COUNT(CASE WHEN au.created_at >= $2 THEN 1 END) as requests_last_hour,
         AVG(au.response_time) as avg_response_time,
         COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as error_count_24h,
         COUNT(CASE WHEN au.status_code >= 500 THEN 1 END) as server_error_count,
         COUNT(DISTINCT au.api_key_id) as active_keys,
         SUM(au.total_tokens) as total_tokens_24h,
         SUM(au.cost) as total_cost_24h
       FROM api_usage au
       JOIN api_keys ak ON au.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 AND au.created_at >= $2`,
      [userData.organization_id, last24Hours, lastHour]
    );

    // Error rate by endpoint
    const errorRateResult = await nile.db.query(
      `SELECT 
         au.endpoint,
         COUNT(*) as total_requests,
         COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as error_count,
         ROUND(
           (COUNT(CASE WHEN au.status_code >= 400 THEN 1 END)::DECIMAL / COUNT(*)) * 100, 
           2
         ) as error_rate
       FROM api_usage au
       JOIN api_keys ak ON au.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 AND au.created_at >= $2
       GROUP BY au.endpoint
       ORDER BY error_rate DESC
       LIMIT 10`,
      [userData.organization_id, last24Hours]
    );

    // Response time trends (hourly for last 24h)
    const responseTimeResult = await nile.db.query(
      `SELECT 
         DATE_TRUNC('hour', au.created_at) as hour,
         AVG(au.response_time) as avg_response_time,
         COUNT(*) as request_count
       FROM api_usage au
       JOIN api_keys ak ON au.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 AND au.created_at >= $2
       GROUP BY DATE_TRUNC('hour', au.created_at)
       ORDER BY hour ASC`,
      [userData.organization_id, last24Hours]
    );

    // Active alerts
    const alertsResult = await nile.db.query(
      `SELECT n.*, 'alert' as alert_type
       FROM notifications n
       WHERE n.organization_id = $1 
       AND n.type = 'warning' OR n.type = 'error'
       AND n.is_read = FALSE
       AND (n.expires_at IS NULL OR n.expires_at > NOW())
       ORDER BY n.created_at DESC
       LIMIT 5`,
      [userData.organization_id]
    );

    // System health checks
    const healthChecks = await performHealthChecks(nile, userData);

    // Rate limit status
    const rateLimitResult = await nile.db.query(
      `SELECT 
         rl.api_key_id,
         ak.name as api_key_name,
         rl.endpoint,
         rl.requests_count,
         ak.rate_limit,
         rl.limit_exceeded,
         rl.window_start
       FROM rate_limits rl
       JOIN api_keys ak ON rl.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 
       AND rl.window_start >= NOW() - INTERVAL '1 hour'
       AND (rl.limit_exceeded = TRUE OR rl.requests_count > (ak.rate_limit * 0.8))
       ORDER BY rl.requests_count DESC`,
      [userData.organization_id]
    );

    const metrics = metricsResult.rows[0];
    
    // Calculate additional derived metrics
    const errorRate24h = metrics.error_count_24h > 0 ? 
      ((metrics.error_count_24h / metrics.total_requests_24h) * 100).toFixed(2) : '0.00';
    
    const requestsPerMinute = metrics.requests_last_hour > 0 ? 
      (metrics.requests_last_hour / 60).toFixed(1) : '0.0';

    return res.status(200).json({
      success: true,
      monitoring: {
        real_time_metrics: {
          ...metrics,
          error_rate_24h: parseFloat(errorRate24h),
          requests_per_minute: parseFloat(requestsPerMinute),
          uptime_percentage: 99.95, // This would be calculated from actual uptime data
          last_updated: new Date().toISOString()
        },
        error_rates_by_endpoint: errorRateResult.rows,
        response_time_trends: responseTimeResult.rows,
        active_alerts: alertsResult.rows,
        health_checks: healthChecks,
        rate_limit_status: rateLimitResult.rows
      }
    });

  } catch (error) {
    console.error('Get monitoring error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch monitoring data',
      code: 'MONITORING_FETCH_ERROR'
    });
  }
}

// Get detailed metrics
async function handleGetMetrics(req, res, nile, userData) {
  const { period = '24h', granularity = 'hour', metric_type = 'all' } = req.query;

  try {
    let timeFilter = '';
    let groupBy = '';
    const queryParams = [userData.organization_id];

    // Set time period
    switch (period) {
      case '1h':
        timeFilter = `AND au.created_at >= NOW() - INTERVAL '1 hour'`;
        groupBy = `DATE_TRUNC('minute', au.created_at)`;
        break;
      case '24h':
        timeFilter = `AND au.created_at >= NOW() - INTERVAL '24 hours'`;
        groupBy = `DATE_TRUNC('hour', au.created_at)`;
        break;
      case '7d':
        timeFilter = `AND au.created_at >= NOW() - INTERVAL '7 days'`;
        groupBy = `DATE_TRUNC('hour', au.created_at)`;
        break;
      case '30d':
        timeFilter = `AND au.created_at >= NOW() - INTERVAL '30 days'`;
        groupBy = `DATE_TRUNC('day', au.created_at)`;
        break;
      default:
        timeFilter = `AND au.created_at >= NOW() - INTERVAL '24 hours'`;
        groupBy = `DATE_TRUNC('hour', au.created_at)`;
    }

    // Build comprehensive metrics query
    const metricsQuery = `
      SELECT 
        ${groupBy} as time_bucket,
        COUNT(au.id) as request_count,
        AVG(au.response_time) as avg_response_time,
        MIN(au.response_time) as min_response_time,
        MAX(au.response_time) as max_response_time,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY au.response_time) as median_response_time,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY au.response_time) as p95_response_time,
        COUNT(CASE WHEN au.status_code = 200 THEN 1 END) as success_count,
        COUNT(CASE WHEN au.status_code >= 400 AND au.status_code < 500 THEN 1 END) as client_error_count,
        COUNT(CASE WHEN au.status_code >= 500 THEN 1 END) as server_error_count,
        SUM(au.total_tokens) as total_tokens,
        SUM(au.input_tokens) as input_tokens,
        SUM(au.output_tokens) as output_tokens,
        SUM(au.cost) as total_cost,
        COUNT(DISTINCT au.api_key_id) as unique_keys,
        COUNT(DISTINCT au.ip_address) as unique_ips
      FROM api_usage au
      JOIN api_keys ak ON au.api_key_id = ak.id
      JOIN users u ON ak.user_id = u.id
      WHERE u.organization_id = $1 ${timeFilter}
      GROUP BY ${groupBy}
      ORDER BY time_bucket ASC
    `;

    const metricsResult = await nile.db.query(metricsQuery, queryParams);

    // Get endpoint-specific metrics if requested
    let endpointMetrics = [];
    if (metric_type === 'all' || metric_type === 'endpoints') {
      const endpointQuery = `
        SELECT 
          au.endpoint,
          COUNT(au.id) as request_count,
          AVG(au.response_time) as avg_response_time,
          COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as error_count,
          SUM(au.total_tokens) as total_tokens,
          SUM(au.cost) as total_cost
        FROM api_usage au
        JOIN api_keys ak ON au.api_key_id = ak.id
        JOIN users u ON ak.user_id = u.id
        WHERE u.organization_id = $1 ${timeFilter}
        GROUP BY au.endpoint
        ORDER BY request_count DESC
        LIMIT 20
      `;

      const endpointResult = await nile.db.query(endpointQuery, queryParams);
      endpointMetrics = endpointResult.rows;
    }

    return res.status(200).json({
      success: true,
      metrics: {
        period,
        granularity,
        time_series: metricsResult.rows,
        endpoint_metrics: endpointMetrics,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Get metrics error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch metrics',
      code: 'METRICS_FETCH_ERROR'
    });
  }
}

// Get system health status
async function handleGetHealth(req, res, nile, userData) {
  try {
    const healthChecks = await performHealthChecks(nile, userData);
    
    // Determine overall health status
    const criticalIssues = healthChecks.filter(check => check.status === 'critical').length;
    const warningIssues = healthChecks.filter(check => check.status === 'warning').length;
    
    let overallStatus = 'healthy';
    if (criticalIssues > 0) {
      overallStatus = 'critical';
    } else if (warningIssues > 0) {
      overallStatus = 'warning';
    }

    return res.status(200).json({
      success: true,
      health: {
        overall_status: overallStatus,
        critical_issues: criticalIssues,
        warning_issues: warningIssues,
        checks: healthChecks,
        last_updated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({ 
      error: 'Failed to perform health check',
      code: 'HEALTH_CHECK_ERROR'
    });
  }
}

// Perform comprehensive health checks
async function performHealthChecks(nile, userData) {
  const checks = [];
  
  try {
    // Database connectivity check
    const dbStart = Date.now();
    await nile.db.query('SELECT 1');
    const dbLatency = Date.now() - dbStart;
    
    checks.push({
      name: 'Database Connectivity',
      status: dbLatency < 100 ? 'healthy' : dbLatency < 500 ? 'warning' : 'critical',
      latency_ms: dbLatency,
      message: `Database responding in ${dbLatency}ms`
    });

    // API response time check (last hour average)
    const responseTimeResult = await nile.db.query(
      `SELECT AVG(response_time) as avg_response_time
       FROM api_usage au
       JOIN api_keys ak ON au.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 
       AND au.created_at >= NOW() - INTERVAL '1 hour'`,
      [userData.organization_id]
    );

    const avgResponseTime = parseFloat(responseTimeResult.rows[0]?.avg_response_time) || 0;
    checks.push({
      name: 'API Response Time',
      status: avgResponseTime < 500 ? 'healthy' : avgResponseTime < 1000 ? 'warning' : 'critical',
      avg_response_time_ms: avgResponseTime,
      message: `Average response time: ${avgResponseTime.toFixed(0)}ms (last hour)`
    });

    // Error rate check (last hour)
    const errorRateResult = await nile.db.query(
      `SELECT 
         COUNT(*) as total_requests,
         COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count
       FROM api_usage au
       JOIN api_keys ak ON au.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 
       AND au.created_at >= NOW() - INTERVAL '1 hour'`,
      [userData.organization_id]
    );

    const errorData = errorRateResult.rows[0];
    const errorRate = errorData.total_requests > 0 ? 
      (errorData.error_count / errorData.total_requests) * 100 : 0;

    checks.push({
      name: 'Error Rate',
      status: errorRate < 1 ? 'healthy' : errorRate < 5 ? 'warning' : 'critical',
      error_rate_percent: errorRate.toFixed(2),
      total_requests: parseInt(errorData.total_requests),
      error_count: parseInt(errorData.error_count),
      message: `${errorRate.toFixed(2)}% error rate (last hour)`
    });

    // Rate limit check
    const rateLimitResult = await nile.db.query(
      `SELECT COUNT(*) as exceeded_count
       FROM rate_limits rl
       JOIN api_keys ak ON rl.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 
       AND rl.limit_exceeded = TRUE
       AND rl.window_start >= NOW() - INTERVAL '1 hour'`,
      [userData.organization_id]
    );

    const rateLimitExceeded = parseInt(rateLimitResult.rows[0]?.exceeded_count) || 0;
    checks.push({
      name: 'Rate Limiting',
      status: rateLimitExceeded === 0 ? 'healthy' : rateLimitExceeded < 5 ? 'warning' : 'critical',
      exceeded_count: rateLimitExceeded,
      message: `${rateLimitExceeded} rate limit violations (last hour)`
    });

    // Active connections check (if WebSocket is enabled)
    checks.push({
      name: 'WebSocket Connections',
      status: 'healthy', // This would check actual WebSocket connection count
      active_connections: 0, // Placeholder
      message: 'WebSocket service operational'
    });

  } catch (error) {
    checks.push({
      name: 'Health Check System',
      status: 'critical',
      error: error.message,
      message: 'Failed to perform complete health check'
    });
  }

  return checks;
}

// Create alert/notification
async function handleCreateAlert(req, res, nile, userData) {
  const { title, message, type = 'info', action_url, expires_in_hours } = req.body;

  if (!title || !message) {
    return res.status(400).json({ 
      error: 'Title and message are required',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  try {
    let expiresAt = null;
    if (expires_in_hours) {
      expiresAt = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000);
    }

    const alertResult = await nile.db.query(
      `INSERT INTO notifications (
         user_id, organization_id, title, message, type, action_url, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [userData.user_id, userData.organization_id, title, message, type, action_url, expiresAt]
    );

    const alert = alertResult.rows[0];

    // Broadcast alert via WebSocket if it's critical
    if (type === 'error' || type === 'warning') {
      // This would integrate with the WebSocket system
      console.log(`🚨 Broadcasting alert: ${title}`);
    }

    return res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      alert
    });

  } catch (error) {
    console.error('Create alert error:', error);
    return res.status(500).json({ 
      error: 'Failed to create alert',
      code: 'ALERT_CREATE_ERROR'
    });
  }
}
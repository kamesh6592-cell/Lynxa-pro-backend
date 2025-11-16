// api/organizations.js - Advanced Organization Management for Enterprise Features
import getNile from '../utils/nile.js';
import { getEnv } from '../utils/env.js';

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

    switch (req.method) {
      case 'GET':
        return await handleGetOrganizations(req, res, nile, userData);
      case 'POST':
        return await handleCreateOrganization(req, res, nile, userData);
      case 'PUT':
        return await handleUpdateOrganization(req, res, nile, userData);
      case 'DELETE':
        return await handleDeleteOrganization(req, res, nile, userData);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Organizations API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
}

// Get organizations
async function handleGetOrganizations(req, res, nile, userData) {
  const { org_id, include_stats, include_members } = req.query;

  try {
    if (org_id) {
      // Get specific organization
      const orgResult = await nile.db.query(
        `SELECT o.*, 
                COUNT(DISTINCT u.id) as member_count,
                COUNT(DISTINCT ak.id) as api_key_count,
                SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '30 days' THEN au.requests ELSE 0 END) as monthly_requests
         FROM organizations o
         LEFT JOIN users u ON o.id = u.organization_id
         LEFT JOIN api_keys ak ON u.id = ak.user_id AND ak.revoked = FALSE
         LEFT JOIN api_usage au ON ak.id = au.api_key_id
         WHERE o.id = $1 AND (o.id = $2 OR $3 = 'admin' OR $3 = 'super_admin')
         GROUP BY o.id`,
        [org_id, userData.organization_id, userData.role]
      );

      if (orgResult.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Organization not found or access denied',
          code: 'ORG_NOT_FOUND'
        });
      }

      const organization = orgResult.rows[0];

      // Include members if requested
      if (include_members === 'true') {
        const membersResult = await nile.db.query(
          `SELECT u.id, u.email, u.role, u.created_at, u.last_active,
                  COUNT(ak.id) as api_key_count,
                  SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '30 days' THEN au.requests ELSE 0 END) as monthly_requests
           FROM users u
           LEFT JOIN api_keys ak ON u.id = ak.user_id AND ak.revoked = FALSE
           LEFT JOIN api_usage au ON ak.id = au.api_key_id
           WHERE u.organization_id = $1
           GROUP BY u.id, u.email, u.role, u.created_at, u.last_active
           ORDER BY u.created_at DESC`,
          [org_id]
        );
        
        organization.members = membersResult.rows;
      }

      // Include detailed stats if requested
      if (include_stats === 'true') {
        const statsResult = await nile.db.query(
          `SELECT 
             COUNT(DISTINCT u.id) as total_members,
             COUNT(DISTINCT ak.id) as total_api_keys,
             SUM(au.requests) as total_requests,
             SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '1 day' THEN au.requests ELSE 0 END) as daily_requests,
             SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '7 days' THEN au.requests ELSE 0 END) as weekly_requests,
             SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '30 days' THEN au.requests ELSE 0 END) as monthly_requests,
             AVG(au.response_time) as avg_response_time,
             COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as error_count
           FROM organizations o
           LEFT JOIN users u ON o.id = u.organization_id
           LEFT JOIN api_keys ak ON u.id = ak.user_id AND ak.revoked = FALSE
           LEFT JOIN api_usage au ON ak.id = au.api_key_id
           WHERE o.id = $1`,
          [org_id]
        );

        organization.detailed_stats = statsResult.rows[0];
      }

      return res.status(200).json({
        success: true,
        organization
      });

    } else {
      // Get user's organizations (list view)
      let query = `
        SELECT o.*, 
               COUNT(DISTINCT u.id) as member_count,
               COUNT(DISTINCT ak.id) as api_key_count,
               SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '30 days' THEN au.requests ELSE 0 END) as monthly_requests
        FROM organizations o
        LEFT JOIN users u ON o.id = u.organization_id
        LEFT JOIN api_keys ak ON u.id = ak.user_id AND ak.revoked = FALSE
        LEFT JOIN api_usage au ON ak.id = au.api_key_id
      `;
      
      const queryParams = [];
      
      if (userData.role === 'admin' || userData.role === 'super_admin') {
        // Admins can see all organizations
        query += ` GROUP BY o.id ORDER BY o.created_at DESC`;
      } else {
        // Regular users can only see their organization
        query += ` WHERE o.id = $1 GROUP BY o.id`;
        queryParams.push(userData.organization_id);
      }

      const orgsResult = await nile.db.query(query, queryParams);

      return res.status(200).json({
        success: true,
        organizations: orgsResult.rows
      });
    }

  } catch (error) {
    console.error('Get organizations error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch organizations',
      code: 'FETCH_ERROR'
    });
  }
}

// Create new organization
async function handleCreateOrganization(req, res, nile, userData) {
  // Only admins can create organizations
  if (userData.role !== 'admin' && userData.role !== 'super_admin') {
    return res.status(403).json({ 
      error: 'Insufficient permissions to create organizations',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
  }

  const { name, description, plan = 'free', settings = {} } = req.body;

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ 
      error: 'Organization name is required',
      code: 'MISSING_NAME'
    });
  }

  try {
    // Check if organization name already exists
    const existingResult = await nile.db.query(
      'SELECT id FROM organizations WHERE LOWER(name) = LOWER($1)',
      [name.trim()]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Organization name already exists',
        code: 'NAME_EXISTS'
      });
    }

    // Create organization
    const orgResult = await nile.db.query(
      `INSERT INTO organizations (name, description, plan, settings, created_by, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) 
       RETURNING *`,
      [name.trim(), description || null, plan, JSON.stringify(settings), userData.user_id]
    );

    const organization = orgResult.rows[0];

    // Log organization creation
    await nile.db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'create', 'organization', $3, $4, NOW())`,
      [
        userData.user_id,
        organization.id,
        organization.id,
        JSON.stringify({ name, plan, created_by: userData.email })
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Organization created successfully',
      organization
    });

  } catch (error) {
    console.error('Create organization error:', error);
    return res.status(500).json({ 
      error: 'Failed to create organization',
      code: 'CREATE_ERROR'
    });
  }
}

// Update organization
async function handleUpdateOrganization(req, res, nile, userData) {
  const { org_id } = req.query;
  const { name, description, plan, settings } = req.body;

  if (!org_id) {
    return res.status(400).json({ 
      error: 'Organization ID is required',
      code: 'MISSING_ORG_ID'
    });
  }

  try {
    // Check permissions
    const orgResult = await nile.db.query(
      'SELECT * FROM organizations WHERE id = $1',
      [org_id]
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Organization not found',
        code: 'ORG_NOT_FOUND'
      });
    }

    const organization = orgResult.rows[0];

    // Check if user can update this organization
    if (userData.organization_id !== org_id && userData.role !== 'admin' && userData.role !== 'super_admin') {
      return res.status(403).json({ 
        error: 'Insufficient permissions to update this organization',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name && name.trim().length > 0) {
      updates.push(`name = $${paramCount++}`);
      values.push(name.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (plan) {
      updates.push(`plan = $${paramCount++}`);
      values.push(plan);
    }

    if (settings) {
      updates.push(`settings = $${paramCount++}`);
      values.push(JSON.stringify(settings));
    }

    if (updates.length === 0) {
      return res.status(400).json({ 
        error: 'No valid fields to update',
        code: 'NO_UPDATES'
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(org_id);

    const updateResult = await nile.db.query(
      `UPDATE organizations SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    const updatedOrganization = updateResult.rows[0];

    // Log organization update
    await nile.db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'update', 'organization', $3, $4, NOW())`,
      [
        userData.user_id,
        org_id,
        org_id,
        JSON.stringify({ 
          updated_fields: Object.keys(req.body),
          updated_by: userData.email 
        })
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Organization updated successfully',
      organization: updatedOrganization
    });

  } catch (error) {
    console.error('Update organization error:', error);
    return res.status(500).json({ 
      error: 'Failed to update organization',
      code: 'UPDATE_ERROR'
    });
  }
}

// Delete organization
async function handleDeleteOrganization(req, res, nile, userData) {
  const { org_id } = req.query;

  if (!org_id) {
    return res.status(400).json({ 
      error: 'Organization ID is required',
      code: 'MISSING_ORG_ID'
    });
  }

  // Only super admins can delete organizations
  if (userData.role !== 'super_admin') {
    return res.status(403).json({ 
      error: 'Only super administrators can delete organizations',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
  }

  try {
    // Check if organization exists
    const orgResult = await nile.db.query(
      'SELECT * FROM organizations WHERE id = $1',
      [org_id]
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Organization not found',
        code: 'ORG_NOT_FOUND'
      });
    }

    const organization = orgResult.rows[0];

    // Check if organization has active members
    const membersResult = await nile.db.query(
      'SELECT COUNT(*) as member_count FROM users WHERE organization_id = $1',
      [org_id]
    );

    if (parseInt(membersResult.rows[0].member_count) > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete organization with active members',
        code: 'HAS_MEMBERS',
        member_count: parseInt(membersResult.rows[0].member_count)
      });
    }

    // Delete organization
    await nile.db.query('DELETE FROM organizations WHERE id = $1', [org_id]);

    // Log organization deletion
    await nile.db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'delete', 'organization', $3, $4, NOW())`,
      [
        userData.user_id,
        null, // Organization no longer exists
        org_id,
        JSON.stringify({ 
          deleted_organization: organization.name,
          deleted_by: userData.email 
        })
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Organization deleted successfully'
    });

  } catch (error) {
    console.error('Delete organization error:', error);
    return res.status(500).json({ 
      error: 'Failed to delete organization',
      code: 'DELETE_ERROR'
    });
  }
}
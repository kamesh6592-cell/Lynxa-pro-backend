// api/users.js - Advanced User Management for Enterprise Platform
import getNile from '../utils/nile.js';
import { getEnv } from '../utils/env.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

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
        return await handleGetUsers(req, res, nile, userData);
      case 'POST':
        return await handleCreateUser(req, res, nile, userData);
      case 'PUT':
        return await handleUpdateUser(req, res, nile, userData);
      case 'DELETE':
        return await handleDeleteUser(req, res, nile, userData);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Users API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
}

// Get users
async function handleGetUsers(req, res, nile, userData) {
  const { user_id, include_stats, include_keys, organization_id, role, search } = req.query;

  try {
    if (user_id) {
      // Get specific user
      const canAccess = 
        user_id === userData.user_id || // Own profile
        userData.role === 'admin' || 
        userData.role === 'super_admin' ||
        (userData.role === 'org_admin' && await userBelongsToOrganization(nile, user_id, userData.organization_id));

      if (!canAccess) {
        return res.status(403).json({ 
          error: 'Insufficient permissions to access this user',
          code: 'ACCESS_DENIED'
        });
      }

      const userQuery = `
        SELECT u.id, u.email, u.role, u.organization_id, u.first_name, u.last_name,
               u.avatar_url, u.created_at, u.updated_at, u.last_active, u.is_active,
               u.email_verified, u.two_factor_enabled, u.preferences,
               o.name as organization_name, o.plan as organization_plan,
               COUNT(DISTINCT ak.id) as api_key_count,
               COUNT(DISTINCT CASE WHEN ak.revoked = FALSE THEN ak.id END) as active_api_key_count
        FROM users u
        LEFT JOIN organizations o ON u.organization_id = o.id
        LEFT JOIN api_keys ak ON u.id = ak.user_id
        WHERE u.id = $1
        GROUP BY u.id, u.email, u.role, u.organization_id, u.first_name, u.last_name,
                 u.avatar_url, u.created_at, u.updated_at, u.last_active, u.is_active,
                 u.email_verified, u.two_factor_enabled, u.preferences,
                 o.name, o.plan
      `;

      const result = await nile.db.query(userQuery, [user_id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      const user = result.rows[0];

      // Include API keys if requested and authorized
      if (include_keys === 'true' && (user_id === userData.user_id || userData.role === 'admin' || userData.role === 'super_admin')) {
        const keysResult = await nile.db.query(
          `SELECT id, name, api_key, created_at, expires, last_used, revoked, rate_limit
           FROM api_keys 
           WHERE user_id = $1 
           ORDER BY created_at DESC`,
          [user_id]
        );
        
        // Mask API keys for security (show only last 8 characters)
        user.api_keys = keysResult.rows.map(key => ({
          ...key,
          api_key: `****-****-****-${key.api_key.slice(-8)}`
        }));
      }

      // Include usage stats if requested
      if (include_stats === 'true') {
        const statsResult = await nile.db.query(
          `SELECT 
             COUNT(au.id) as total_requests,
             SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '1 day' THEN au.requests ELSE 0 END) as daily_requests,
             SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '7 days' THEN au.requests ELSE 0 END) as weekly_requests,
             SUM(CASE WHEN au.created_at >= NOW() - INTERVAL '30 days' THEN au.requests ELSE 0 END) as monthly_requests,
             AVG(au.response_time) as avg_response_time,
             COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as error_count,
             MAX(au.created_at) as last_request_at
           FROM api_keys ak
           LEFT JOIN api_usage au ON ak.id = au.api_key_id
           WHERE ak.user_id = $1`,
          [user_id]
        );

        user.usage_stats = statsResult.rows[0];
      }

      return res.status(200).json({
        success: true,
        user
      });

    } else {
      // Get users list (with filters)
      let whereConditions = [];
      let queryParams = [];
      let paramCount = 1;

      // Base query
      let query = `
        SELECT u.id, u.email, u.role, u.organization_id, u.first_name, u.last_name,
               u.avatar_url, u.created_at, u.updated_at, u.last_active, u.is_active,
               u.email_verified, u.two_factor_enabled,
               o.name as organization_name, o.plan as organization_plan,
               COUNT(DISTINCT ak.id) as api_key_count,
               COUNT(DISTINCT CASE WHEN ak.revoked = FALSE THEN ak.id END) as active_api_key_count
        FROM users u
        LEFT JOIN organizations o ON u.organization_id = o.id
        LEFT JOIN api_keys ak ON u.id = ak.user_id
      `;

      // Apply access control based on role
      if (userData.role === 'super_admin') {
        // Super admin can see all users
      } else if (userData.role === 'admin') {
        // Admin can see all users in their organization
        whereConditions.push(`u.organization_id = $${paramCount++}`);
        queryParams.push(userData.organization_id);
      } else if (userData.role === 'org_admin') {
        // Org admin can see users in their organization
        whereConditions.push(`u.organization_id = $${paramCount++}`);
        queryParams.push(userData.organization_id);
      } else {
        // Regular user can only see their own profile
        whereConditions.push(`u.id = $${paramCount++}`);
        queryParams.push(userData.user_id);
      }

      // Apply filters
      if (organization_id && (userData.role === 'admin' || userData.role === 'super_admin')) {
        whereConditions.push(`u.organization_id = $${paramCount++}`);
        queryParams.push(organization_id);
      }

      if (role) {
        whereConditions.push(`u.role = $${paramCount++}`);
        queryParams.push(role);
      }

      if (search) {
        whereConditions.push(`(u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount++})`);
        queryParams.push(`%${search}%`);
      }

      // Build final query
      if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
      }

      query += `
        GROUP BY u.id, u.email, u.role, u.organization_id, u.first_name, u.last_name,
                 u.avatar_url, u.created_at, u.updated_at, u.last_active, u.is_active,
                 u.email_verified, u.two_factor_enabled, o.name, o.plan
        ORDER BY u.created_at DESC
        LIMIT 100
      `;

      const result = await nile.db.query(query, queryParams);

      return res.status(200).json({
        success: true,
        users: result.rows,
        total: result.rows.length
      });
    }

  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch users',
      code: 'FETCH_ERROR'
    });
  }
}

// Create new user
async function handleCreateUser(req, res, nile, userData) {
  // Only admins can create users
  if (userData.role !== 'admin' && userData.role !== 'super_admin' && userData.role !== 'org_admin') {
    return res.status(403).json({ 
      error: 'Insufficient permissions to create users',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
  }

  const { 
    email, 
    password, 
    role = 'user', 
    organization_id, 
    first_name, 
    last_name,
    send_welcome_email = true
  } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      error: 'Invalid email format',
      code: 'INVALID_EMAIL'
    });
  }

  // Password validation
  if (password.length < 8) {
    return res.status(400).json({ 
      error: 'Password must be at least 8 characters long',
      code: 'WEAK_PASSWORD'
    });
  }

  try {
    // Check if user already exists
    const existingResult = await nile.db.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({ 
        error: 'User with this email already exists',
        code: 'EMAIL_EXISTS'
      });
    }

    // Determine organization
    let targetOrgId = organization_id;
    if (!targetOrgId) {
      if (userData.role === 'super_admin') {
        // Super admin can create users without organization
      } else {
        // Use creator's organization
        targetOrgId = userData.organization_id;
      }
    }

    // Validate organization access
    if (targetOrgId && userData.role !== 'super_admin') {
      if (userData.organization_id !== targetOrgId) {
        return res.status(403).json({ 
          error: 'Cannot create users in different organization',
          code: 'ORG_ACCESS_DENIED'
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    // Create user
    const userResult = await nile.db.query(
      `INSERT INTO users (
         email, password_hash, role, organization_id, first_name, last_name,
         email_verification_token, created_at, updated_at, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), true) 
       RETURNING id, email, role, organization_id, first_name, last_name, created_at`,
      [email, hashedPassword, role, targetOrgId, first_name, last_name, emailVerificationToken]
    );

    const newUser = userResult.rows[0];

    // Generate initial API key for the user
    const apiKey = `lynx_${crypto.randomBytes(16).toString('hex')}_${Date.now()}`;
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1); // 1 year expiry

    await nile.db.query(
      `INSERT INTO api_keys (user_id, api_key, name, expires, created_at) 
       VALUES ($1, $2, $3, $4, NOW())`,
      [newUser.id, apiKey, 'Default API Key', expires]
    );

    // Log user creation
    await nile.db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'create', 'user', $3, $4, NOW())`,
      [
        userData.user_id,
        targetOrgId,
        newUser.id,
        JSON.stringify({ 
          created_email: email,
          created_role: role,
          created_by: userData.email,
          initial_api_key: true
        })
      ]
    );

    // TODO: Send welcome email if requested
    if (send_welcome_email) {
      // Integration with email service would go here
      console.log(`Welcome email queued for ${email} with verification token ${emailVerificationToken}`);
    }

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        ...newUser,
        initial_api_key: apiKey
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    return res.status(500).json({ 
      error: 'Failed to create user',
      code: 'CREATE_ERROR'
    });
  }
}

// Update user
async function handleUpdateUser(req, res, nile, userData) {
  const { user_id } = req.query;
  const { role, organization_id, first_name, last_name, is_active, preferences } = req.body;

  if (!user_id) {
    return res.status(400).json({ 
      error: 'User ID is required',
      code: 'MISSING_USER_ID'
    });
  }

  try {
    // Check permissions
    const canUpdate = 
      user_id === userData.user_id || // Own profile (limited fields)
      userData.role === 'admin' || 
      userData.role === 'super_admin' ||
      (userData.role === 'org_admin' && await userBelongsToOrganization(nile, user_id, userData.organization_id));

    if (!canUpdate) {
      return res.status(403).json({ 
        error: 'Insufficient permissions to update this user',
        code: 'UPDATE_DENIED'
      });
    }

    // Get current user data
    const currentUserResult = await nile.db.query(
      'SELECT * FROM users WHERE id = $1',
      [user_id]
    );

    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    const currentUser = currentUserResult.rows[0];

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Regular users can only update their own profile fields
    if (user_id === userData.user_id) {
      if (first_name !== undefined) {
        updates.push(`first_name = $${paramCount++}`);
        values.push(first_name);
      }
      if (last_name !== undefined) {
        updates.push(`last_name = $${paramCount++}`);
        values.push(last_name);
      }
      if (preferences !== undefined) {
        updates.push(`preferences = $${paramCount++}`);
        values.push(JSON.stringify(preferences));
      }
    } else {
      // Admins can update all fields
      if (first_name !== undefined) {
        updates.push(`first_name = $${paramCount++}`);
        values.push(first_name);
      }
      if (last_name !== undefined) {
        updates.push(`last_name = $${paramCount++}`);
        values.push(last_name);
      }
      if (role !== undefined && (userData.role === 'admin' || userData.role === 'super_admin')) {
        updates.push(`role = $${paramCount++}`);
        values.push(role);
      }
      if (organization_id !== undefined && userData.role === 'super_admin') {
        updates.push(`organization_id = $${paramCount++}`);
        values.push(organization_id);
      }
      if (is_active !== undefined && (userData.role === 'admin' || userData.role === 'super_admin')) {
        updates.push(`is_active = $${paramCount++}`);
        values.push(is_active);
      }
      if (preferences !== undefined) {
        updates.push(`preferences = $${paramCount++}`);
        values.push(JSON.stringify(preferences));
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ 
        error: 'No valid fields to update',
        code: 'NO_UPDATES'
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(user_id);

    const updateResult = await nile.db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} 
       RETURNING id, email, role, organization_id, first_name, last_name, 
                 avatar_url, created_at, updated_at, last_active, is_active,
                 email_verified, two_factor_enabled`,
      values
    );

    const updatedUser = updateResult.rows[0];

    // Log user update
    await nile.db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'update', 'user', $3, $4, NOW())`,
      [
        userData.user_id,
        updatedUser.organization_id,
        user_id,
        JSON.stringify({ 
          updated_fields: Object.keys(req.body),
          updated_by: userData.email,
          target_user: currentUser.email
        })
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ 
      error: 'Failed to update user',
      code: 'UPDATE_ERROR'
    });
  }
}

// Delete user
async function handleDeleteUser(req, res, nile, userData) {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ 
      error: 'User ID is required',
      code: 'MISSING_USER_ID'
    });
  }

  // Only admins can delete users, and users cannot delete themselves
  if (userData.role !== 'admin' && userData.role !== 'super_admin') {
    return res.status(403).json({ 
      error: 'Insufficient permissions to delete users',
      code: 'DELETE_DENIED'
    });
  }

  if (user_id === userData.user_id) {
    return res.status(409).json({ 
      error: 'Cannot delete your own account',
      code: 'SELF_DELETE_DENIED'
    });
  }

  try {
    // Get user data
    const userResult = await nile.db.query(
      'SELECT * FROM users WHERE id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    const targetUser = userResult.rows[0];

    // Check organization access for non-super-admins
    if (userData.role === 'admin' && targetUser.organization_id !== userData.organization_id) {
      return res.status(403).json({ 
        error: 'Cannot delete users from different organization',
        code: 'ORG_DELETE_DENIED'
      });
    }

    // Soft delete: deactivate user and revoke all API keys
    await nile.db.query(
      'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [user_id]
    );

    await nile.db.query(
      'UPDATE api_keys SET revoked = TRUE WHERE user_id = $1',
      [user_id]
    );

    // Log user deletion
    await nile.db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'delete', 'user', $3, $4, NOW())`,
      [
        userData.user_id,
        targetUser.organization_id,
        user_id,
        JSON.stringify({ 
          deleted_email: targetUser.email,
          deleted_role: targetUser.role,
          deleted_by: userData.email,
          soft_delete: true
        })
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully (soft delete - account deactivated)'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ 
      error: 'Failed to delete user',
      code: 'DELETE_ERROR'
    });
  }
}

// Helper function to check if user belongs to organization
async function userBelongsToOrganization(nile, userId, organizationId) {
  try {
    const result = await nile.db.query(
      'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
      [userId, organizationId]
    );
    return result.rows.length > 0;
  } catch (error) {
    return false;
  }
}
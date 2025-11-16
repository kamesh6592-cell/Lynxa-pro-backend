// api/billing.js - Advanced Billing and Subscription Management
import getNile from '../utils/nile.js';
import { getEnv } from '../utils/env.js';
import Stripe from 'stripe';

// Initialize Stripe (in production, this would use actual Stripe keys)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key', {
  apiVersion: '2023-10-16',
});

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
      `SELECT ak.*, u.id as user_id, u.email, u.role, u.organization_id, u.created_at as user_created_at,
              o.name as organization_name, o.plan as organization_plan, o.stripe_customer_id
       FROM api_keys ak 
       JOIN users u ON ak.user_id = u.id 
       LEFT JOIN organizations o ON u.organization_id = o.id
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
        if (action === 'subscription') {
          return await handleGetSubscription(req, res, nile, userData);
        } else if (action === 'invoices') {
          return await handleGetInvoices(req, res, nile, userData);
        } else if (action === 'usage') {
          return await handleGetUsage(req, res, nile, userData);
        } else {
          return await handleGetBilling(req, res, nile, userData);
        }
      case 'POST':
        if (action === 'create-subscription') {
          return await handleCreateSubscription(req, res, nile, userData);
        } else if (action === 'create-checkout') {
          return await handleCreateCheckout(req, res, nile, userData);
        } else if (action === 'webhook') {
          return await handleStripeWebhook(req, res, nile);
        } else {
          return await handleCreateBilling(req, res, nile, userData);
        }
      case 'PUT':
        return await handleUpdateSubscription(req, res, nile, userData);
      case 'DELETE':
        return await handleCancelSubscription(req, res, nile, userData);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Billing API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
}

// Get billing overview
async function handleGetBilling(req, res, nile, userData) {
  try {
    // Get current subscription info
    const subscriptionResult = await nile.db.query(
      `SELECT s.*, p.name as plan_name, p.price, p.billing_interval, p.features
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.organization_id = $1 AND s.status = 'active'
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userData.organization_id]
    );

    // Get current month usage
    const usageResult = await nile.db.query(
      `SELECT 
         COUNT(au.id) as total_requests,
         SUM(au.requests) as total_api_calls,
         AVG(au.response_time) as avg_response_time,
         COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as error_count,
         COUNT(DISTINCT au.api_key_id) as active_keys
       FROM api_usage au
       JOIN api_keys ak ON au.api_key_id = ak.id
       JOIN users u ON ak.user_id = u.id
       WHERE u.organization_id = $1 
       AND au.created_at >= DATE_TRUNC('month', NOW())`,
      [userData.organization_id]
    );

    // Get billing history (invoices)
    const invoicesResult = await nile.db.query(
      `SELECT invoice_id, amount, currency, status, created_at, paid_at, invoice_url
       FROM invoices 
       WHERE organization_id = $1 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [userData.organization_id]
    );

    // Get plan limits and pricing
    const plansResult = await nile.db.query(
      `SELECT id, name, price, billing_interval, features, limits, is_active
       FROM plans 
       WHERE is_active = true
       ORDER BY price ASC`
    );

    const currentSubscription = subscriptionResult.rows[0] || null;
    const currentUsage = usageResult.rows[0];
    const recentInvoices = invoicesResult.rows;
    const availablePlans = plansResult.rows;

    return res.status(200).json({
      success: true,
      billing: {
        current_subscription: currentSubscription,
        current_usage: currentUsage,
        recent_invoices: recentInvoices,
        available_plans: availablePlans,
        organization: {
          id: userData.organization_id,
          name: userData.organization_name,
          plan: userData.organization_plan,
          stripe_customer_id: userData.stripe_customer_id
        }
      }
    });

  } catch (error) {
    console.error('Get billing error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch billing information',
      code: 'BILLING_FETCH_ERROR'
    });
  }
}

// Get subscription details
async function handleGetSubscription(req, res, nile, userData) {
  try {
    const subscriptionResult = await nile.db.query(
      `SELECT s.*, p.name as plan_name, p.price, p.billing_interval, p.features, p.limits
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.organization_id = $1 
       ORDER BY s.created_at DESC`,
      [userData.organization_id]
    );

    const subscriptions = subscriptionResult.rows;
    const activeSubscription = subscriptions.find(s => s.status === 'active');

    // If there's a Stripe subscription, get additional details
    if (activeSubscription && activeSubscription.stripe_subscription_id) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(activeSubscription.stripe_subscription_id);
        activeSubscription.stripe_details = {
          current_period_start: new Date(stripeSubscription.current_period_start * 1000),
          current_period_end: new Date(stripeSubscription.current_period_end * 1000),
          cancel_at_period_end: stripeSubscription.cancel_at_period_end,
          canceled_at: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : null
        };
      } catch (stripeError) {
        console.warn('Failed to fetch Stripe subscription details:', stripeError.message);
      }
    }

    return res.status(200).json({
      success: true,
      subscription: activeSubscription,
      all_subscriptions: subscriptions
    });

  } catch (error) {
    console.error('Get subscription error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch subscription',
      code: 'SUBSCRIPTION_FETCH_ERROR'
    });
  }
}

// Get usage details
async function handleGetUsage(req, res, nile, userData) {
  const { period = 'current_month', limit = 100 } = req.query;

  try {
    let dateFilter = '';
    const queryParams = [userData.organization_id];

    switch (period) {
      case 'current_month':
        dateFilter = `AND au.created_at >= DATE_TRUNC('month', NOW())`;
        break;
      case 'last_month':
        dateFilter = `AND au.created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' 
                     AND au.created_at < DATE_TRUNC('month', NOW())`;
        break;
      case 'last_7_days':
        dateFilter = `AND au.created_at >= NOW() - INTERVAL '7 days'`;
        break;
      case 'last_30_days':
        dateFilter = `AND au.created_at >= NOW() - INTERVAL '30 days'`;
        break;
      default:
        dateFilter = `AND au.created_at >= NOW() - INTERVAL '30 days'`;
    }

    // Get detailed usage data
    const usageQuery = `
      SELECT 
        DATE(au.created_at) as date,
        COUNT(au.id) as total_requests,
        SUM(au.requests) as api_calls,
        AVG(au.response_time) as avg_response_time,
        COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as errors,
        COUNT(CASE WHEN au.status_code = 200 THEN 1 END) as successful_calls,
        SUM(CASE WHEN au.endpoint LIKE '%/chat%' THEN au.requests ELSE 0 END) as chat_requests,
        SUM(CASE WHEN au.endpoint LIKE '%/completion%' THEN au.requests ELSE 0 END) as completion_requests,
        COUNT(DISTINCT au.api_key_id) as unique_keys_used
      FROM api_usage au
      JOIN api_keys ak ON au.api_key_id = ak.id
      JOIN users u ON ak.user_id = u.id
      WHERE u.organization_id = $1 ${dateFilter}
      GROUP BY DATE(au.created_at)
      ORDER BY date DESC
      LIMIT $2
    `;

    queryParams.push(parseInt(limit));
    const usageResult = await nile.db.query(usageQuery, queryParams);

    // Get top endpoints
    const endpointsQuery = `
      SELECT 
        au.endpoint,
        COUNT(au.id) as request_count,
        SUM(au.requests) as total_calls,
        AVG(au.response_time) as avg_response_time,
        COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as error_count
      FROM api_usage au
      JOIN api_keys ak ON au.api_key_id = ak.id
      JOIN users u ON ak.user_id = u.id
      WHERE u.organization_id = $1 ${dateFilter}
      GROUP BY au.endpoint
      ORDER BY total_calls DESC
      LIMIT 10
    `;

    const endpointsResult = await nile.db.query(endpointsQuery, [userData.organization_id]);

    // Get usage summary
    const summaryQuery = `
      SELECT 
        COUNT(au.id) as total_requests,
        SUM(au.requests) as total_api_calls,
        AVG(au.response_time) as avg_response_time,
        COUNT(CASE WHEN au.status_code >= 400 THEN 1 END) as total_errors,
        COUNT(DISTINCT au.api_key_id) as unique_keys,
        COUNT(DISTINCT DATE(au.created_at)) as active_days
      FROM api_usage au
      JOIN api_keys ak ON au.api_key_id = ak.id
      JOIN users u ON ak.user_id = u.id
      WHERE u.organization_id = $1 ${dateFilter}
    `;

    const summaryResult = await nile.db.query(summaryQuery, [userData.organization_id]);

    return res.status(200).json({
      success: true,
      usage: {
        period,
        summary: summaryResult.rows[0],
        daily_usage: usageResult.rows,
        top_endpoints: endpointsResult.rows
      }
    });

  } catch (error) {
    console.error('Get usage error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch usage data',
      code: 'USAGE_FETCH_ERROR'
    });
  }
}

// Create checkout session
async function handleCreateCheckout(req, res, nile, userData) {
  const { plan_id, success_url, cancel_url } = req.body;

  if (!plan_id) {
    return res.status(400).json({ 
      error: 'Plan ID is required',
      code: 'MISSING_PLAN_ID'
    });
  }

  try {
    // Get plan details
    const planResult = await nile.db.query(
      'SELECT * FROM plans WHERE id = $1 AND is_active = true',
      [plan_id]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Plan not found',
        code: 'PLAN_NOT_FOUND'
      });
    }

    const plan = planResult.rows[0];

    // Create or get Stripe customer
    let customerId = userData.stripe_customer_id;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.email,
        name: userData.organization_name,
        metadata: {
          organization_id: userData.organization_id,
          user_id: userData.user_id
        }
      });

      customerId = customer.id;

      // Update organization with Stripe customer ID
      await nile.db.query(
        'UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, userData.organization_id]
      );
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan.name,
            description: plan.description || `${plan.name} plan for Lynxa Pro AI API`
          },
          unit_amount: Math.round(plan.price * 100), // Convert to cents
          recurring: {
            interval: plan.billing_interval
          }
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: success_url || `${req.headers.origin || 'https://nexariq.com'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${req.headers.origin || 'https://nexariq.com'}/billing`,
      metadata: {
        organization_id: userData.organization_id,
        plan_id: plan_id,
        user_id: userData.user_id
      }
    });

    // Log checkout session creation
    await nile.db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'create_checkout', 'subscription', $3, $4, NOW())`,
      [
        userData.user_id,
        userData.organization_id,
        plan_id,
        JSON.stringify({ 
          plan_name: plan.name,
          session_id: session.id,
          amount: plan.price
        })
      ]
    );

    return res.status(200).json({
      success: true,
      checkout_url: session.url,
      session_id: session.id
    });

  } catch (error) {
    console.error('Create checkout error:', error);
    return res.status(500).json({ 
      error: 'Failed to create checkout session',
      code: 'CHECKOUT_ERROR'
    });
  }
}

// Handle Stripe webhook
async function handleStripeWebhook(req, res, nile) {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object, nile);
        break;
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object, nile);
        break;
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, nile);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object, nile);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

// Handle successful checkout
async function handleCheckoutCompleted(session, nile) {
  const { organization_id, plan_id, user_id } = session.metadata;

  try {
    // Get subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(session.subscription);

    // Create subscription record
    await nile.db.query(
      `INSERT INTO subscriptions (
         organization_id, plan_id, stripe_subscription_id, stripe_customer_id,
         status, current_period_start, current_period_end, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        organization_id,
        plan_id,
        subscription.id,
        session.customer,
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000)
      ]
    );

    // Update organization plan
    await nile.db.query(
      'UPDATE organizations SET plan = (SELECT name FROM plans WHERE id = $1) WHERE id = $2',
      [plan_id, organization_id]
    );

    console.log(`✅ Subscription created for organization ${organization_id}`);

  } catch (error) {
    console.error('Failed to handle checkout completion:', error);
  }
}

// Handle successful payment
async function handlePaymentSucceeded(invoice, nile) {
  try {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const organizationId = subscription.metadata.organization_id;

    // Record invoice
    await nile.db.query(
      `INSERT INTO invoices (
         organization_id, invoice_id, amount, currency, status,
         created_at, paid_at, invoice_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (invoice_id) DO UPDATE SET
         status = $5, paid_at = $7`,
      [
        organizationId,
        invoice.id,
        invoice.amount_paid / 100, // Convert from cents
        invoice.currency,
        'paid',
        new Date(invoice.created * 1000),
        new Date(invoice.status_transitions.paid_at * 1000),
        invoice.hosted_invoice_url
      ]
    );

    console.log(`✅ Payment recorded for invoice ${invoice.id}`);

  } catch (error) {
    console.error('Failed to handle payment success:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(invoice, nile) {
  try {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const organizationId = subscription.metadata.organization_id;

    // Record failed invoice
    await nile.db.query(
      `INSERT INTO invoices (
         organization_id, invoice_id, amount, currency, status,
         created_at, invoice_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (invoice_id) DO UPDATE SET status = $5`,
      [
        organizationId,
        invoice.id,
        invoice.amount_due / 100,
        invoice.currency,
        'payment_failed',
        new Date(invoice.created * 1000),
        invoice.hosted_invoice_url
      ]
    );

    console.log(`❌ Payment failed for invoice ${invoice.id}`);

  } catch (error) {
    console.error('Failed to handle payment failure:', error);
  }
}

// Handle subscription cancellation
async function handleSubscriptionCanceled(subscription, nile) {
  try {
    // Update subscription status
    await nile.db.query(
      'UPDATE subscriptions SET status = $1, canceled_at = NOW() WHERE stripe_subscription_id = $2',
      ['canceled', subscription.id]
    );

    // Revert organization to free plan
    const organizationId = subscription.metadata.organization_id;
    if (organizationId) {
      await nile.db.query(
        'UPDATE organizations SET plan = $1 WHERE id = $2',
        ['free', organizationId]
      );
    }

    console.log(`❌ Subscription canceled: ${subscription.id}`);

  } catch (error) {
    console.error('Failed to handle subscription cancellation:', error);
  }
}
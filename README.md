# Lynxa Pro Backend - Enterprise AI API Platform

[![Deploy Status](https://img.shields.io/badge/status-production-green)](https://lynxa-pro-backend.vercel.app)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)](https://github.com/kamesh6592-cell/Lynxa-pro-backend)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

## 🚀 Enterprise-Grade AI Backend Platform

A comprehensive, scalable backend infrastructure for AI API services with advanced enterprise features including multi-tenant architecture, real-time monitoring, billing integration, and comprehensive analytics.

### ✨ Key Features

#### 🏗️ **Architecture & Infrastructure**
- **Multi-tenant Architecture**: Complete organization isolation and management
- **Serverless Deployment**: Optimized for Vercel with edge computing support
- **Advanced Database Schema**: PostgreSQL with optimized indexes and triggers
- **Real-time Communication**: WebSocket support for live monitoring and notifications

#### 🔐 **Security & Authentication**
- **JWT-based Authentication**: Secure token-based user authentication
- **Role-based Access Control (RBAC)**: Granular permissions system
- **API Key Management**: Advanced key generation, rotation, and revocation
- **Rate Limiting**: Intelligent throttling with configurable limits
- **IP Whitelisting**: Enhanced security for API key usage

#### 📊 **Analytics & Monitoring**
- **Real-time Metrics**: Live performance and usage tracking
- **Advanced Analytics**: Comprehensive usage patterns and insights
- **Error Monitoring**: Automated error detection and alerting
- **Response Time Analysis**: Performance optimization insights
- **System Health Checks**: Automated uptime and performance monitoring

#### 💰 **Billing & Subscriptions**
- **Stripe Integration**: Full payment processing and subscription management
- **Usage-based Billing**: Accurate tracking and cost calculation
- **Multiple Plan Tiers**: Free, Pro, and Enterprise subscription options
- **Invoice Management**: Automated billing and invoice generation
- **Cost Analytics**: Detailed breakdown of API usage costs

#### 🏢 **Enterprise Features**
- **Organization Management**: Complete multi-org support with isolation
- **User Management**: Advanced user roles and permissions
- **Audit Logging**: Comprehensive activity tracking for compliance
- **Webhook Integration**: Event-driven integrations and notifications
- **Feature Flags**: Controlled feature rollouts and A/B testing

### 🛠️ **Technical Stack**

- **Runtime**: Node.js 20 with ES Modules
- **Database**: PostgreSQL with NileDB integration
- **Authentication**: JWT + bcrypt password hashing
- **Billing**: Stripe API integration
- **WebSockets**: Real-time communication support
- **Rate Limiting**: Redis-backed intelligent throttling
- **Monitoring**: Custom analytics with health checks
- **Deployment**: Vercel serverless functions

### 📡 **API Endpoints**

#### Core AI Services
```
POST   /api/lynxa                    # AI chat completion endpoint
GET    /api/health                  # Service health status
GET    /api/info                    # API information
```

#### Authentication & Keys
```
POST   /api/generate-key            # Generate new API key
DELETE /api/revoke-key              # Revoke API key
GET    /api/user/keys               # List user's API keys
```

#### Analytics & Monitoring
```
GET    /api/analytics               # Usage analytics
GET    /api/monitoring              # Real-time monitoring
GET    /api/monitoring?action=metrics    # Detailed metrics
GET    /api/monitoring?action=health     # Health checks
```

#### User & Organization Management
```
GET    /api/users                   # List users
POST   /api/users                   # Create user
PUT    /api/users                   # Update user
DELETE /api/users                   # Delete user

GET    /api/organizations           # List organizations
POST   /api/organizations           # Create organization
PUT    /api/organizations           # Update organization
DELETE /api/organizations           # Delete organization
```

#### Billing & Subscriptions
```
GET    /api/billing                 # Billing overview
POST   /api/billing?action=create-checkout  # Create checkout session
GET    /api/billing?action=subscription     # Subscription details
POST   /api/billing?action=webhook         # Stripe webhook handler
```

### 🧪 **API Testing Guide**

#### 1. Health Check
```bash
curl -X GET "https://lynxa-pro-backend.vercel.app/api/health"
```

#### 2. API Information
```bash
curl -X GET "https://lynxa-pro-backend.vercel.app/api/info"
```

#### 3. Generate API Key
```bash
curl -X POST "https://lynxa-pro-backend.vercel.app/api/keys/generate" \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@example.com"}'
```
**Response:**
```json
{
  "success": true,
  "key": "nxq_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "expires": "2026-12-12T13:18:01.529Z",
  "tier": "free"
}
```

#### 4. Test AI Chat (Lynxa Pro)
```bash
# Replace YOUR_API_KEY with the key from step 3
curl -X POST "https://lynxa-pro-backend.vercel.app/api/lynxa" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello, who are you?"}
    ],
    "model": "lynxa-pro",
    "max_tokens": 150
  }'
```

#### 5. Advanced AI Conversation
```bash
curl -X POST "https://lynxa-pro-backend.vercel.app/api/lynxa" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "messages": [
      {"role": "user", "content": "What can you help me with?"}
    ],
    "model": "lynxa-pro",
    "max_tokens": 300,
    "temperature": 0.7
  }'
```

#### 6. Streaming Response
```bash
curl -X POST "https://lynxa-pro-backend.vercel.app/api/lynxa" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "messages": [
      {"role": "user", "content": "Tell me about artificial intelligence"}
    ],
    "model": "lynxa-pro",
    "stream": true
  }'
```

#### 7. PowerShell Testing (Windows)
```powershell
# Generate API Key
$response = Invoke-RestMethod -Uri "https://lynxa-pro-backend.vercel.app/api/keys/generate" `
  -Method POST -ContentType "application/json" `
  -Body '{"email": "your-email@example.com"}'
$apiKey = $response.key

# Test AI Chat
Invoke-RestMethod -Uri "https://lynxa-pro-backend.vercel.app/api/lynxa" `
  -Method POST -ContentType "application/json" `
  -Headers @{"Authorization" = "Bearer $apiKey"} `
  -Body '{
    "messages": [{"role": "user", "content": "Hello Lynxa!"}],
    "model": "lynxa-pro"
  }'
```

#### Expected Response Format
```json
{
  "id": "msg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "object": "chat.completion",
  "model": "lynxa-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm Lynxa Pro, an advanced AI assistant developed by Nexariq, a sub-brand of AJ STUDIOZ..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 50,
    "total_tokens": 75
  },
  "developer": "Nexariq - AJ STUDIOZ"
}
```

#### WebSocket & Real-time
```
GET    /api/websocket               # WebSocket connection info
WS     wss://api.domain.com/ws      # WebSocket endpoint
```

### 🏗️ **Database Schema**

The platform uses a comprehensive PostgreSQL schema with the following key tables:

- **organizations**: Multi-tenant organization management
- **users**: User profiles with role-based access
- **api_keys**: Secure API key management
- **subscriptions**: Stripe subscription tracking
- **api_usage**: Detailed usage analytics
- **rate_limits**: Advanced rate limiting
- **audit_logs**: Comprehensive activity logging
- **notifications**: System alerts and messages
- **webhooks**: Event-driven integrations

### 🚦 **Rate Limiting**

Advanced rate limiting system with multiple tiers:

- **Free Plan**: 1,000 requests/hour
- **Pro Plan**: 10,000 requests/hour
- **Enterprise Plan**: Unlimited requests
- **Custom Plans**: Configurable limits

### 📈 **Monitoring & Health Checks**

Comprehensive monitoring system including:

- **Database Connectivity**: Sub-100ms response time monitoring
- **API Performance**: Average response time tracking
- **Error Rates**: Automated error detection and alerting
- **Rate Limit Status**: Usage pattern analysis
- **WebSocket Health**: Real-time connection monitoring

### 🔧 **Environment Configuration**

Required environment variables:

```env
# Database
DATABASE_URL=postgresql://username:password@host:port/database
NILE_DATABASE_URL=postgresql://username:password@host:port/database

# Authentication
JWT_SECRET=your-jwt-secret-key

# Stripe (Billing)
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_WEBHOOK_SECRET=whsec_webhook_secret

# WebSocket
WS_PORT=8080

# Email (Optional)
RESEND_API_KEY=re_your_resend_key
NODEMAILER_CONFIG={"host":"smtp.example.com","port":587}

# Redis (Optional for advanced rate limiting)
REDIS_URL=redis://localhost:6379
```

### 🚀 **Deployment**

The platform is optimized for Vercel deployment:

1. **Clone the repository**
```bash
git clone https://github.com/kamesh6592-cell/Lynxa-pro-backend.git
cd Lynxa-pro-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

4. **Deploy to Vercel**
```bash
vercel --prod
```

### 📊 **Usage Analytics**

The platform provides comprehensive analytics including:

- **Request Volume**: Real-time and historical request tracking
- **Response Times**: Performance monitoring and optimization insights
- **Error Rates**: Automated error detection and trend analysis
- **Token Usage**: AI model usage and cost tracking
- **User Activity**: Usage patterns and engagement metrics
- **Billing Analytics**: Revenue tracking and subscription insights

### 🔄 **WebSocket Real-time Features**

Real-time capabilities for enhanced user experience:

- **Live Usage Monitoring**: Real-time request and performance metrics
- **System Alerts**: Instant notifications for critical events
- **Collaborative Features**: Multi-user dashboard synchronization
- **Health Status**: Live system health and uptime monitoring

### 🏢 **Enterprise Support**

Advanced enterprise features:

- **Single Sign-On (SSO)**: SAML/OAuth integration ready
- **Custom Integrations**: Webhook and API customization
- **Dedicated Support**: Priority technical support
- **SLA Guarantees**: 99.9% uptime commitment
- **Compliance**: SOC2, GDPR, HIPAA compliance ready
- **White-label Options**: Custom branding and domains

### 📄 **API Documentation**

Comprehensive API documentation available at:
- **Production**: https://lynxa-pro-backend.vercel.app/docs
- **Postman Collection**: [Available in repository](./docs/postman_collection.json)
- **OpenAPI Spec**: [Available in repository](./docs/openapi.yaml)

### 🤝 **Contributing**

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### 📜 **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### 🆘 **Support**

- **Documentation**: [docs.nexariq.com](https://docs.nexariq.com)
- **Email Support**: support@nexariq.com
- **Discord Community**: [Join our Discord](https://discord.gg/nexariq)
- **GitHub Issues**: [Report bugs and request features](https://github.com/kamesh6592-cell/Lynxa-pro-backend/issues)

---

**Made with ❤️ by [AJ STUDIOZ](https://nexariq.com) - Nexariq Team**

*Powering the next generation of AI applications with enterprise-grade infrastructure.*
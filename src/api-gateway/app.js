const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();

app.use(cors());
// app.use(express.json());
app.use((req, res, next) => {
    console.log(`📨 ${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

const PORT = 3000;

// Service mapping
const services = {
    'user-service': 'http://user-service:8080',
    'email-service': 'http://email-service:8081',
    'service-registry': 'http://service-registry:8761'
};

console.log('🔧 Services configured:', services);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Enhanced Version',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'api-gateway' });
});

// Enhanced proxy with timeout and better error handling
const createServiceProxy = (serviceName, pathRewrite = {}) => {
    return createProxyMiddleware({
        target: services[serviceName],
        changeOrigin: true,
        pathRewrite: pathRewrite,
        timeout: 10000, // 10 second timeout
        proxyTimeout: 10000,
        onProxyReq: (proxyReq, req, res) => {
            console.log(`➡️  GATEWAY: ${req.method} ${req.originalUrl} → ${serviceName}`);
        },
        onProxyRes: (proxyRes, req, res) => {
            console.log(`⬅️  GATEWAY: ${proxyRes.statusCode} from ${serviceName} for ${req.method} ${req.originalUrl}`);
        },
        onError: (err, req, res) => {
            console.error(`❌ GATEWAY ERROR for ${serviceName}:`, err.message);
            res.status(502).json({
                error: `${serviceName} unavailable`,
                message: 'Service is not responding',
                timestamp: new Date().toISOString()
            });
        }
    });
};

// Route definitions
app.use('/auth', createServiceProxy('user-service', {'^/auth': ''}));
app.use('/registry', createServiceProxy('service-registry', {'^/registry': ''}));
app.use('/emails', createServiceProxy('email-service', {'^/emails': ''}));

// Test endpoint to verify gateway is working
app.get('/gateway-test', (req, res) => {
    res.json({ 
        message: 'Gateway is working',
        test: 'This proves the gateway can respond to requests',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 API Gateway running on http://localhost:${PORT}`);
    console.log('📡 Available routes:');
    console.log('   /auth/* → User Service');
    console.log('   /registry/* → Service Registry');
    console.log('   /emails/* → Email Service');
    console.log('   /gateway-test → Gateway test endpoint');
});
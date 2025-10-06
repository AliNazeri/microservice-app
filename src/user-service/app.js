const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const client = require('prom-client');

const app = express();
app.use(express.json());

const PORT = 8080;
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://admin:password@localhost:27017/userdb?authSource=admin';
const SERVICE_REGISTRY_URL = process.env.SERVICE_REGISTRY_URL || 'http://service-registry:8761';

// Prometheus Metrics - CORRECTED VERSION
const register = new client.Registry();

// Collect default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.1, 5, 15, 50, 100, 500]
});
register.registerMetric(httpRequestDurationMicroseconds);

const userRegistrationsTotal = new client.Counter({
  name: 'user_registrations_total',
  help: 'Total number of user registrations',
  labelNames: ['status']
});
register.registerMetric(userRegistrationsTotal);

const activeUsersGauge = new client.Gauge({
  name: 'active_users_count',
  help: 'Current number of active users'
});
register.registerMetric(activeUsersGauge);

// MongoDB Connection
const connectMongoDB = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(MONGODB_URL);
      console.log('✅ MongoDB connected successfully');
      return true;
    } catch (error) {
      console.log(`❌ MongoDB connection failed (${retries} retries left):`, error.message);
      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  console.log('⚠️  Starting without MongoDB');
  return false;
};

// Service Registry Registration
const registerWithRegistry = async () => {
  let retries = 5;
  
  while (retries > 0) {
    try {
      console.log(`🔄 Attempting to register with service registry (${retries} retries left)...`);
      
      const serviceUrl = `http://user-service:8080`;
      
      const response = await axios.post(`${SERVICE_REGISTRY_URL}/register`, {
        serviceName: 'user-service',
        serviceUrl: serviceUrl
      });
      
      console.log(`✅ Successfully registered with service registry at ${serviceUrl}`);
      return;
      
    } catch (error) {
      console.log(`❌ Registration failed - ${error.message}`);
      retries--;
      
      if (retries > 0) {
        console.log(`⏳ Retrying in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  
  console.log(`⚠️ Could not register with service registry after retries`);
};

// Simple in-memory storage
let users = [];
let nextId = 1;

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error);
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  
  // Update metrics
  activeUsersGauge.set(users.length);
  
  res.json({
    status: 'healthy',
    service: 'user-service',
    database: dbConnected ? 'connected' : 'disconnected',
    metrics: '/metrics',
    timestamp: new Date().toISOString()
  });
});

// Registration endpoint with metrics
app.post('/register', (req, res) => {
  const start = Date.now();
  const { name, email } = req.body;
  
  console.log('✅ REGISTER:', { name, email });
  
  try {
    if (!name || !email) {
      userRegistrationsTotal.inc({ status: 'validation_error' });
      httpRequestDurationMicroseconds
        .labels(req.method, '/register', 400)
        .observe(Date.now() - start);
      
      return res.status(400).json({
        status: 'error',
        message: 'Name and email are required'
      });
    }
    
    const user = {
      id: nextId++,
      name,
      email,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    
    // Update metrics
    userRegistrationsTotal.inc({ status: 'success' });
    activeUsersGauge.set(users.length);
    httpRequestDurationMicroseconds
      .labels(req.method, '/register', 200)
      .observe(Date.now() - start);
    
    res.json({
      status: 'success',
      message: 'User registered',
      user: user
    });
    
  } catch (error) {
    userRegistrationsTotal.inc({ status: 'error' });
    httpRequestDurationMicroseconds
      .labels(req.method, '/register', 500)
      .observe(Date.now() - start);
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get users with metrics
app.get('/users', (req, res) => {
  const start = Date.now();
  
  try {
    httpRequestDurationMicroseconds
      .labels(req.method, '/users', 200)
      .observe(Date.now() - start);
    
    res.json({
      status: 'success',
      data: users,
      count: users.length
    });
  } catch (error) {
    httpRequestDurationMicroseconds
      .labels(req.method, '/users', 500)
      .observe(Date.now() - start);
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'User Service - WITH WORKING MONITORING',
    endpoints: ['/health', '/register', '/users', '/metrics'],
    timestamp: new Date().toISOString()
  });
});

// Start server
const startServer = async () => {
  console.log('🚀 Starting User Service with Working Monitoring...');
  
  await connectMongoDB();
  await registerWithRegistry();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ User Service running on http://0.0.0.0:${PORT}`);
    console.log(`📊 Metrics available at http://localhost:${PORT}/metrics`);
  });
};

startServer();
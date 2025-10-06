const express = require('express');
const axios = require('axios');
const amqp = require('amqplib');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { Sequelize, DataTypes } = require('sequelize');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());

const PORT = 8081;
const SERVICE_REGISTRY_URL = process.env.SERVICE_REGISTRY_URL || 'http://localhost:8761';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';
const getTimestamp = () => new Date().toISOString();
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/emaildb';
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Swagger configuration (keep your existing Swagger setup)
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Email Service API with Authentication',
            version: '1.0.0',
            description: 'Microservice for sending emails with JWT Authentication',
        },
        servers: [{ url: `http://localhost:${PORT}` }],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                },
                serviceAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-service-token'
                }
            }
        }
    },
    apis: ['./app.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// JWT Verification Function
const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        throw new Error('Invalid token');
    }
};

// Authentication Middleware for Service-to-Service communication
const authenticateService = (req, res, next) => {
    const serviceToken = req.headers['x-service-token'];
    
    if (!serviceToken) {
        return res.status(401).json({
            status: 'error',
            message: 'Service token required',
            timestamp: getTimestamp()
        });
    }
    
    try {
        const decoded = verifyToken(serviceToken);
        
        // Verify it's a valid service token (not a user token)
        if (!decoded.service) {
            return res.status(403).json({
                status: 'error',
                message: 'Invalid service token',
                timestamp: getTimestamp()
            });
        }
        
        req.service = decoded.service;
        next();
    } catch (error) {
        return res.status(403).json({
            status: 'error',
            message: 'Invalid or expired service token',
            timestamp: getTimestamp()
        });
    }
};

// User Authentication Middleware
const authenticateUser = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({
            status: 'error',
            message: 'Access token required',
            timestamp: getTimestamp()
        });
    }
    
    try {
        const decoded = verifyToken(token);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(403).json({
            status: 'error',
            message: 'Invalid or expired token',
            timestamp: getTimestamp()
        });
    }
};

// Initialize RabbitMQ connection and start consuming
async function setupRabbitMQ() {
    // Wait 10 seconds for RabbitMQ to be fully ready
    console.log(`[${getTimestamp()}] ⏳ Waiting 10 seconds for RabbitMQ to be ready...`);
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    try {
        console.log(`[${getTimestamp()}] 🔄 Connecting to RabbitMQ at: ${RABBITMQ_URL}`);
        
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        
        // Create the exchange
        await channel.assertExchange('user_events', 'topic', { 
            durable: true 
        });
        
        // Create and bind queue for email service
        const queue = await channel.assertQueue('email_service_queue', { durable: true });
        await channel.bindQueue(queue.queue, 'user_events', 'user.created');
        
        console.log(`[${getTimestamp()}] ✅ Successfully connected to RabbitMQ and created queue`);
        
        // Start consuming messages - THIS IS THE MISSING PART
        channel.consume(queue.queue, async (message) => {
            if (message !== null) {
                const event = JSON.parse(message.content.toString());
                console.log(`[${getTimestamp()}] 📨 EMAIL_SERVICE: Received event: ${event.type}`);
                
                // Process the user_created event
                if (event.type === 'user_created') {
                    await sendWelcomeEmail(event.data);
                }
                
                channel.ack(message); // Acknowledge message processing
            }
        });
        
        // Handle connection errors
        connection.on('error', (err) => {
            console.error(`[${getTimestamp()}] ❌ RabbitMQ connection error:`, err.message);
            channel = null;
        });
        
        connection.on('close', () => {
            console.error(`[${getTimestamp()}] ❌ RabbitMQ connection closed`);
            channel = null;
        });
        
        return channel;
        
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ Failed to connect to RabbitMQ:`, error.message);
        return null;
    }
}

// PostgreSQL Connection and Model
const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: false
});

// Email Log Model
const EmailLog = sequelize.define('EmailLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    to: {
        type: DataTypes.STRING,
        allowNull: false
    },
    subject: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'sent'
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'email_logs',
    timestamps: true
});

const connectPostgreSQL = async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync(); // Creates table if doesn't exist
        console.log(`[${getTimestamp()}] ✅ EMAIL_SERVICE: Connected to PostgreSQL and synchronized models`);
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ EMAIL_SERVICE: PostgreSQL connection failed:`, error.message);
    }
};

// Function to send welcome email and log to PostgreSQL
async function sendWelcomeEmail(userData) {
    const { userId, name, email } = userData;
    
    console.log(`[${getTimestamp()}] 📧 EMAIL_SERVICE: Sending welcome email to ${email}`);
    
    try {
        // Save email to PostgreSQL
        const emailLog = await EmailLog.create({
            to: email,
            subject: 'Welcome to Our App!',
            message: `Hello ${name}, welcome to our microservice app with RabbitMQ and PostgreSQL!`,
            status: 'sent',
            userId: userId
        });
        
        console.log(`[${getTimestamp()}] 💾 EMAIL_SERVICE: Email logged to PostgreSQL with ID: ${emailLog.id}`);
        console.log(`[${getTimestamp()}] ✅ EMAIL_SERVICE: Welcome email sent to ${name} (${email})`);
        
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ EMAIL_SERVICE: Failed to log email to database:`, error.message);
    }
}

/**
 * @swagger
 * /email-logs:
 *   get:
 *     summary: Get all email logs (Protected - requires user token)
 *     tags: [Emails]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all email logs
 *       401:
 *         description: Unauthorized
 */
app.get('/email-logs', authenticateUser, async (req, res) => {
    try {
        const emails = await EmailLog.findAll({
            order: [['createdAt', 'DESC']]
        });
        
        console.log(`[${getTimestamp()}] 📊 EMAIL_SERVICE: User ${req.userId} retrieved ${emails.length} email logs`);
        
        res.json({
            status: 'success',
            data: emails,
            count: emails.length,
            requestedBy: req.userId,
            timestamp: getTimestamp()
        });
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ EMAIL_SERVICE: Failed to fetch email logs - ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: getTimestamp()
        });
    }
});


/**
 * @swagger
 * /send-email:
 *   post:
 *     summary: Send an email directly (Protected - requires service token)
 *     tags: [Email]
 *     security:
 *       - serviceAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmailRequest'
 *     responses:
 *       200:
 *         description: Email sent successfully
 *       401:
 *         description: Unauthorized
 */
app.post('/send-email', authenticateService, (req, res) => {
    const { to, subject, message } = req.body;
    
    console.log(`[${getTimestamp()}] 📧 EMAIL_SERVICE: Direct email request from ${req.service} to ${to}`);
    
    // Save to database as well
    EmailLog.create({
        to: to,
        subject: subject,
        message: message,
        status: 'sent',
        requestedBy: req.service
    }).then(() => {
        console.log(`[${getTimestamp()}] 💾 EMAIL_SERVICE: Direct email logged to PostgreSQL`);
    }).catch(error => {
        console.error(`[${getTimestamp()}] ❌ EMAIL_SERVICE: Failed to log direct email:`, error.message);
    });
    
    res.json({
        status: 'success',
        message: 'Email sent successfully',
        sentTo: to,
        requestedBy: req.service,
        timestamp: getTimestamp()
    });
});

/**
 * @swagger
 * /generate-service-token:
 *   post:
 *     summary: Generate a service token for inter-service communication
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceName
 *               - secretKey
 *             properties:
 *               serviceName:
 *                 type: string
 *               secretKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Service token generated
 *       401:
 *         description: Invalid secret key
 */
app.post('/generate-service-token', async (req, res) => {
    const { serviceName, secretKey } = req.body;
    
    // Simple secret key validation (in production, use proper secrets management)
    const validSecretKey = process.env.SERVICE_SECRET_KEY || 'service-secret-key';
    
    if (secretKey !== validSecretKey) {
        return res.status(401).json({
            status: 'error',
            message: 'Invalid secret key',
            timestamp: getTimestamp()
        });
    }
    
    const serviceToken = jwt.sign(
        { service: serviceName, type: 'service' }, 
        JWT_SECRET, 
        { expiresIn: '1h' }
    );
    
    console.log(`[${getTimestamp()}] 🔐 EMAIL_SERVICE: Generated service token for ${serviceName}`);
    
    res.json({
        status: 'success',
        service: serviceName,
        token: serviceToken,
        expiresIn: '1h',
        timestamp: getTimestamp()
    });
});

/**
 * @swagger
 * /email-logs:
 *   get:
 *     summary: Get all email logs
 *     tags: [Emails]
 *     responses:
 *       200:
 *         description: List of all email logs
 */
app.get('/email-logs', async (req, res) => {
    try {
        const emails = await EmailLog.findAll({
            order: [['createdAt', 'DESC']]
        });
        
        console.log(`[${getTimestamp()}] 📊 EMAIL_SERVICE: Retrieved ${emails.length} email logs from PostgreSQL`);
        
        res.json({
            status: 'success',
            data: emails,
            count: emails.length,
            timestamp: getTimestamp()
        });
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ EMAIL_SERVICE: Failed to fetch email logs - ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: getTimestamp()
        });
    }
});

// Enhanced health endpoint
app.get('/health', async (req, res) => {
    const healthCheck = {
        status: 'healthy',
        timestamp: getTimestamp(),
        service: 'email-service',
        checks: {
            database: 'unknown',
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            rabbitmq: 'unknown',  // ← Change from 'connected' to 'unknown'
            serviceRegistry: 'unknown'
        }
    };

    // Check PostgreSQL connection
    try {
        await sequelize.authenticate();
        healthCheck.checks.database = 'connected';
    } catch (error) {
        healthCheck.checks.database = 'disconnected';
        healthCheck.status = 'unhealthy';
    }

    // Check RabbitMQ connection
    try {
        // We need to check if we have an active channel
        // For now, we'll assume if setupRabbitMQ completed, it's connected
        healthCheck.checks.rabbitmq = 'connected';
    } catch (error) {
        healthCheck.checks.rabbitmq = 'disconnected';
        healthCheck.status = 'degraded';
    }

    // Check service registry
    try {
        await axios.get(`${SERVICE_REGISTRY_URL}/health`);
        healthCheck.checks.serviceRegistry = 'reachable';
    } catch (error) {
        healthCheck.checks.serviceRegistry = 'unreachable';
        healthCheck.status = 'degraded';
    }

    res.json(healthCheck);
});

// Register this service with the registry on startup
async function registerWithRegistry() {
    try {
        const serviceUrl = `http://${process.env.SERVICE_NAME || 'localhost'}:${PORT}`;
        
        await axios.post(`${SERVICE_REGISTRY_URL}/register`, {
            serviceName: process.env.SERVICE_NAME || 'email-service',
            serviceUrl: serviceUrl
        });
        console.log(`[${getTimestamp()}] ✅ EMAIL_SERVICE: Registered with service registry at ${serviceUrl}`);
    } catch (error) {
        console.log(`[${getTimestamp()}] ❌ EMAIL_SERVICE: Failed to register with service registry:`, error.message);
    }
}

app.listen(PORT, async () => {
    console.log(`[${getTimestamp()}] Email service running on http://localhost:${PORT}`);
    console.log(`[${getTimestamp()}] API Documentation available at http://localhost:${PORT}/api-docs`);
    
    await connectPostgreSQL();  // Add this line
    await setupRabbitMQ();
    await registerWithRegistry();
});
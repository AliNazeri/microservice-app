const express = require('express');
const app = express();

app.use(express.json());

const PORT = 8761;
const services = {}; // Simple in-memory service registry

// Register a service
app.post('/register', (req, res) => {
    const { serviceName, serviceUrl } = req.body;
    
    console.log(`📝 Registering service: ${serviceName} at ${serviceUrl}`);
    services[serviceName] = serviceUrl;
    
    res.json({ 
        status: 'success', 
        message: `${serviceName} registered successfully`,
        registeredServices: Object.keys(services)
    });
});

// Get service URL by name
app.get('/services/:serviceName', (req, res) => {
    const { serviceName } = req.params;
    const serviceUrl = services[serviceName];
    
    if (serviceUrl) {
        res.json({ serviceName, serviceUrl });
    } else {
        res.status(404).json({ error: 'Service not found' });
    }
});

// List all registered services
app.get('/services', (req, res) => {
    res.json({ services });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'service-registry',
        registeredServices: Object.keys(services).length
    });
});

app.listen(PORT, () => {
    console.log(`Service Registry running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log('  POST /register - Register a service');
    console.log('  GET /services/:name - Get service URL');
    console.log('  GET /services - List all services');
});
import express, { Application } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

import policyRoutes from './routes/policy.route';
import returnRoutes from './routes/return.route';
import inspectionRoutes from './routes/inspection.route';
import refundRoutes from './routes/refund.route';
import exchangeRoutes from './routes/exchange.route';

const app: Application = express();
const PORT = process.env.PORT || 3008;

// Middleware
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3002", "http://localhost:3003", "http://localhost:3100"],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Swagger/OpenAPI configuration
const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Returns Service API',
      version: '1.0.0',
      description: `
## Returns & RMA Management Service

This service handles all return-related operations for the e-commerce platform:

- **Return Requests/RMAs**: Create, track, and manage return merchandise authorizations
- **Return Processing**: Handle return inspections and status updates
- **Refund Coordination**: Process refunds for approved returns
- **Return Policies**: Manage return policies and eligibility rules
- **Exchanges**: Handle product exchanges for returns

### Authentication
Most endpoints require authentication via JWT token (cookie or Bearer token).
      `,
      contact: {
        name: 'API Support',
        email: 'support@innovabound.com',
      },
      license: {
        name: 'ISC',
      },
    },
    servers: [
      {
        url: 'http://localhost:3008',
        description: 'Development server',
      },
    ],
    tags: [
      {
        name: 'Returns',
        description: 'Return request and RMA management operations',
      },
      {
        name: 'Policies',
        description: 'Return policy management',
      },
      {
        name: 'Inspections',
        description: 'Return inspection and quality check operations',
      },
      {
        name: 'Refunds',
        description: 'Refund processing and coordination',
      },
      {
        name: 'Exchanges',
        description: 'Product exchange operations',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'access_token',
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Returns Service API Documentation',
}));

// JSON spec endpoint
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ReDoc endpoint
app.get('/redoc', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Returns Service API Documentation - ReDoc</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
        <style>
          body { margin: 0; padding: 0; }
        </style>
      </head>
      <body>
        <redoc spec-url='/api-docs.json'></redoc>
        <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
      </body>
    </html>
  `);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'returns-service' });
});

// Routes
app.use('/policies', policyRoutes);
app.use('/returns', returnRoutes);
app.use('/inspections', inspectionRoutes);
app.use('/refunds', refundRoutes);
app.use('/exchanges', exchangeRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Returns service running on port ${PORT}`);
  console.log(`API Documentation available at:`);
  console.log(`  - Swagger UI: http://localhost:${PORT}/api-docs`);
  console.log(`  - OpenAPI JSON: http://localhost:${PORT}/api-docs.json`);
  console.log(`  - ReDoc: http://localhost:${PORT}/redoc`);
});

export default app;

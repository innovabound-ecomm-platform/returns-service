import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

import { config } from './config';
import { logger } from './config/logger';
import { AppError } from './common/errors';

import policyRoutes from './routes/policy.route';
import returnRoutes from './routes/return.route';
import inspectionRoutes from './routes/inspection.route';
import refundRoutes from './routes/refund.route';
import exchangeRoutes from './routes/exchange.route';
import { healthRoutes } from './health';

export function createApp(): Application {
  const app: Application = express();

  // Middleware
  app.use(cors({
    origin: [...config.cors.origins],
    credentials: config.cors.credentials,
  }));
  app.use(express.json());
  app.use(cookieParser());

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug('Incoming request', {
      method: req.method,
      path: req.path,
      query: req.query,
    });
    next();
  });

  // Swagger/OpenAPI configuration
  const swaggerOptions: swaggerJsdoc.Options = {
    definition: {
      openapi: '3.0.3',
      info: {
        title: config.api.title,
        version: config.api.version,
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
          url: `http://localhost:${config.app.port}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'Returns', description: 'Return request and RMA management operations' },
        { name: 'Policies', description: 'Return policy management' },
        { name: 'Inspections', description: 'Return inspection and quality check operations' },
        { name: 'Refunds', description: 'Refund processing and coordination' },
        { name: 'Exchanges', description: 'Product exchange operations' },
        { name: 'Health', description: 'Service health and readiness checks' },
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
    apis: ['./src/routes/*.ts', './src/routes/*.js', './src/health/*.ts'],
  };

  const swaggerSpec = swaggerJsdoc(swaggerOptions);

  // Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Returns Service API Documentation',
  }));

  // JSON spec endpoint
  app.get('/api-docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // ReDoc endpoint
  app.get('/redoc', (_req: Request, res: Response) => {
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

  // Health check routes
  app.use('/health', healthRoutes);

  // API Routes
  app.use('/policies', policyRoutes);
  app.use('/returns', returnRoutes);
  app.use('/inspections', inspectionRoutes);
  app.use('/refunds', refundRoutes);
  app.use('/exchanges', exchangeRoutes);

  // Error handling middleware
  app.use((err: Error | AppError, req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', err, {
      method: req.method,
      path: req.path,
    });

    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export default createApp;

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getReturnsPrisma } from '../lib/db';

const router: RouterType = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  checks: {
    database: {
      status: 'up' | 'down';
      latencyMs?: number;
      error?: string;
    };
  };
}

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the returns service
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 *                 service:
 *                   type: string
 *                 version:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 checks:
 *                   type: object
 *       503:
 *         description: Service is unhealthy
 */
router.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const healthStatus: HealthStatus = {
    status: 'healthy',
    service: 'returns-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: {
        status: 'down',
      },
    },
  };

  try {
    const prisma = getReturnsPrisma();
    await prisma.$queryRaw`SELECT 1`;
    healthStatus.checks.database = {
      status: 'up',
      latencyMs: Date.now() - startTime,
    };
  } catch (error) {
    healthStatus.status = 'unhealthy';
    healthStatus.checks.database = {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthStatus);
});

/**
 * @openapi
 * /health/live:
 *   get:
 *     summary: Liveness probe
 *     description: Simple liveness check for Kubernetes
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is alive
 */
router.get('/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     summary: Readiness probe
 *     description: Check if service is ready to accept traffic
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    const prisma = getReturnsPrisma();
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready', reason: 'Database unavailable' });
  }
});

export default router;

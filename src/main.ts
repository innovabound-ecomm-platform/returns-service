import { config } from './config';
import { logger } from './config/logger';
import { createApp } from './app';

async function bootstrap(): Promise<void> {
  const app = createApp();

  const server = app.listen(config.app.port, () => {
    logger.info(`${config.app.serviceName} running`, {
      port: config.app.port,
      env: config.app.env,
    });
    logger.info('API Documentation available at:', {
      swaggerUI: `http://localhost:${config.app.port}/api-docs`,
      openAPIJson: `http://localhost:${config.app.port}/api-docs.json`,
      reDoc: `http://localhost:${config.app.port}/redoc`,
    });
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.warn('Forced shutdown due to timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  logger.error('Failed to start server', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});

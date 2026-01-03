import { config } from './config/index.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { producer } from './kafka/index.js';

async function bootstrap(): Promise<void> {
  // Connect to Kafka producer
  try {
    await producer.connect();
    logger.info("Kafka producer connected");
  } catch (error) {
    logger.error(
      "Failed to connect to Kafka",
      error instanceof Error ? error : new Error(String(error))
    );
    // Continue without Kafka - service can still handle HTTP requests
  }

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
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    
    server.close(async () => {
      logger.info('Server closed');
      
      try {
        await producer.disconnect();
        logger.info("Kafka producer disconnected");
      } catch (error) {
        logger.error(
          "Error during Kafka cleanup",
          error instanceof Error ? error : new Error(String(error))
        );
      }
      
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

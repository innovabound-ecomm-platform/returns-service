export const config = {
  app: {
    port: parseInt(process.env.PORT || '3008', 10),
    env: process.env.NODE_ENV || 'development',
    serviceName: 'returns-service',
  },
  cors: {
    origins: [
      'http://localhost:3000',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:3100',
    ],
    credentials: true,
  },
  auth: {
    serviceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:8003',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: 'returns-service',
    groupId: 'returns-service-group',
  },
  api: {
    title: 'Returns Service API',
    version: '1.0.0',
    description: 'Returns and RMA management service',
  },
} as const;

export default config;

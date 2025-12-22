import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import policyRoutes from './routes/policy.route';
import returnRoutes from './routes/return.route';
import inspectionRoutes from './routes/inspection.route';
import refundRoutes from './routes/refund.route';
import exchangeRoutes from './routes/exchange.route';

const app = express();
const PORT = process.env.PORT || 3010;

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());

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
});

export default app;

// Re-export app for testing and backward compatibility
export { createApp, default as app } from './app';

// Export config and common utilities
export { config } from './config';
export { logger } from './config/logger';
export * from './common';

// Start server when this file is run directly
import './main';


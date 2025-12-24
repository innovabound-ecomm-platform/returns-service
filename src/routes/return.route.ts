/**
 * Return Request Routes - Aggregated Router
 *
 * This file composes all return-related sub-routes into a single router.
 * Split for maintainability from original 1261 LOC file.
 *
 * Sub-routes:
 * - return-crud.route.ts: LIST, GET, CREATE, UPDATE
 * - return-status.route.ts: approve, reject, receive, cancel
 * - return-items.route.ts: item CRUD and disposition
 * - return-shipping.route.ts: labels, shipping, history
 */
import { Router } from 'express';
import returnCrudRoutes from './return-crud.route';
import returnStatusRoutes from './return-status.route';
import returnItemsRoutes from './return-items.route';
import returnShippingRoutes from './return-shipping.route';

const router = Router();

// Compose all sub-routes
// CRUD routes (/, /:id)
router.use('/', returnCrudRoutes);

// Status action routes (/:id/approve, /:id/reject, etc.)
router.use('/', returnStatusRoutes);

// Item management routes (/:id/items, /:returnId/items/:itemId)
router.use('/', returnItemsRoutes);

// Shipping and history routes (/:id/label, /:id/ship, /:id/history)
router.use('/', returnShippingRoutes);

export default router;

// Re-export helpers for backward compatibility
export {
  generateRmaNumber,
  addReturnHistory,
  buildReturnLookupWhere,
  isReturnAdmin,
} from './helpers/return.helpers';


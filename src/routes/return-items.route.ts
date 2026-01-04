/**
 * Return Item Management Routes
 * Handles: list items, add item, update item, delete item, set disposition
 */
import { Router, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';
import {
  AddReturnItemSchema,
  UpdateReturnItemSchema,
  SetItemDispositionSchema,
} from '../schemas/return.schema';
import { buildReturnLookupWhere, isReturnAdmin } from './helpers/return.helpers';
import { getSiteId, returnRequestWhere } from '../utils/tenant.utils';

const prisma = getReturnsPrisma();
const router: Router = Router();

// ===========================================
// RETURN ITEMS - LIST
// ===========================================

/**
 * @openapi
 * /returns/{id}/items:
 *   get:
 *     summary: List return items
 *     description: Get all items in a return request with disposition details
 *     tags:
 *       - Return Items
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Return request ID, UUID, or RMA number
 *     responses:
 *       200:
 *         description: List of return items
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Return request not found
 */
router.get('/:id/items', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const siteId = getSiteId(req);

    const existingReturn = await prisma.returnRequest.findFirst({
      where: returnRequestWhere(siteId, buildReturnLookupWhere(id), { strict: false }),
    });

    if (!existingReturn) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    // Check authorization
    const isAdmin = isReturnAdmin(req.user!.roles);
    if (!isAdmin && existingReturn.userId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const items = await prisma.returnItem.findMany({
      where: { returnRequestId: existingReturn.id },
      include: {
        disposition: true,
      },
    });

    res.json({
      data: items,
      total: items.length,
    });
  } catch (error) {
    console.error('Error listing return items:', error);
    res.status(500).json({ error: 'Failed to list return items' });
  }
});

// ===========================================
// RETURN ITEMS - ADD
// ===========================================

/**
 * @openapi
 * /returns/{id}/items:
 *   post:
 *     summary: Add item to return
 *     description: Add a new item to an existing return request (PENDING status only)
 *     tags:
 *       - Return Items
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Return request ID, UUID, or RMA number
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - productName
 *               - sku
 *               - quantity
 *               - unitPrice
 *               - reason
 *             properties:
 *               productId:
 *                 type: string
 *               variantId:
 *                 type: string
 *               productName:
 *                 type: string
 *               variantName:
 *                 type: string
 *               sku:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               unitPrice:
 *                 type: number
 *               reason:
 *                 type: string
 *               reasonDetails:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Item added to return
 *       400:
 *         description: Validation error or cannot add items in current status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Return request not found
 */
router.post('/:id/items', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const siteId = getSiteId(req);

    const validation = AddReturnItemSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const data = validation.data;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: returnRequestWhere(siteId, buildReturnLookupWhere(id), { strict: false }),
    });

    if (!existingReturn) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    // Check authorization
    const isAdmin = isReturnAdmin(req.user!.roles);
    if (!isAdmin && existingReturn.userId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Can only add items in certain statuses
    if (!['PENDING'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Cannot add items in current status' });
      return;
    }

    const item = await prisma.returnItem.create({
      data: {
        returnRequestId: existingReturn.id,
        productId: data.productId,
        variantId: data.variantId,
        productName: data.productName,
        variantName: data.variantName,
        sku: data.sku,
        quantityOrdered: data.quantity,
        quantityReturning: data.quantity,
        unitPrice: data.unitPrice,
        totalValue: data.unitPrice * data.quantity,
        reason: data.reason,
        reasonDetails: data.reasonDetails,
        images: data.images || [],
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      },
    });

    // Update return totals
    await prisma.returnRequest.update({
      where: { id: existingReturn.id },
      data: {
        subtotal: existingReturn.subtotal + item.totalValue,
        totalRefundAmount: (existingReturn.totalRefundAmount || 0) + item.totalValue,
        updatedBy: req.user!.id,
      },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error('Error adding return item:', error);
    res.status(500).json({ error: 'Failed to add return item' });
  }
});

// ===========================================
// RETURN ITEMS - UPDATE
// ===========================================

/**
 * @openapi
 * /returns/{returnId}/items/{itemId}:
 *   put:
 *     summary: Update return item
 *     description: Update an item in a return request (quantity, reason, etc.)
 *     tags:
 *       - Return Items
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: returnId
 *         required: true
 *         schema:
 *           type: string
 *         description: Return request ID, UUID, or RMA number
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantityReturning:
 *                 type: integer
 *               reason:
 *                 type: string
 *               reasonDetails:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *               condition:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Return request or item not found
 */
router.put('/:returnId/items/:itemId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { returnId, itemId } = req.params;
    const siteId = getSiteId(req);

    const validation = UpdateReturnItemSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const data = validation.data;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: returnRequestWhere(siteId, buildReturnLookupWhere(returnId), { strict: false }),
    });

    if (!existingReturn) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    // Check authorization
    const isAdmin = isReturnAdmin(req.user!.roles);
    if (!isAdmin && existingReturn.userId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const existingItem = await prisma.returnItem.findFirst({
      where: {
        id: parseInt(itemId as string),
        returnRequestId: existingReturn.id,
      },
    });

    if (!existingItem) {
      res.status(404).json({ error: 'Return item not found' });
      return;
    }

    const item = await prisma.returnItem.update({
      where: { id: existingItem.id },
      data: {
        ...data,
        totalValue: data.quantityReturning ? data.quantityReturning * existingItem.unitPrice : undefined,
        updatedBy: req.user!.id,
      },
    });

    res.json(item);
  } catch (error) {
    console.error('Error updating return item:', error);
    res.status(500).json({ error: 'Failed to update return item' });
  }
});

// ===========================================
// RETURN ITEMS - DELETE
// ===========================================

/**
 * @openapi
 * /returns/{returnId}/items/{itemId}:
 *   delete:
 *     summary: Remove item from return
 *     description: Delete an item from a return request (PENDING status only, must have at least 2 items)
 *     tags:
 *       - Return Items
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: returnId
 *         required: true
 *         schema:
 *           type: string
 *         description: Return request ID, UUID, or RMA number
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Item deleted successfully
 *       400:
 *         description: Cannot delete items in current status or cannot remove last item
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Return request or item not found
 */
router.delete('/:returnId/items/:itemId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { returnId, itemId } = req.params;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: buildReturnLookupWhere(returnId),
    });

    if (!existingReturn) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    // Check authorization
    const isAdmin = isReturnAdmin(req.user!.roles);
    if (!isAdmin && existingReturn.userId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Can only delete items in certain statuses
    if (!['PENDING'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Cannot delete items in current status' });
      return;
    }

    const existingItem = await prisma.returnItem.findFirst({
      where: {
        id: parseInt(itemId as string),
        returnRequestId: existingReturn.id,
      },
    });

    if (!existingItem) {
      res.status(404).json({ error: 'Return item not found' });
      return;
    }

    // Check if this is the last item
    const itemCount = await prisma.returnItem.count({
      where: { returnRequestId: existingReturn.id },
    });

    if (itemCount <= 1) {
      res.status(400).json({ error: 'Cannot remove the last item. Cancel the return instead.' });
      return;
    }

    await prisma.returnItem.delete({
      where: { id: existingItem.id },
    });

    // Update return totals
    await prisma.returnRequest.update({
      where: { id: existingReturn.id },
      data: {
        subtotal: existingReturn.subtotal - existingItem.totalValue,
        totalRefundAmount: (existingReturn.totalRefundAmount || 0) - existingItem.totalValue,
        updatedBy: req.user!.id,
      },
    });

    res.json({ message: 'Return item deleted' });
  } catch (error) {
    console.error('Error deleting return item:', error);
    res.status(500).json({ error: 'Failed to delete return item' });
  }
});

// ===========================================
// ITEM DISPOSITION (Admin only)
// ===========================================

/**
 * @openapi
 * /returns/{returnId}/items/{itemId}/disposition:
 *   post:
 *     summary: Set item disposition
 *     description: Admin/warehouse endpoint to set disposition for a returned item (restock, scrap, donate, etc.)
 *     tags:
 *       - Return Items
 *       - Restocking
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: returnId
 *         required: true
 *         schema:
 *           type: string
 *         description: Return request ID, UUID, or RMA number
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - disposition
 *             properties:
 *               disposition:
 *                 type: string
 *                 enum: [RESTOCK, RESTOCK_AS_USED, SCRAP, DONATE, RETURN_TO_VENDOR, REPAIR]
 *               locationId:
 *                 type: string
 *               locationName:
 *                 type: string
 *               recoveredValue:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item disposition set successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin/warehouse access required
 *       404:
 *         description: Return request or item not found
 */
router.post(
  '/:returnId/items/:itemId/disposition',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'warehouse'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { returnId, itemId } = req.params;

      const validation = SetItemDispositionSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: buildReturnLookupWhere(returnId),
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      const existingItem = await prisma.returnItem.findFirst({
        where: {
          id: parseInt(itemId as string),
          returnRequestId: existingReturn.id,
        },
      });

      if (!existingItem) {
        res.status(404).json({ error: 'Return item not found' });
        return;
      }

      // Upsert disposition
      const disposition = await prisma.returnItemDisposition.upsert({
        where: { returnItemId: existingItem.id },
        create: {
          returnItemId: existingItem.id,
          disposition: data.disposition,
          locationId: data.locationId,
          locationName: data.locationName,
          recoveredValue: data.recoveredValue,
          notes: data.notes,
          processedBy: req.user!.id,
          actorUserId: req.user!.id,
          actorType: 'ADMIN',
          createdBy: req.user!.id,
        },
        update: {
          disposition: data.disposition,
          locationId: data.locationId,
          locationName: data.locationName,
          recoveredValue: data.recoveredValue,
          notes: data.notes,
          processedBy: req.user!.id,
          actorUserId: req.user!.id,
        },
      });

      res.json(disposition);
    } catch (error) {
      console.error('Error setting item disposition:', error);
      res.status(500).json({ error: 'Failed to set item disposition' });
    }
  }
);

export default router;

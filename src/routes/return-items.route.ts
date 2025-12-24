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

const prisma = getReturnsPrisma();
const router = Router();

// ===========================================
// RETURN ITEMS - LIST
// ===========================================

router.get('/:id/items', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: buildReturnLookupWhere(id),
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

router.post('/:id/items', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const validation = AddReturnItemSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const data = validation.data;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: buildReturnLookupWhere(id),
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

router.put('/:returnId/items/:itemId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { returnId, itemId } = req.params;

    const validation = UpdateReturnItemSchema.safeParse(req.body);
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

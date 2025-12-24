/**
 * Return Request Status Actions
 * Handles: approve, reject, receive, cancel
 */
import { Router, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';
import {
  ApproveReturnSchema,
  RejectReturnSchema,
  ReceiveReturnSchema,
} from '../schemas/return.schema';
import { addReturnHistory, buildReturnLookupWhere, isReturnAdmin } from './helpers/return.helpers';

const prisma = getReturnsPrisma();
const router = Router();

// ===========================================
// APPROVE RETURN (Admin only)
// ===========================================

router.post(
  '/:id/approve',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = ApproveReturnSchema.safeParse(req.body);
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

      if (existingReturn.status !== 'PENDING') {
        res.status(400).json({ error: 'Can only approve pending returns' });
        return;
      }

      // Calculate restocking fee if applicable
      const restockingFee = 0;

      const returnRequest = await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'APPROVED',
          actualResolution: data.resolution,
          adminNotes: data.adminNotes,
          restockingFee,
          totalRefundAmount: existingReturn.subtotal - restockingFee,
          approvedAt: new Date(),
          processedBy: req.user!.id,
          updatedBy: req.user!.id,
        },
        include: {
          items: true,
          returnLabel: true,
        },
      });

      // Add history
      await addReturnHistory(
        returnRequest.id,
        'status_change',
        'PENDING',
        'APPROVED',
        data.adminNotes || null,
        req.user!.id,
        'ADMIN'
      );

      res.json(returnRequest);
    } catch (error) {
      console.error('Error approving return:', error);
      res.status(500).json({ error: 'Failed to approve return' });
    }
  }
);

// ===========================================
// REJECT RETURN (Admin only)
// ===========================================

router.post(
  '/:id/reject',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = RejectReturnSchema.safeParse(req.body);
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

      if (existingReturn.status !== 'PENDING') {
        res.status(400).json({ error: 'Can only reject pending returns' });
        return;
      }

      const returnRequest = await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'REJECTED',
          adminNotes: data.adminNotes || data.reason,
          rejectedAt: new Date(),
          processedBy: req.user!.id,
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        returnRequest.id,
        'status_change',
        'PENDING',
        'REJECTED',
        data.reason,
        req.user!.id,
        'ADMIN'
      );

      res.json(returnRequest);
    } catch (error) {
      console.error('Error rejecting return:', error);
      res.status(500).json({ error: 'Failed to reject return' });
    }
  }
);

// ===========================================
// RECEIVE RETURN (Admin only)
// ===========================================

router.post(
  '/:id/receive',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'warehouse'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = ReceiveReturnSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: buildReturnLookupWhere(id),
        include: { items: true },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      if (!['APPROVED', 'SHIPPED'].includes(existingReturn.status)) {
        res.status(400).json({ error: 'Return is not in a receivable status' });
        return;
      }

      // Update items if received quantities provided
      if (data.itemsReceived) {
        for (const itemData of data.itemsReceived) {
          await prisma.returnItem.update({
            where: { id: itemData.itemId },
            data: {
              condition: itemData.condition,
              updatedBy: req.user!.id,
            },
          });
        }
      }

      const returnRequest = await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'RECEIVED',
          receivedAt: new Date(),
          updatedBy: req.user!.id,
        },
        include: {
          items: true,
          returnLabel: true,
        },
      });

      // Add history
      await addReturnHistory(
        returnRequest.id,
        'status_change',
        existingReturn.status,
        'RECEIVED',
        data.notes || null,
        req.user!.id,
        'ADMIN'
      );

      res.json(returnRequest);
    } catch (error) {
      console.error('Error receiving return:', error);
      res.status(500).json({ error: 'Failed to receive return' });
    }
  }
);

// ===========================================
// CANCEL RETURN
// ===========================================

router.post('/:id/cancel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

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

    // Can only cancel in certain statuses
    if (!['PENDING', 'APPROVED'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Cannot cancel return in current status' });
      return;
    }

    const returnRequest = await prisma.returnRequest.update({
      where: { id: existingReturn.id },
      data: {
        status: 'CANCELLED',
        updatedBy: req.user!.id,
      },
    });

    // Add history
    await addReturnHistory(
      returnRequest.id,
      'status_change',
      existingReturn.status,
      'CANCELLED',
      reason || null,
      req.user!.id,
      isAdmin ? 'ADMIN' : 'USER'
    );

    res.json(returnRequest);
  } catch (error) {
    console.error('Error cancelling return:', error);
    res.status(500).json({ error: 'Failed to cancel return' });
  }
});

export default router;

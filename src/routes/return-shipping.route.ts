/**
 * Return Shipping & Label Routes
 * Handles: generate label, get label, mark as shipped, get history
 */
import { Router, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';
import { GenerateLabelSchema, MarkShippedSchema } from '../schemas/return.schema';
import { addReturnHistory, buildReturnLookupWhere, isReturnAdmin } from './helpers/return.helpers';

const prisma = getReturnsPrisma();
const router = Router();

// ===========================================
// GET RETURN HISTORY
// ===========================================

router.get('/:id/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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

    const history = await prisma.returnHistory.findMany({
      where: { returnRequestId: existingReturn.id },
      orderBy: { occurredAt: 'desc' },
    });

    res.json({
      data: history,
      total: history.length,
    });
  } catch (error) {
    console.error('Error getting return history:', error);
    res.status(500).json({ error: 'Failed to get return history' });
  }
});

// ===========================================
// GENERATE RETURN LABEL (Admin only)
// ===========================================

router.post(
  '/:id/label',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = GenerateLabelSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: buildReturnLookupWhere(id),
        include: { returnLabel: true },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      if (!['APPROVED'].includes(existingReturn.status)) {
        res.status(400).json({ error: 'Return must be approved before generating label' });
        return;
      }

      if (existingReturn.returnLabel) {
        res.status(400).json({ error: 'Return already has a label' });
        return;
      }

      // In production, integrate with shipping carrier API
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + data.expiresInDays);

      const label = await prisma.returnLabel.create({
        data: {
          returnRequestId: existingReturn.id,
          carrier: data.carrier,
          paidBy: data.paidBy,
          expiresAt,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
      });

      // Update return status
      await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'APPROVED',
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        existingReturn.id,
        'label_generated',
        null,
        data.carrier,
        null,
        req.user!.id,
        'ADMIN'
      );

      res.status(201).json(label);
    } catch (error) {
      console.error('Error generating return label:', error);
      res.status(500).json({ error: 'Failed to generate return label' });
    }
  }
);

// ===========================================
// GET RETURN LABEL
// ===========================================

router.get('/:id/label', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: buildReturnLookupWhere(id),
      include: { returnLabel: true },
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

    if (!existingReturn.returnLabel) {
      res.status(404).json({ error: 'No return label found' });
      return;
    }

    res.json(existingReturn.returnLabel);
  } catch (error) {
    console.error('Error getting return label:', error);
    res.status(500).json({ error: 'Failed to get return label' });
  }
});

// ===========================================
// MARK AS SHIPPED
// ===========================================

router.post('/:id/ship', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const validation = MarkShippedSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const data = validation.data;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: buildReturnLookupWhere(id),
      include: { returnLabel: true },
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

    if (!['APPROVED'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Return is not in a shippable status' });
      return;
    }

    // Update label with tracking info
    if (existingReturn.returnLabel) {
      await prisma.returnLabel.update({
        where: { id: existingReturn.returnLabel.id },
        data: {
          trackingNumber: data.trackingNumber,
          trackingUrl: data.trackingUrl,
          carrier: data.carrier || existingReturn.returnLabel.carrier,
          shipped: true,
          shippedAt: new Date(),
          updatedBy: req.user!.id,
        },
      });
    } else {
      // Create label with tracking info
      await prisma.returnLabel.create({
        data: {
          returnRequestId: existingReturn.id,
          carrier: data.carrier || 'Unknown',
          trackingNumber: data.trackingNumber,
          trackingUrl: data.trackingUrl,
          shipped: true,
          shippedAt: new Date(),
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
      });
    }

    // Update return status
    const returnRequest = await prisma.returnRequest.update({
      where: { id: existingReturn.id },
      data: {
        status: 'SHIPPED',
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
      'SHIPPED',
      `Tracking: ${data.trackingNumber}`,
      req.user!.id,
      isAdmin ? 'ADMIN' : 'USER'
    );

    res.json(returnRequest);
  } catch (error) {
    console.error('Error marking return as shipped:', error);
    res.status(500).json({ error: 'Failed to mark return as shipped' });
  }
});

export default router;

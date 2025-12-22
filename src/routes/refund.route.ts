import { Router, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';

const prisma = getReturnsPrisma();
import {
  CreateRefundSchema,
  ProcessRefundSchema,
  RefundListQuerySchema,
} from '../schemas/return.schema';

const router = Router();

// ===========================================
// HELPER FUNCTIONS
// ===========================================

async function addReturnHistory(
  returnRequestId: number,
  action: string,
  previousValue: string | null,
  newValue: string | null,
  notes: string | null,
  performedBy: string | null,
  actorType: 'USER' | 'ADMIN' | 'SYSTEM' | 'SERVICE' = 'ADMIN'
) {
  await prisma.returnHistory.create({
    data: {
      returnRequestId,
      action,
      previousValue,
      newValue,
      notes,
      performedBy,
      actorUserId: performedBy,
      actorType,
      createdBy: performedBy,
    },
  });
}

// ===========================================
// LIST REFUNDS
// ===========================================

router.get(
  '/',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'finance'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = RefundListQuerySchema.safeParse(req.query);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const { page, limit, status, returnId, fromDate, toDate } = validation.data;

      const where: Record<string, unknown> = {};

      if (status) where.status = status;
      if (returnId) where.returnRequestId = returnId;

      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) (where.createdAt as Record<string, Date>).gte = fromDate;
        if (toDate) (where.createdAt as Record<string, Date>).lte = toDate;
      }

      const [refunds, total] = await Promise.all([
        prisma.refund.findMany({
          where,
          include: {
            returnRequest: {
              select: {
                id: true,
                uuid: true,
                rmaNumber: true,
                userId: true,
                orderId: true,
                status: true,
              },
            },
            refundTo: true,
            paymentReference: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.refund.count({ where }),
      ]);

      res.json({
        data: refunds,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error('Error listing refunds:', error);
      res.status(500).json({ error: 'Failed to list refunds' });
    }
  }
);

// ===========================================
// GET REFUND BY ID
// ===========================================

router.get(
  '/:id',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'finance'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const refund = await prisma.refund.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
        include: {
          returnRequest: {
            include: {
              items: true,
            },
          },
          refundTo: true,
          paymentReference: true,
        },
      });

      if (!refund) {
        res.status(404).json({ error: 'Refund not found' });
        return;
      }

      res.json(refund);
    } catch (error) {
      console.error('Error getting refund:', error);
      res.status(500).json({ error: 'Failed to get refund' });
    }
  }
);

// ===========================================
// CREATE REFUND FOR RETURN
// ===========================================

router.post(
  '/returns/:returnId/refund',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'finance'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { returnId } = req.params;

      const validation = CreateRefundSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: {
          OR: [
            { id: parseInt(returnId as string) || 0 },
            { uuid: returnId },
            { rmaNumber: returnId },
          ],
        },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      // Verify return is in appropriate status
      if (!['INSPECTION_PASSED', 'PROCESSING_REFUND'].includes(existingReturn.status)) {
        res.status(400).json({ error: 'Return must be inspected before refund' });
        return;
      }

      // Check refund amount doesn't exceed return total
      const existingRefunds = await prisma.refund.aggregate({
        where: {
          returnRequestId: existingReturn.id,
          status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
        },
        _sum: { amount: true },
      });

      const refundedAmount = existingRefunds._sum.amount || 0;
      const remainingAmount = (existingReturn.totalRefundAmount || 0) - refundedAmount;

      if (data.amount > remainingAmount) {
        res.status(400).json({
          error: 'Refund amount exceeds remaining refundable amount',
          remainingAmount,
          requestedAmount: data.amount,
        });
        return;
      }

      // Create refund
      const refund = await prisma.refund.create({
        data: {
          returnRequestId: existingReturn.id,
          refundType: data.refundType,
          amount: data.amount,
          currency: data.currency,
          reason: data.reason,
          status: 'PENDING',
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
          refundTo: {
            create: {
              type: data.refundTo,
              createdBy: req.user!.id,
              updatedBy: req.user!.id,
            },
          },
        },
        include: {
          refundTo: true,
        },
      });

      // Update return status
      await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'PROCESSING_REFUND',
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        existingReturn.id,
        'refund_created',
        null,
        `${data.amount} ${data.currency}`,
        data.reason || null,
        req.user!.id,
        'ADMIN'
      );

      res.status(201).json(refund);
    } catch (error) {
      console.error('Error creating refund:', error);
      res.status(500).json({ error: 'Failed to create refund' });
    }
  }
);

// ===========================================
// PROCESS REFUND (Admin/Finance only)
// ===========================================

router.post(
  '/:id/process',
  requireAuth,
  requirePermission('admin', 'finance'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = ProcessRefundSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const refund = await prisma.refund.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
        include: {
          returnRequest: true,
          refundTo: true,
        },
      });

      if (!refund) {
        res.status(404).json({ error: 'Refund not found' });
        return;
      }

      if (refund.status !== 'PENDING') {
        res.status(400).json({ error: 'Can only process pending refunds' });
        return;
      }

      // Update refund to processing
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'PROCESSING',
          updatedBy: req.user!.id,
        },
      });

      // In production, integrate with payment provider here
      // For now, simulate successful processing
      const provider = data.provider || 'MANUAL';

      // Create payment reference
      if (provider !== 'WALLET') {
        await prisma.paymentRefundReference.create({
          data: {
            refundId: refund.id,
            provider,
            providerRefundId: `ref_${Date.now()}`, // Would be actual provider ID
            providerStatus: 'succeeded',
            createdBy: req.user!.id,
            updatedBy: req.user!.id,
          },
        });
      } else if (data.walletId) {
        await prisma.refund.update({
          where: { id: refund.id },
          data: {
            walletTransactionId: data.walletId,
          },
        });

        await prisma.refundDestination.update({
          where: { refundId: refund.id },
          data: {
            walletId: data.walletId,
            type: 'wallet',
          },
        });
      }

      // Complete the refund
      const updatedRefund = await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'COMPLETED',
          processedBy: req.user!.id,
          processedAt: new Date(),
          updatedBy: req.user!.id,
        },
        include: {
          returnRequest: true,
          refundTo: true,
          paymentReference: true,
        },
      });

      // Check if all refunds for this return are complete
      const pendingRefunds = await prisma.refund.count({
        where: {
          returnRequestId: refund.returnRequestId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
      });

      if (pendingRefunds === 0) {
        // All refunds complete, update return status
        await prisma.returnRequest.update({
          where: { id: refund.returnRequestId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            updatedBy: req.user!.id,
          },
        });

        await addReturnHistory(
          refund.returnRequestId,
          'status_change',
          'PROCESSING_REFUND',
          'COMPLETED',
          'All refunds processed',
          req.user!.id,
          'ADMIN'
        );
      }

      // Add history
      await addReturnHistory(
        refund.returnRequestId,
        'refund_completed',
        'PENDING',
        'COMPLETED',
        `Refund of ${refund.amount} ${refund.currency} processed via ${provider}`,
        req.user!.id,
        'ADMIN'
      );

      res.json(updatedRefund);
    } catch (error) {
      console.error('Error processing refund:', error);
      res.status(500).json({ error: 'Failed to process refund' });
    }
  }
);

// ===========================================
// CANCEL REFUND (Admin only)
// ===========================================

router.post(
  '/:id/cancel',
  requireAuth,
  requirePermission('admin', 'finance'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const refund = await prisma.refund.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
      });

      if (!refund) {
        res.status(404).json({ error: 'Refund not found' });
        return;
      }

      if (!['PENDING', 'PROCESSING'].includes(refund.status)) {
        res.status(400).json({ error: 'Can only cancel pending or processing refunds' });
        return;
      }

      const updatedRefund = await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          failureReason: reason,
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        refund.returnRequestId,
        'refund_cancelled',
        refund.status,
        'FAILED',
        reason || null,
        req.user!.id,
        'ADMIN'
      );

      res.json(updatedRefund);
    } catch (error) {
      console.error('Error cancelling refund:', error);
      res.status(500).json({ error: 'Failed to cancel refund' });
    }
  }
);

// ===========================================
// RETRY FAILED REFUND (Admin only)
// ===========================================

router.post(
  '/:id/retry',
  requireAuth,
  requirePermission('admin', 'finance'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const refund = await prisma.refund.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
      });

      if (!refund) {
        res.status(404).json({ error: 'Refund not found' });
        return;
      }

      if (refund.status !== 'FAILED') {
        res.status(400).json({ error: 'Can only retry failed refunds' });
        return;
      }

      const updatedRefund = await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'PENDING',
          failureReason: null,
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        refund.returnRequestId,
        'refund_retry',
        'FAILED',
        'PENDING',
        'Refund retry initiated',
        req.user!.id,
        'ADMIN'
      );

      res.json(updatedRefund);
    } catch (error) {
      console.error('Error retrying refund:', error);
      res.status(500).json({ error: 'Failed to retry refund' });
    }
  }
);

// ===========================================
// REFUND SUMMARY FOR RETURN
// ===========================================

router.get(
  '/returns/:returnId/summary',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { returnId } = req.params;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: {
          OR: [
            { id: parseInt(returnId as string) || 0 },
            { uuid: returnId },
            { rmaNumber: returnId },
          ],
        },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      // Check authorization
      const isAdmin = req.user!.roles.includes('admin') || req.user!.roles.includes('returns:manage');
      if (!isAdmin && existingReturn.userId !== req.user!.id) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const refunds = await prisma.refund.findMany({
        where: { returnRequestId: existingReturn.id },
        include: {
          refundTo: true,
        },
      });

      const summary = {
        returnTotal: existingReturn.totalRefundAmount,
        refunds: refunds.map((r: { uuid: string; amount: number; currency: string; refundType: string; status: string; refundTo: { type: string } | null; createdAt: Date; processedAt: Date | null }) => ({
          id: r.uuid,
          amount: r.amount,
          currency: r.currency,
          type: r.refundType,
          status: r.status,
          destination: r.refundTo?.type,
          createdAt: r.createdAt,
          processedAt: r.processedAt,
        })),
        totalRefunded: refunds
          .filter((r: { status: string }) => r.status === 'COMPLETED')
          .reduce((sum: number, r: { amount: number }) => sum + r.amount, 0),
        totalPending: refunds
          .filter((r: { status: string }) => ['PENDING', 'PROCESSING'].includes(r.status))
          .reduce((sum: number, r: { amount: number }) => sum + r.amount, 0),
        remainingRefundable: (existingReturn.totalRefundAmount || 0) - refunds
          .filter((r: { status: string }) => ['PENDING', 'PROCESSING', 'COMPLETED'].includes(r.status))
          .reduce((sum: number, r: { amount: number }) => sum + r.amount, 0),
      };

      res.json(summary);
    } catch (error) {
      console.error('Error getting refund summary:', error);
      res.status(500).json({ error: 'Failed to get refund summary' });
    }
  }
);

export default router;

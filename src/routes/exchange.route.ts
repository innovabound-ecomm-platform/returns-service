import { Router, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';

const prisma = getReturnsPrisma();
import {
  CreateExchangeSchema,
  UpdateExchangeSchema,
} from '../schemas/return.schema';

const router: Router = Router();

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
// LIST EXCHANGES
// ===========================================

router.get(
  '/',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { page = '1', limit = '20', status } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);

      const where: Record<string, unknown> = {};
      if (status) where.status = status;

      const [exchanges, total] = await Promise.all([
        prisma.exchange.findMany({
          where,
          include: {
            items: true,
            returnRequest: {
              select: {
                id: true,
                uuid: true,
                rmaNumber: true,
                userId: true,
                orderId: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.exchange.count({ where }),
      ]);

      res.json({
        data: exchanges,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error('Error listing exchanges:', error);
      res.status(500).json({ error: 'Failed to list exchanges' });
    }
  }
);

// ===========================================
// GET EXCHANGE BY ID
// ===========================================

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const exchange = await prisma.exchange.findFirst({
      where: {
        OR: [
          { id: parseInt(id as string) || 0 },
          { uuid: id },
        ],
      },
      include: {
        items: true,
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
      },
    });

    if (!exchange) {
      res.status(404).json({ error: 'Exchange not found' });
      return;
    }

    // Check authorization
    const isAdmin = req.user!.roles.includes('admin') || req.user!.roles.includes('returns:manage');
    if (!isAdmin && exchange.returnRequest.userId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(exchange);
  } catch (error) {
    console.error('Error getting exchange:', error);
    res.status(500).json({ error: 'Failed to get exchange' });
  }
});

// ===========================================
// CREATE EXCHANGE FOR RETURN
// ===========================================

router.post(
  '/returns/:returnId/exchange',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { returnId } = req.params;

      const validation = CreateExchangeSchema.safeParse(req.body);
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
        include: { exchange: true },
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

      // Verify return is approved for exchange
      if (existingReturn.actualResolution !== 'EXCHANGE') {
        res.status(400).json({ error: 'Return is not approved for exchange' });
        return;
      }

      if (existingReturn.exchange) {
        res.status(400).json({ error: 'Return already has an exchange' });
        return;
      }

      // Calculate price difference
      const priceDifference = data.items.reduce((diff, item) => {
        return diff + ((item.newPrice - item.originalPrice) * item.quantity);
      }, 0);

      const exchange = await prisma.exchange.create({
        data: {
          returnRequestId: existingReturn.id,
          status: 'PENDING',
          priceDifference,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
          items: {
            create: data.items.map((item) => ({
              originalProductId: item.originalProductId,
              originalVariantId: item.originalVariantId,
              newProductId: item.newProductId,
              newVariantId: item.newVariantId,
              newProductName: item.newProductName,
              newVariantName: item.newVariantName,
              quantity: item.quantity,
              originalPrice: item.originalPrice,
              newPrice: item.newPrice,
              createdBy: req.user!.id,
              updatedBy: req.user!.id,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      // Add history
      await addReturnHistory(
        existingReturn.id,
        'exchange_created',
        null,
        'PENDING',
        `Price difference: ${priceDifference > 0 ? '+' : ''}${priceDifference}`,
        req.user!.id,
        isAdmin ? 'ADMIN' : 'USER'
      );

      res.status(201).json(exchange);
    } catch (error) {
      console.error('Error creating exchange:', error);
      res.status(500).json({ error: 'Failed to create exchange' });
    }
  }
);

// ===========================================
// UPDATE EXCHANGE
// ===========================================

router.put(
  '/:id',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = UpdateExchangeSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingExchange = await prisma.exchange.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
        include: { items: true },
      });

      if (!existingExchange) {
        res.status(404).json({ error: 'Exchange not found' });
        return;
      }

      if (['COMPLETED', 'CANCELLED'].includes(existingExchange.status)) {
        res.status(400).json({ error: 'Cannot update completed or cancelled exchange' });
        return;
      }

      // Update items if provided
      if (data.items) {
        // Delete existing items and create new ones
        await prisma.exchangeItem.deleteMany({
          where: { exchangeId: existingExchange.id },
        });

        const priceDifference = data.items.reduce((diff, item) => {
          return diff + ((item.newPrice - item.originalPrice) * item.quantity);
        }, 0);

        await prisma.exchange.update({
          where: { id: existingExchange.id },
          data: {
            priceDifference,
            updatedBy: req.user!.id,
            items: {
              create: data.items.map((item) => ({
                originalProductId: item.originalProductId,
                originalVariantId: item.originalVariantId,
                newProductId: item.newProductId,
                newVariantId: item.newVariantId,
                newProductName: item.newProductName,
                newVariantName: item.newVariantName,
                quantity: item.quantity,
                originalPrice: item.originalPrice,
                newPrice: item.newPrice,
                createdBy: req.user!.id,
                updatedBy: req.user!.id,
              })),
            },
          },
        });
      }

      // Update status if provided
      if (data.status) {
        await prisma.exchange.update({
          where: { id: existingExchange.id },
          data: {
            status: data.status,
            updatedBy: req.user!.id,
          },
        });
      }

      const exchange = await prisma.exchange.findUnique({
        where: { id: existingExchange.id },
        include: { items: true },
      });

      res.json(exchange);
    } catch (error) {
      console.error('Error updating exchange:', error);
      res.status(500).json({ error: 'Failed to update exchange' });
    }
  }
);

// ===========================================
// APPROVE EXCHANGE (Admin only)
// ===========================================

router.post(
  '/:id/approve',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const exchange = await prisma.exchange.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
        include: { returnRequest: true },
      });

      if (!exchange) {
        res.status(404).json({ error: 'Exchange not found' });
        return;
      }

      if (exchange.status !== 'PENDING') {
        res.status(400).json({ error: 'Can only approve pending exchanges' });
        return;
      }

      const updatedExchange = await prisma.exchange.update({
        where: { id: exchange.id },
        data: {
          status: 'PROCESSING',
          updatedBy: req.user!.id,
        },
        include: { items: true },
      });

      // Add history
      await addReturnHistory(
        exchange.returnRequestId,
        'exchange_approved',
        'PENDING',
        'PROCESSING',
        null,
        req.user!.id,
        'ADMIN'
      );

      res.json(updatedExchange);
    } catch (error) {
      console.error('Error approving exchange:', error);
      res.status(500).json({ error: 'Failed to approve exchange' });
    }
  }
);

// ===========================================
// COMPLETE EXCHANGE (Admin only)
// ===========================================

router.post(
  '/:id/complete',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { newOrderId } = req.body;

      const exchange = await prisma.exchange.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
        include: { returnRequest: true },
      });

      if (!exchange) {
        res.status(404).json({ error: 'Exchange not found' });
        return;
      }

      if (!['PROCESSING', 'SHIPPED'].includes(exchange.status)) {
        res.status(400).json({ error: 'Exchange is not in completable status' });
        return;
      }

      const updatedExchange = await prisma.exchange.update({
        where: { id: exchange.id },
        data: {
          status: 'COMPLETED',
          newOrderId,
          completedAt: new Date(),
          updatedBy: req.user!.id,
        },
        include: { items: true },
      });

      // Update return status
      await prisma.returnRequest.update({
        where: { id: exchange.returnRequestId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        exchange.returnRequestId,
        'exchange_completed',
        exchange.status,
        'COMPLETED',
        newOrderId ? `New order: ${newOrderId}` : null,
        req.user!.id,
        'ADMIN'
      );

      res.json(updatedExchange);
    } catch (error) {
      console.error('Error completing exchange:', error);
      res.status(500).json({ error: 'Failed to complete exchange' });
    }
  }
);

// ===========================================
// CANCEL EXCHANGE
// ===========================================

router.post(
  '/:id/cancel',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const exchange = await prisma.exchange.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
        include: { returnRequest: true },
      });

      if (!exchange) {
        res.status(404).json({ error: 'Exchange not found' });
        return;
      }

      // Check authorization
      const isAdmin = req.user!.roles.includes('admin') || req.user!.roles.includes('returns:manage');
      if (!isAdmin && exchange.returnRequest.userId !== req.user!.id) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (['COMPLETED', 'CANCELLED'].includes(exchange.status)) {
        res.status(400).json({ error: 'Cannot cancel completed or already cancelled exchange' });
        return;
      }

      // Non-admins can only cancel pending exchanges
      if (!isAdmin && exchange.status !== 'PENDING') {
        res.status(400).json({ error: 'Can only cancel pending exchanges' });
        return;
      }

      const updatedExchange = await prisma.exchange.update({
        where: { id: exchange.id },
        data: {
          status: 'CANCELLED',
          updatedBy: req.user!.id,
        },
        include: { items: true },
      });

      // Add history
      await addReturnHistory(
        exchange.returnRequestId,
        'exchange_cancelled',
        exchange.status,
        'CANCELLED',
        reason || null,
        req.user!.id,
        isAdmin ? 'ADMIN' : 'USER'
      );

      res.json(updatedExchange);
    } catch (error) {
      console.error('Error cancelling exchange:', error);
      res.status(500).json({ error: 'Failed to cancel exchange' });
    }
  }
);

// ===========================================
// MARK EXCHANGE AS PROCESSING
// ===========================================

router.post(
  '/:id/process',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const exchange = await prisma.exchange.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
      });

      if (!exchange) {
        res.status(404).json({ error: 'Exchange not found' });
        return;
      }

      if (exchange.status !== 'PENDING') {
        res.status(400).json({ error: 'Can only process pending exchanges' });
        return;
      }

      const updatedExchange = await prisma.exchange.update({
        where: { id: exchange.id },
        data: {
          status: 'PROCESSING',
          updatedBy: req.user!.id,
        },
        include: { items: true },
      });

      // Add history
      await addReturnHistory(
        exchange.returnRequestId,
        'exchange_processing',
        'PENDING',
        'PROCESSING',
        null,
        req.user!.id,
        'ADMIN'
      );

      res.json(updatedExchange);
    } catch (error) {
      console.error('Error processing exchange:', error);
      res.status(500).json({ error: 'Failed to process exchange' });
    }
  }
);

// ===========================================
// MARK EXCHANGE AS SHIPPED
// ===========================================

router.post(
  '/:id/ship',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { newOrderId } = req.body;

      const exchange = await prisma.exchange.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        },
      });

      if (!exchange) {
        res.status(404).json({ error: 'Exchange not found' });
        return;
      }

      if (!['PENDING', 'PROCESSING'].includes(exchange.status)) {
        res.status(400).json({ error: 'Exchange is not ready to ship' });
        return;
      }

      const updatedExchange = await prisma.exchange.update({
        where: { id: exchange.id },
        data: {
          status: 'SHIPPED',
          newOrderId,
          updatedBy: req.user!.id,
        },
        include: { items: true },
      });

      // Add history
      await addReturnHistory(
        exchange.returnRequestId,
        'exchange_shipped',
        exchange.status,
        'SHIPPED',
        newOrderId ? `Order: ${newOrderId}` : null,
        req.user!.id,
        'ADMIN'
      );

      res.json(updatedExchange);
    } catch (error) {
      console.error('Error shipping exchange:', error);
      res.status(500).json({ error: 'Failed to ship exchange' });
    }
  }
);

export default router;

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

/**
 * @openapi
 * /exchanges:
 *   get:
 *     summary: List exchanges
 *     description: Admin endpoint to list all exchange requests with pagination
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PROCESSING, SHIPPED, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: List of exchanges with pagination
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
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

/**
 * @openapi
 * /exchanges/{id}:
 *   get:
 *     summary: Get exchange by ID
 *     description: Get detailed information about a specific exchange including items and return request
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Exchange ID or UUID
 *     responses:
 *       200:
 *         description: Exchange details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Exchange not found
 */
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
    const isAdmin = req.user?.roles?.includes('admin') || req.user?.roles?.includes('returns:manage');
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

/**
 * @openapi
 * /exchanges/returns/{returnId}/exchange:
 *   post:
 *     summary: Create exchange for return
 *     description: Create an exchange request for a return approved for exchange resolution
 *     tags:
 *       - Exchanges
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - originalProductId
 *                     - newProductId
 *                     - quantity
 *                     - originalPrice
 *                     - newPrice
 *                     - newProductName
 *                   properties:
 *                     originalProductId:
 *                       type: string
 *                     originalVariantId:
 *                       type: string
 *                     newProductId:
 *                       type: string
 *                     newVariantId:
 *                       type: string
 *                     newProductName:
 *                       type: string
 *                     newVariantName:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *                     originalPrice:
 *                       type: number
 *                     newPrice:
 *                       type: number
 *     responses:
 *       201:
 *         description: Exchange created successfully
 *       400:
 *         description: Return not approved for exchange or already has exchange
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Return request not found
 */
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
      const isAdmin = req.user?.roles?.includes('admin') || req.user?.roles?.includes('returns:manage');
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

/**
 * @openapi
 * /exchanges/{id}:
 *   put:
 *     summary: Update exchange
 *     description: Admin endpoint to update exchange items (not allowed for completed/cancelled)
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Exchange ID or UUID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Exchange updated successfully
 *       400:
 *         description: Cannot update completed or cancelled exchange
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Exchange not found
 */
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

/**
 * @openapi
 * /exchanges/{id}/approve:
 *   post:
 *     summary: Approve exchange
 *     description: Admin endpoint to approve a pending exchange and move to processing
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Exchange ID or UUID
 *     responses:
 *       200:
 *         description: Exchange approved successfully
 *       400:
 *         description: Can only approve pending exchanges
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Exchange not found
 */
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

/**
 * @openapi
 * /exchanges/{id}/complete:
 *   post:
 *     summary: Complete exchange
 *     description: Admin endpoint to mark an exchange as completed with new order details
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Exchange ID or UUID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newOrderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Exchange completed successfully
 *       400:
 *         description: Exchange not in completable status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Exchange not found
 */
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

/**
 * @openapi
 * /exchanges/{id}/cancel:
 *   post:
 *     summary: Cancel exchange
 *     description: Cancel an exchange. Users can only cancel pending exchanges, admins can cancel any status.
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Exchange ID or UUID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Exchange cancelled successfully
 *       400:
 *         description: Cannot cancel completed or already cancelled exchange
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Exchange not found
 */
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
      const isAdmin = req.user?.roles?.includes('admin') || req.user?.roles?.includes('returns:manage');
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

/**
 * @openapi
 * /exchanges/{id}/process:
 *   post:
 *     summary: Mark exchange as processing
 *     description: Admin endpoint to mark a pending exchange as processing
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Exchange ID or UUID
 *     responses:
 *       200:
 *         description: Exchange processing started
 *       400:
 *         description: Can only process pending exchanges
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Exchange not found
 */
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

/**
 * @openapi
 * /exchanges/{id}/ship:
 *   post:
 *     summary: Mark exchange as shipped
 *     description: Admin endpoint to mark an exchange as shipped and provide new order ID
 *     tags:
 *       - Exchanges
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Exchange ID or UUID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newOrderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Exchange marked as shipped
 *       400:
 *         description: Exchange is not ready to ship
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Exchange not found
 */
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

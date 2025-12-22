import { Router, type Response } from 'express';
import { prisma } from '@innovabound-ecomm-platform/returns-db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';
import {
  CreateReturnRequestSchema,
  UpdateReturnRequestSchema,
  ApproveReturnSchema,
  RejectReturnSchema,
  ReceiveReturnSchema,
  AddReturnItemSchema,
  UpdateReturnItemSchema,
  SetItemDispositionSchema,
  GenerateLabelSchema,
  MarkShippedSchema,
  ReturnListQuerySchema,
} from '../schemas/return.schema';

const router = Router();

// ===========================================
// HELPER FUNCTIONS
// ===========================================

function generateRmaNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RMA-${timestamp}-${random}`;
}

async function addReturnHistory(
  returnRequestId: number,
  action: string,
  previousValue: string | null,
  newValue: string | null,
  notes: string | null,
  performedBy: string | null,
  actorType: 'USER' | 'ADMIN' | 'SYSTEM' | 'SERVICE' = 'USER'
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
// LIST RETURN REQUESTS
// ===========================================

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = ReturnListQuerySchema.safeParse(req.query);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const { page, limit, status, userId, orderId, resolution, reason, fromDate, toDate, sortBy, sortOrder } = validation.data;

    const isAdmin = req.user!.roles.includes('admin') || req.user!.roles.includes('returns:manage');

    const where: Record<string, unknown> = {};

    // Non-admins can only see their own returns
    if (!isAdmin) {
      where.userId = req.user!.id;
    } else if (userId) {
      where.userId = userId;
    }

    if (status) where.status = status;
    if (orderId) where.orderId = orderId;
    if (resolution) where.requestedResolution = resolution;
    if (reason) where.reason = reason;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) (where.createdAt as Record<string, Date>).gte = fromDate;
      if (toDate) (where.createdAt as Record<string, Date>).lte = toDate;
    }

    const [returns, total] = await Promise.all([
      prisma.returnRequest.findMany({
        where,
        include: {
          items: true,
          label: true,
          _count: {
            select: { refunds: true },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.returnRequest.count({ where }),
    ]);

    res.json({
      data: returns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error listing returns:', error);
    res.status(500).json({ error: 'Failed to list returns' });
  }
});

// ===========================================
// GET RETURN REQUEST BY ID
// ===========================================

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const returnRequest = await prisma.returnRequest.findFirst({
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
        ],
      },
      include: {
        items: {
          include: {
            disposition: true,
          },
        },
        label: true,
        inspection: true,
        refunds: {
          include: {
            refundTo: true,
            paymentReference: true,
          },
        },
        exchange: {
          include: {
            items: true,
          },
        },
        history: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
        },
        policy: true,
      },
    });

    if (!returnRequest) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    // Check authorization
    const isAdmin = req.user!.roles.includes('admin') || req.user!.roles.includes('returns:manage');
    if (!isAdmin && returnRequest.userId !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json(returnRequest);
  } catch (error) {
    console.error('Error getting return request:', error);
    res.status(500).json({ error: 'Failed to get return request' });
  }
});

// ===========================================
// CREATE RETURN REQUEST
// ===========================================

router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = CreateReturnRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const data = validation.data;
    const userId = data.userId || req.user!.id;

    // Get default policy
    const policy = await prisma.returnPolicy.findFirst({
      where: { isDefault: true, isActive: true },
    });

    // Calculate totals
    const subtotal = data.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

    const returnRequest = await prisma.returnRequest.create({
      data: {
        rmaNumber: generateRmaNumber(),
        orderId: data.orderId,
        userId,
        policyId: policy?.id,
        status: 'PENDING',
        reason: data.reason,
        reasonDetails: data.reasonDetails,
        requestedResolution: data.requestedResolution,
        customerNotes: data.customerNotes,
        subtotal,
        shippingCost: 0,
        restockingFee: 0,
        total: subtotal,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            quantity: item.quantity,
            quantityReceived: 0,
            unitPrice: item.unitPrice,
            totalValue: item.unitPrice * item.quantity,
            reason: item.reason,
            reasonDetails: item.reasonDetails,
            images: item.images || [],
            createdBy: req.user!.id,
            updatedBy: req.user!.id,
          })),
        },
      },
      include: {
        items: true,
        policy: true,
      },
    });

    // Add history
    await addReturnHistory(
      returnRequest.id,
      'return_created',
      null,
      'PENDING',
      `Return request created for order ${data.orderId}`,
      req.user!.id,
      'USER'
    );

    res.status(201).json(returnRequest);
  } catch (error) {
    console.error('Error creating return request:', error);
    res.status(500).json({ error: 'Failed to create return request' });
  }
});

// ===========================================
// UPDATE RETURN REQUEST
// ===========================================

router.put('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const validation = UpdateReturnRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const data = validation.data;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
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

    // Only allow updates in certain statuses
    if (!['PENDING', 'APPROVED'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Cannot update return in current status' });
      return;
    }

    const returnRequest = await prisma.returnRequest.update({
      where: { id: existingReturn.id },
      data: {
        ...data,
        updatedBy: req.user!.id,
      },
      include: {
        items: true,
        label: true,
      },
    });

    res.json(returnRequest);
  } catch (error) {
    console.error('Error updating return request:', error);
    res.status(500).json({ error: 'Failed to update return request' });
  }
});

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
        where: {
          OR: [
            { id: parseInt(id) || 0 },
            { uuid: id },
            { rmaNumber: id },
          ],
        },
        include: { policy: true },
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
      let restockingFee = 0;
      if (existingReturn.policy?.restockingFeePercent) {
        restockingFee = Math.round(existingReturn.subtotal * (existingReturn.policy.restockingFeePercent / 100));
      }

      const returnRequest = await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'APPROVED',
          approvedResolution: data.resolution,
          adminNotes: data.adminNotes,
          restockingFee,
          total: existingReturn.subtotal - restockingFee,
          approvedAt: new Date(),
          approvedBy: req.user!.id,
          updatedBy: req.user!.id,
        },
        include: {
          items: true,
          label: true,
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
        where: {
          OR: [
            { id: parseInt(id) || 0 },
            { uuid: id },
            { rmaNumber: id },
          ],
        },
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
          rejectionReason: data.reason,
          adminNotes: data.adminNotes,
          rejectedAt: new Date(),
          rejectedBy: req.user!.id,
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
        where: {
          OR: [
            { id: parseInt(id) || 0 },
            { uuid: id },
            { rmaNumber: id },
          ],
        },
        include: { items: true },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      if (!['APPROVED', 'LABEL_GENERATED', 'SHIPPED'].includes(existingReturn.status)) {
        res.status(400).json({ error: 'Return is not in a receivable status' });
        return;
      }

      // Update items if received quantities provided
      if (data.itemsReceived) {
        for (const itemData of data.itemsReceived) {
          await prisma.returnItem.update({
            where: { id: itemData.itemId },
            data: {
              quantityReceived: itemData.quantityReceived,
              condition: itemData.condition,
              updatedBy: req.user!.id,
            },
          });
        }
      } else {
        // Default: mark all items as fully received
        await prisma.returnItem.updateMany({
          where: { returnRequestId: existingReturn.id },
          data: {
            quantityReceived: undefined, // Will need to set individually
            updatedBy: req.user!.id,
          },
        });
      }

      const returnRequest = await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'RECEIVED',
          receivedAt: new Date(),
          receivedBy: data.receivedBy || req.user!.id,
          updatedBy: req.user!.id,
        },
        include: {
          items: true,
          label: true,
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
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
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

    // Can only cancel in certain statuses
    if (!['PENDING', 'APPROVED', 'LABEL_GENERATED'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Cannot cancel return in current status' });
      return;
    }

    const returnRequest = await prisma.returnRequest.update({
      where: { id: existingReturn.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: req.user!.id,
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

// ===========================================
// GET RETURN HISTORY
// ===========================================

router.get('/:id/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
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
// RETURN ITEMS - LIST
// ===========================================

router.get('/:id/items', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existingReturn = await prisma.returnRequest.findFirst({
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
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
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
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
        quantity: data.quantity,
        quantityReceived: 0,
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
        total: existingReturn.total + item.totalValue,
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
      where: {
        OR: [
          { id: parseInt(returnId) || 0 },
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

    const existingItem = await prisma.returnItem.findFirst({
      where: {
        id: parseInt(itemId),
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
        totalValue: data.quantity ? data.quantity * existingItem.unitPrice : undefined,
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
      where: {
        OR: [
          { id: parseInt(returnId) || 0 },
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

    // Can only delete items in certain statuses
    if (!['PENDING'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Cannot delete items in current status' });
      return;
    }

    const existingItem = await prisma.returnItem.findFirst({
      where: {
        id: parseInt(itemId),
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
        total: existingReturn.total - existingItem.totalValue,
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
        where: {
          OR: [
            { id: parseInt(returnId) || 0 },
            { uuid: returnId },
            { rmaNumber: returnId },
          ],
        },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      const existingItem = await prisma.returnItem.findFirst({
        where: {
          id: parseInt(itemId),
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
        where: {
          OR: [
            { id: parseInt(id) || 0 },
            { uuid: id },
            { rmaNumber: id },
          ],
        },
        include: { label: true },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      if (!['APPROVED'].includes(existingReturn.status)) {
        res.status(400).json({ error: 'Return must be approved before generating label' });
        return;
      }

      if (existingReturn.label) {
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
          status: 'LABEL_GENERATED',
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
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
        ],
      },
      include: { label: true },
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

    if (!existingReturn.label) {
      res.status(404).json({ error: 'No return label found' });
      return;
    }

    res.json(existingReturn.label);
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
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
          { rmaNumber: id },
        ],
      },
      include: { label: true },
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

    if (!['APPROVED', 'LABEL_GENERATED'].includes(existingReturn.status)) {
      res.status(400).json({ error: 'Return is not in a shippable status' });
      return;
    }

    // Update label with tracking info
    if (existingReturn.label) {
      await prisma.returnLabel.update({
        where: { id: existingReturn.label.id },
        data: {
          trackingNumber: data.trackingNumber,
          trackingUrl: data.trackingUrl,
          carrier: data.carrier || existingReturn.label.carrier,
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
        shippedAt: new Date(),
        updatedBy: req.user!.id,
      },
      include: {
        items: true,
        label: true,
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

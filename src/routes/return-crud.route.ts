/**
 * Return Request CRUD Operations
 * Handles: LIST, GET, CREATE, UPDATE
 */
import { Router, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import {
  CreateReturnRequestSchema,
  UpdateReturnRequestSchema,
  ReturnListQuerySchema,
} from '../schemas/return.schema';
import { generateRmaNumber, addReturnHistory, buildReturnLookupWhere, isReturnAdmin } from './helpers/return.helpers';

const prisma = getReturnsPrisma();
const router: Router = Router();

// ===========================================
// LIST RETURN REQUESTS
// ===========================================

/**
 * @openapi
 * /returns:
 *   get:
 *     summary: List return requests
 *     description: Retrieve a paginated list of return requests. Non-admin users only see their own returns.
 *     tags:
 *       - Returns
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
 *           enum: [PENDING, APPROVED, REJECTED, SHIPPED, RECEIVED, INSPECTING, INSPECTION_PASSED, INSPECTION_FAILED, PROCESSING_REFUND, COMPLETED, CANCELLED]
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID (admin only)
 *       - in: query
 *         name: orderId
 *         schema:
 *           type: string
 *       - in: query
 *         name: resolution
 *         schema:
 *           type: string
 *           enum: [REFUND, EXCHANGE, STORE_CREDIT]
 *       - in: query
 *         name: reason
 *         schema:
 *           type: string
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: createdAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: List of return requests with pagination
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Validation error
 */
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = ReturnListQuerySchema.safeParse(req.query);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const { page, limit, status, userId, orderId, resolution, reason, fromDate, toDate, sortBy, sortOrder } = validation.data;

    const isAdmin = isReturnAdmin(req.user!.roles);

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
          returnLabel: true,
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

/**
 * @openapi
 * /returns/{id}:
 *   get:
 *     summary: Get return request by ID
 *     description: Retrieve detailed information about a specific return request by ID, UUID, or RMA number
 *     tags:
 *       - Returns
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
 *         description: Return request details including items, label, inspection, refunds, exchange, and history
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied - not your return
 *       404:
 *         description: Return request not found
 */
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const returnRequest = await prisma.returnRequest.findFirst({
      where: buildReturnLookupWhere(id),
      include: {
        items: {
          include: {
            disposition: true,
          },
        },
        returnLabel: true,
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
      },
    });

    if (!returnRequest) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    // Check authorization
    const isAdmin = isReturnAdmin(req.user!.roles);
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

/**
 * @openapi
 * /returns:
 *   post:
 *     summary: Create return request
 *     description: Create a new return request for an order with items to return
 *     tags:
 *       - Returns
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *               - requestedResolution
 *               - items
 *             properties:
 *               orderId:
 *                 type: string
 *               userId:
 *                 type: string
 *                 description: Optional - admin can create return for any user
 *               requestedResolution:
 *                 type: string
 *                 enum: [REFUND, EXCHANGE, STORE_CREDIT]
 *               customerNotes:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - productId
 *                     - productName
 *                     - sku
 *                     - quantity
 *                     - unitPrice
 *                     - reason
 *                   properties:
 *                     productId:
 *                       type: string
 *                     variantId:
 *                       type: string
 *                     productName:
 *                       type: string
 *                     variantName:
 *                       type: string
 *                     sku:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *                     unitPrice:
 *                       type: number
 *                     reason:
 *                       type: string
 *                     reasonDetails:
 *                       type: string
 *                     images:
 *                       type: array
 *                       items:
 *                         type: string
 *     responses:
 *       201:
 *         description: Return request created successfully with auto-generated RMA number
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = CreateReturnRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
      return;
    }

    const data = validation.data;
    const userId = data.userId || req.user!.id;

    // Calculate totals
    const subtotal = data.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);

    const returnRequest = await prisma.returnRequest.create({
      data: {
        rmaNumber: generateRmaNumber(),
        orderId: data.orderId,
        userId,
        status: 'PENDING',
        requestedResolution: data.requestedResolution,
        customerNotes: data.customerNotes,
        subtotal,
        restockingFee: 0,
        totalRefundAmount: subtotal,
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
        items: {
          create: data.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            quantityOrdered: item.quantity,
            quantityReturning: item.quantity,
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

/**
 * @openapi
 * /returns/{id}:
 *   put:
 *     summary: Update return request
 *     description: Update a return request's details. Only allowed in PENDING or APPROVED status.
 *     tags:
 *       - Returns
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
 *             properties:
 *               requestedResolution:
 *                 type: string
 *                 enum: [REFUND, EXCHANGE, STORE_CREDIT]
 *               customerNotes:
 *                 type: string
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Return request updated successfully
 *       400:
 *         description: Validation error or cannot update in current status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied
 *       404:
 *         description: Return request not found
 */
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
        returnLabel: true,
      },
    });

    res.json(returnRequest);
  } catch (error) {
    console.error('Error updating return request:', error);
    res.status(500).json({ error: 'Failed to update return request' });
  }
});

export default router;

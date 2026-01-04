import { Router, type Request, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';

const prisma = getReturnsPrisma();
import {
  CreateReturnPolicySchema,
  UpdateReturnPolicySchema,
} from '../schemas/return.schema';
import { getSiteId, returnPolicyWhere, withSiteId } from '../utils/tenant.utils';

const router: Router = Router();

// ===========================================
// LIST RETURN POLICIES
// ===========================================

/**
 * @openapi
 * /policies:
 *   get:
 *     summary: List return policies
 *     description: Retrieve all return policies, optionally filtered by active status. Public endpoint.
 *     tags:
 *       - Policies
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of return policies
 *       500:
 *         description: Server error
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { active } = req.query;
    const siteId = (req as { siteId?: string }).siteId;

    const additionalWhere: Record<string, unknown> = {};
    if (active === 'true') {
      additionalWhere.isActive = true;
    }

    const where = returnPolicyWhere(siteId, additionalWhere, { strict: false });

    const policies = await prisma.returnPolicy.findMany({
      where,
      orderBy: [
        { isDefault: 'desc' },
        { name: 'asc' },
      ],
    });

    res.json({
      data: policies,
      total: policies.length,
    });
  } catch (error) {
    console.error('Error listing return policies:', error);
    res.status(500).json({ error: 'Failed to list return policies' });
  }
});

// ===========================================
// GET DEFAULT POLICY
// ===========================================

/**
 * @openapi
 * /policies/default:
 *   get:
 *     summary: Get default return policy
 *     description: Retrieve the active default return policy. Public endpoint.
 *     tags:
 *       - Policies
 *     responses:
 *       200:
 *         description: Default return policy details
 *       404:
 *         description: No default return policy found
 *       500:
 *         description: Server error
 */
router.get('/default', async (req: Request, res: Response) => {
  try {
    const siteId = (req as { siteId?: string }).siteId;

    const policy = await prisma.returnPolicy.findFirst({
      where: returnPolicyWhere(siteId, {
        isDefault: true,
        isActive: true,
      }, { strict: false }),
    });

    if (!policy) {
      res.status(404).json({ error: 'No default return policy found' });
      return;
    }

    res.json(policy);
  } catch (error) {
    console.error('Error getting default policy:', error);
    res.status(500).json({ error: 'Failed to get default policy' });
  }
});

// ===========================================
// GET POLICY BY ID
// ===========================================

/**
 * @openapi
 * /policies/{id}:
 *   get:
 *     summary: Get return policy by ID
 *     description: Retrieve a specific return policy by ID or UUID. Public endpoint.
 *     tags:
 *       - Policies
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Policy ID or UUID
 *     responses:
 *       200:
 *         description: Return policy details
 *       404:
 *         description: Return policy not found
 *       500:
 *         description: Server error
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const siteId = (req as { siteId?: string }).siteId;

    const policy = await prisma.returnPolicy.findFirst({
      where: returnPolicyWhere(siteId, {
        OR: [
          { id: parseInt(id as string) || 0 },
          { uuid: id },
        ],
      }, { strict: false }),
    });

    if (!policy) {
      res.status(404).json({ error: 'Return policy not found' });
      return;
    }

    res.json(policy);
  } catch (error) {
    console.error('Error getting return policy:', error);
    res.status(500).json({ error: 'Failed to get return policy' });
  }
});

// ===========================================
// CREATE POLICY (Admin only)
// ===========================================

/**
 * @openapi
 * /policies:
 *   post:
 *     summary: Create return policy
 *     description: Admin endpoint to create a new return policy with rules and restrictions
 *     tags:
 *       - Policies
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
 *               - name
 *               - returnWindowDays
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *                 default: false
 *               returnWindowDays:
 *                 type: integer
 *               restockingFeePercent:
 *                 type: number
 *               requiresReceipt:
 *                 type: boolean
 *               requiresOriginalPackaging:
 *                 type: boolean
 *               allowedReasons:
 *                 type: array
 *                 items:
 *                   type: string
 *               excludedCategories:
 *                 type: array
 *                 items:
 *                   type: string
 *               isActive:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Return policy created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       500:
 *         description: Server error
 */
router.post(
  '/',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = CreateReturnPolicySchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;
      const siteId = getSiteId(req);

      // If setting as default, unset other defaults
      if (data.isDefault) {
        await prisma.returnPolicy.updateMany({
          where: returnPolicyWhere(siteId, { isDefault: true }, { strict: false }),
          data: { isDefault: false },
        });
      }

      const policy = await prisma.returnPolicy.create({
        data: withSiteId({
          name: data.name,
          slug: data.name.toLowerCase().replace(/\s+/g, '-'),
          description: data.description,
          isDefault: data.isDefault,
          returnWindowDays: data.returnWindowDays,
          restockingFeePercent: data.restockingFeePercent,
          requiresReceipt: data.requiresReceipt,
          requiresOriginalPackaging: data.requiresOriginalPackaging,

          allowedReasons: data.allowedReasons || [],
          excludeCategories: data.excludedCategories || [],
          isActive: data.isActive,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        }, siteId),
      });

      res.status(201).json(policy);
    } catch (error) {
      console.error('Error creating return policy:', error);
      res.status(500).json({ error: 'Failed to create return policy' });
    }
  }
);

// ===========================================
// UPDATE POLICY (Admin only)
// ===========================================

/**
 * @openapi
 * /policies/{id}:
 *   put:
 *     summary: Update return policy
 *     description: Admin endpoint to update an existing return policy
 *     tags:
 *       - Policies
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Policy ID or UUID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *               returnWindowDays:
 *                 type: integer
 *               restockingFeePercent:
 *                 type: number
 *               requiresReceipt:
 *                 type: boolean
 *               requiresOriginalPackaging:
 *                 type: boolean
 *               allowedReasons:
 *                 type: array
 *                 items:
 *                   type: string
 *               excludedCategories:
 *                 type: array
 *                 items:
 *                   type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Return policy updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Return policy not found
 *       500:
 *         description: Server error
 */
router.put(
  '/:id',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const siteId = getSiteId(req);

      const validation = UpdateReturnPolicySchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingPolicy = await prisma.returnPolicy.findFirst({
        where: returnPolicyWhere(siteId, {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        }, { strict: false }),
      });

      if (!existingPolicy) {
        res.status(404).json({ error: 'Return policy not found' });
        return;
      }

      // If setting as default, unset other defaults
      if (data.isDefault) {
        await prisma.returnPolicy.updateMany({
          where: returnPolicyWhere(siteId, {
            isDefault: true,
            id: { not: existingPolicy.id },
          }, { strict: false }),
          data: { isDefault: false },
        });
      }

      const policy = await prisma.returnPolicy.update({
        where: { id: existingPolicy.id, siteId: existingPolicy.siteId },
        data: {
          ...data,
          updatedBy: req.user!.id,
        },
      });

      res.json(policy);
    } catch (error) {
      console.error('Error updating return policy:', error);
      res.status(500).json({ error: 'Failed to update return policy' });
    }
  }
);

// ===========================================
// DELETE POLICY (Admin only)
// ===========================================

/**
 * @openapi
 * /policies/{id}:
 *   delete:
 *     summary: Delete return policy
 *     description: Admin endpoint to delete a return policy. Default policies are deactivated instead of deleted.
 *     tags:
 *       - Policies
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Policy ID or UUID
 *     responses:
 *       200:
 *         description: Return policy deleted or deactivated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Return policy not found
 *       500:
 *         description: Server error
 */
router.delete(
  '/:id',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const siteId = getSiteId(req);

      const policy = await prisma.returnPolicy.findFirst({
        where: returnPolicyWhere(siteId, {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
          ],
        }, { strict: false }),
      });

      if (!policy) {
        res.status(404).json({ error: 'Return policy not found' });
        return;
      }

      // Check if policy is in use - cannot reference policyId directly, so just check if it's default
      if (policy.isDefault) {
        // Soft delete by deactivating
        await prisma.returnPolicy.update({
          where: { id: policy.id, siteId: policy.siteId },
          data: {
            isActive: false,
            isDefault: false,
            updatedBy: req.user!.id,
          },
        });

        res.json({ message: 'Return policy deactivated (was default policy)' });
        return;
      }

      await prisma.returnPolicy.delete({
        where: { id: policy.id, siteId: policy.siteId },
      });

      res.json({ message: 'Return policy deleted' });
    } catch (error) {
      console.error('Error deleting return policy:', error);
      res.status(500).json({ error: 'Failed to delete return policy' });
    }
  }
);

// ===========================================
// CHECK ELIGIBILITY
// ===========================================

/**
 * @openapi
 * /policies/check-eligibility:
 *   post:
 *     summary: Check return eligibility
 *     description: Check if an order is eligible for return based on return policies and time windows
 *     tags:
 *       - Policies
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
 *               - orderDate
 *             properties:
 *               orderId:
 *                 type: string
 *               orderDate:
 *                 type: string
 *                 format: date-time
 *               productIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               categoryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Eligibility check result with policy details and remaining days
 *       400:
 *         description: orderId and orderDate are required
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/check-eligibility', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderId, orderDate, productIds, categoryIds } = req.body;
    const siteId = getSiteId(req);

    if (!orderId || !orderDate) {
      res.status(400).json({ error: 'orderId and orderDate are required' });
      return;
    }

    // Get applicable policy (default for now, could be category-specific)
    const policy = await prisma.returnPolicy.findFirst({
      where: returnPolicyWhere(siteId, {
        isDefault: true,
        isActive: true,
      }, { strict: false }),
    });

    if (!policy) {
      res.json({
        eligible: false,
        reason: 'No return policy configured',
      });
      return;
    }

    const orderDateObj = new Date(orderDate);
    const now = new Date();
    const daysSinceOrder = Math.floor((now.getTime() - orderDateObj.getTime()) / (1000 * 60 * 60 * 24));

    // Check return window
    const windowDays = policy.returnWindowDays;
    if (daysSinceOrder > windowDays) {
      res.json({
        eligible: false,
        reason: `Return window of ${windowDays} days has expired`,
        daysExpired: daysSinceOrder - windowDays,
      });
      return;
    }

    // Check excluded categories
    const excludeCategories = (policy.excludeCategories as string[]) || [];
    const excludedCategoryIds = (categoryIds || []).filter((id: string) =>
      excludeCategories.includes(id)
    );

    if (excludedCategoryIds.length > 0) {
      res.json({
        eligible: false,
        reason: 'Some product categories are excluded from returns',
        excludedCategoryIds,
      });
      return;
    }

    res.json({
      eligible: true,
      policy: {
        id: policy.uuid,
        name: policy.name,
        returnWindowDays: policy.returnWindowDays,
        restockingFeePercent: policy.restockingFeePercent,
        allowedReasons: policy.allowedReasons,
        requiresReceipt: policy.requiresReceipt,
        requiresOriginalPackaging: policy.requiresOriginalPackaging,
      },
      daysRemaining: windowDays - daysSinceOrder,
    });
  } catch (error) {
    console.error('Error checking eligibility:', error);
    res.status(500).json({ error: 'Failed to check return eligibility' });
  }
});

export default router;

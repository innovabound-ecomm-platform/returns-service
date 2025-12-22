import { Router, type Request, type Response } from 'express';
import { prisma } from '@innovabound-ecomm-platform/returns-db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';
import {
  CreateReturnPolicySchema,
  UpdateReturnPolicySchema,
} from '../schemas/return.schema';

const router = Router();

// ===========================================
// LIST RETURN POLICIES
// ===========================================

router.get('/', async (req: Request, res: Response) => {
  try {
    const { active } = req.query;

    const where: Record<string, unknown> = {};
    if (active === 'true') {
      where.isActive = true;
    }

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

router.get('/default', async (req: Request, res: Response) => {
  try {
    const policy = await prisma.returnPolicy.findFirst({
      where: {
        isDefault: true,
        isActive: true,
      },
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

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const policy = await prisma.returnPolicy.findFirst({
      where: {
        OR: [
          { id: parseInt(id) || 0 },
          { uuid: id },
        ],
      },
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

      // If setting as default, unset other defaults
      if (data.isDefault) {
        await prisma.returnPolicy.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const policy = await prisma.returnPolicy.create({
        data: {
          name: data.name,
          description: data.description,
          isDefault: data.isDefault,
          returnWindowDays: data.returnWindowDays,
          extendedWindowDays: data.extendedWindowDays,
          restockingFeePercent: data.restockingFeePercent,
          freeReturnThreshold: data.freeReturnThreshold,
          requiresReceipt: data.requiresReceipt,
          requiresOriginalPackaging: data.requiresOriginalPackaging,
          finalSaleExcluded: data.finalSaleExcluded,
          allowPartialReturns: data.allowPartialReturns,
          allowedReasons: data.allowedReasons || [],
          excludedReasons: data.excludedReasons || [],
          allowedResolutions: data.allowedResolutions || [],
          excludedCategories: data.excludedCategories || [],
          excludedProducts: data.excludedProducts || [],
          conditions: data.conditions || {},
          isActive: data.isActive,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
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

router.put(
  '/:id',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = UpdateReturnPolicySchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingPolicy = await prisma.returnPolicy.findFirst({
        where: {
          OR: [
            { id: parseInt(id) || 0 },
            { uuid: id },
          ],
        },
      });

      if (!existingPolicy) {
        res.status(404).json({ error: 'Return policy not found' });
        return;
      }

      // If setting as default, unset other defaults
      if (data.isDefault) {
        await prisma.returnPolicy.updateMany({
          where: {
            isDefault: true,
            id: { not: existingPolicy.id },
          },
          data: { isDefault: false },
        });
      }

      const policy = await prisma.returnPolicy.update({
        where: { id: existingPolicy.id },
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

router.delete(
  '/:id',
  requireAuth,
  requirePermission('admin', 'returns:manage'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const policy = await prisma.returnPolicy.findFirst({
        where: {
          OR: [
            { id: parseInt(id) || 0 },
            { uuid: id },
          ],
        },
      });

      if (!policy) {
        res.status(404).json({ error: 'Return policy not found' });
        return;
      }

      // Check if policy is in use
      const returnsCount = await prisma.returnRequest.count({
        where: { policyId: policy.id },
      });

      if (returnsCount > 0) {
        // Soft delete by deactivating
        await prisma.returnPolicy.update({
          where: { id: policy.id },
          data: {
            isActive: false,
            updatedBy: req.user!.id,
          },
        });

        res.json({ message: 'Return policy deactivated (has associated returns)' });
        return;
      }

      await prisma.returnPolicy.delete({
        where: { id: policy.id },
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

router.post('/check-eligibility', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderId, orderDate, productIds, categoryIds } = req.body;

    if (!orderId || !orderDate) {
      res.status(400).json({ error: 'orderId and orderDate are required' });
      return;
    }

    // Get applicable policy (default for now, could be category-specific)
    const policy = await prisma.returnPolicy.findFirst({
      where: {
        isDefault: true,
        isActive: true,
      },
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
    const windowDays = policy.extendedWindowDays || policy.returnWindowDays;
    if (daysSinceOrder > windowDays) {
      res.json({
        eligible: false,
        reason: `Return window of ${windowDays} days has expired`,
        daysExpired: daysSinceOrder - windowDays,
      });
      return;
    }

    // Check excluded products
    const excludedProducts = (policy.excludedProducts as string[]) || [];
    const excludedProductIds = (productIds || []).filter((id: string) => 
      excludedProducts.includes(id)
    );

    if (excludedProductIds.length > 0) {
      res.json({
        eligible: false,
        reason: 'Some products are excluded from returns',
        excludedProductIds,
      });
      return;
    }

    // Check excluded categories
    const excludedCategories = (policy.excludedCategories as string[]) || [];
    const excludedCategoryIds = (categoryIds || []).filter((id: string) =>
      excludedCategories.includes(id)
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
        allowedResolutions: policy.allowedResolutions,
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

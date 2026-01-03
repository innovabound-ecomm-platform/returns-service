import { Router, type Response } from 'express';
import { getReturnsPrisma } from '../lib/db';
import { requireAuth, requirePermission, type AuthenticatedRequest } from '../middleware/auth';

const prisma = getReturnsPrisma();
import {
  SubmitInspectionSchema,
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
// SUBMIT INSPECTION (Admin/Warehouse only)
// ===========================================

router.post(
  '/:id/inspection',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'warehouse'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const validation = SubmitInspectionSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Validation failed', details: validation.error.errors });
        return;
      }

      const data = validation.data;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
            { rmaNumber: id },
          ],
        },
        include: {
          items: true,
          inspection: true,
        },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      if (!['RECEIVED', 'INSPECTING'].includes(existingReturn.status)) {
        res.status(400).json({ error: 'Return must be received before inspection' });
        return;
      }

      if (existingReturn.inspection) {
        res.status(400).json({ error: 'Return already has an inspection' });
        return;
      }

      // Create inspection
      const inspection = await prisma.returnInspection.create({
        data: {
          returnRequestId: existingReturn.id,
          inspectedBy: req.user!.id,
          overallResult: data.overallResult,
          notes: data.notes,
          photos: data.photos || [],
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
      });

      // Update individual item inspection results if provided
      if (data.itemResults) {
        for (const itemResult of data.itemResults) {
          await prisma.returnItem.update({
            where: { id: itemResult.itemId },
            data: {
              inspectionResult: itemResult.result,
              inspectionNotes: itemResult.notes,
              condition: itemResult.condition,
              updatedBy: req.user!.id,
            },
          });
        }
      } else {
        // Apply overall result to all items
        await prisma.returnItem.updateMany({
          where: { returnRequestId: existingReturn.id },
          data: {
            inspectionResult: data.overallResult,
            updatedBy: req.user!.id,
          },
        });
      }

      // Update return status based on inspection result
      const newStatus = data.overallResult === 'PASS' ? 'INSPECTION_PASSED' : 'INSPECTION_FAILED';
      
      await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: newStatus,
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        existingReturn.id,
        'inspection_completed',
        existingReturn.status,
        newStatus,
        `Result: ${data.overallResult}${data.notes ? ` - ${data.notes}` : ''}`,
        req.user!.id,
        'ADMIN'
      );

      res.status(201).json(inspection);
    } catch (error) {
      console.error('Error submitting inspection:', error);
      res.status(500).json({ error: 'Failed to submit inspection' });
    }
  }
);

// ===========================================
// GET INSPECTION
// ===========================================

router.get(
  '/:id/inspection',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'warehouse'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
            { rmaNumber: id },
          ],
        },
        include: {
          inspection: true,
          items: {
            select: {
              id: true,
              productName: true,
              variantName: true,
              inspectionResult: true,
              inspectionNotes: true,
              condition: true,
            },
          },
        },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      if (!existingReturn.inspection) {
        res.status(404).json({ error: 'No inspection found for this return' });
        return;
      }

      res.json({
        ...existingReturn.inspection,
        itemResults: existingReturn.items.map((item: { id: number; productName: string; variantName: string | null; inspectionResult: string | null; inspectionNotes: string | null; condition: string | null }) => ({
          itemId: item.id,
          productName: item.productName,
          variantName: item.variantName,
          result: item.inspectionResult,
          notes: item.inspectionNotes,
          condition: item.condition,
        })),
      });
    } catch (error) {
      console.error('Error getting inspection:', error);
      res.status(500).json({ error: 'Failed to get inspection' });
    }
  }
);

// ===========================================
// START INSPECTION (Admin/Warehouse only)
// ===========================================

router.post(
  '/:id/inspection/start',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'warehouse'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      const existingReturn = await prisma.returnRequest.findFirst({
        where: {
          OR: [
            { id: parseInt(id as string) || 0 },
            { uuid: id },
            { rmaNumber: id },
          ],
        },
      });

      if (!existingReturn) {
        res.status(404).json({ error: 'Return request not found' });
        return;
      }

      if (existingReturn.status !== 'RECEIVED') {
        res.status(400).json({ error: 'Return must be in RECEIVED status to start inspection' });
        return;
      }

      const returnRequest = await prisma.returnRequest.update({
        where: { id: existingReturn.id },
        data: {
          status: 'INSPECTING',
          updatedBy: req.user!.id,
        },
      });

      // Add history
      await addReturnHistory(
        returnRequest.id,
        'status_change',
        'RECEIVED',
        'INSPECTING',
        'Inspection started',
        req.user!.id,
        'ADMIN'
      );

      res.json(returnRequest);
    } catch (error) {
      console.error('Error starting inspection:', error);
      res.status(500).json({ error: 'Failed to start inspection' });
    }
  }
);

// ===========================================
// INSPECTION QUEUE (Admin/Warehouse only)
// ===========================================

router.get(
  '/queue',
  requireAuth,
  requirePermission('admin', 'returns:manage', 'warehouse'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { page = '1', limit = '20' } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);

      const [returns, total] = await Promise.all([
        prisma.returnRequest.findMany({
          where: {
            status: {
              in: ['RECEIVED', 'INSPECTING'],
            },
          },
          include: {
            items: true,
          },
          orderBy: [
            { status: 'asc' }, // RECEIVED first, then INSPECTING
            { receivedAt: 'asc' }, // Oldest first
          ],
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.returnRequest.count({
          where: {
            status: {
              in: ['RECEIVED', 'INSPECTING'],
            },
          },
        }),
      ]);

      res.json({
        data: returns,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error('Error getting inspection queue:', error);
      res.status(500).json({ error: 'Failed to get inspection queue' });
    }
  }
);

export default router;

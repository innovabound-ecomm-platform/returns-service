import { getReturnsPrisma } from '../../lib/db';

const prisma = getReturnsPrisma();

/**
 * Generates a unique RMA number for return requests.
 * Format: RMA-{timestamp}-{random}
 */
export function generateRmaNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RMA-${timestamp}-${random}`;
}

/**
 * Adds a history entry for a return request.
 */
export async function addReturnHistory(
  returnRequestId: number,
  action: string,
  previousValue: string | null,
  newValue: string | null,
  notes: string | null,
  performedBy: string | null,
  actorType: 'USER' | 'ADMIN' | 'SYSTEM' | 'SERVICE' = 'USER'
): Promise<void> {
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

/**
 * Common return lookup by ID, UUID, or RMA number.
 */
export function buildReturnLookupWhere(id: string | undefined) {
  const idValue = id || '';
  return {
    OR: [
      { id: parseInt(idValue) || 0 },
      { uuid: idValue },
      { rmaNumber: idValue },
    ],
  };
}

/**
 * Check if user has admin or returns management permissions.
 */
export function isReturnAdmin(roles: string[] | undefined): boolean {
  if (!roles) return false;
  return roles.includes('admin') || roles.includes('returns:manage');
}

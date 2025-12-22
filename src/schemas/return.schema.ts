import { z } from 'zod';

// ===========================================
// ENUMS
// ===========================================

export const ReturnRequestStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SHIPPED',
  'RECEIVED',
  'INSPECTING',
  'INSPECTION_PASSED',
  'INSPECTION_FAILED',
  'PROCESSING_REFUND',
  'COMPLETED',
  'CANCELLED',
]);

export const ReturnReasonSchema = z.enum([
  'WRONG_ITEM',
  'DEFECTIVE',
  'DAMAGED',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'SIZE_FIT',
  'QUALITY',
  'LATE_DELIVERY',
  'OTHER',
]);

export const ReturnResolutionSchema = z.enum([
  'REFUND_ORIGINAL',
  'REFUND_WALLET',
  'EXCHANGE',
  'REPLACEMENT',
]);

export const RefundStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'PARTIALLY_COMPLETED',
]);

export const RefundTypeSchema = z.enum([
  'FULL',
  'PARTIAL',
  'RESTOCKING_FEE',
]);

export const InspectionResultSchema = z.enum([
  'PASS',
  'FAIL_DAMAGED',
  'FAIL_USED',
  'FAIL_WRONG_ITEM',
  'FAIL_MISSING_PARTS',
]);

export const ExchangeStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
]);

export const ReturnDispositionSchema = z.enum([
  'SELLABLE',
  'REFURBISHED',
  'DAMAGED',
  'PARTS_ONLY',
  'DISPOSE',
  'RETURN_TO_VENDOR',
]);

export const PaymentProviderSchema = z.enum([
  'STRIPE',
  'PAYPAL',
  'MANUAL',
  'WALLET',
]);

// ===========================================
// RETURN POLICY SCHEMAS
// ===========================================

export const CreateReturnPolicySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  isDefault: z.boolean().optional().default(false),
  returnWindowDays: z.number().int().positive().default(30),
  exchangeWindowDays: z.number().int().positive().default(30),
  restockingFeePercent: z.number().min(0).max(100).default(0),
  returnShippingPaidBy: z.enum(['customer', 'store']).optional().default('customer'),
  requiresReceipt: z.boolean().optional().default(false),
  requiresOriginalPackaging: z.boolean().optional().default(false),
  requiresUnopened: z.boolean().optional().default(false),
  requiresTags: z.boolean().optional().default(false),
  allowRefund: z.boolean().optional().default(true),
  allowExchange: z.boolean().optional().default(true),
  allowStoreCredit: z.boolean().optional().default(true),
  allowedReasons: z.array(ReturnReasonSchema).optional(),
  targetCategories: z.array(z.string()).optional(),
  excludeCategories: z.array(z.string()).optional(),
  excludedCategories: z.array(z.string()).optional(), // alias for excludeCategories
  isActive: z.boolean().optional().default(true),
});

export const UpdateReturnPolicySchema = CreateReturnPolicySchema.partial();

// ===========================================
// RETURN REQUEST SCHEMAS
// ===========================================

export const CreateReturnRequestSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().optional(), // Will be set from auth if not provided
  requestedResolution: ReturnResolutionSchema,
  customerNotes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    variantId: z.string().optional(),
    productName: z.string().min(1),
    variantName: z.string().optional(),
    sku: z.string().optional(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().int().nonnegative(),
    reason: ReturnReasonSchema,
    reasonDetails: z.string().optional(),
    images: z.array(z.string().url()).optional(),
  })).min(1),
});

export const UpdateReturnRequestSchema = z.object({
  requestedResolution: ReturnResolutionSchema.optional(),
  customerNotes: z.string().optional(),
  adminNotes: z.string().optional(),
});

export const ApproveReturnSchema = z.object({
  resolution: ReturnResolutionSchema,
  adminNotes: z.string().optional(),
  generateLabel: z.boolean().optional().default(true),
});

export const RejectReturnSchema = z.object({
  reason: z.string().min(1),
  adminNotes: z.string().optional(),
});

export const ReceiveReturnSchema = z.object({
  receivedBy: z.string().optional(),
  notes: z.string().optional(),
  itemsReceived: z.array(z.object({
    itemId: z.number().int().positive(),
    quantityReceived: z.number().int().nonnegative(),
    condition: z.string().optional(),
  })).optional(),
});

// ===========================================
// RETURN ITEM SCHEMAS
// ===========================================

export const AddReturnItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  productName: z.string().min(1),
  variantName: z.string().optional(),
  sku: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  reason: ReturnReasonSchema,
  reasonDetails: z.string().optional(),
  images: z.array(z.string().url()).optional(),
});

export const UpdateReturnItemSchema = z.object({
  quantityReturning: z.number().int().positive().optional(),
  reason: ReturnReasonSchema.optional(),
  reasonDetails: z.string().optional(),
  images: z.array(z.string().url()).optional(),
});

export const SetItemDispositionSchema = z.object({
  disposition: ReturnDispositionSchema,
  locationId: z.string().optional(),
  locationName: z.string().optional(),
  recoveredValue: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

// ===========================================
// RETURN LABEL SCHEMAS
// ===========================================

export const GenerateLabelSchema = z.object({
  carrier: z.string().min(1),
  paidBy: z.enum(['customer', 'merchant']).optional().default('merchant'),
  expiresInDays: z.number().int().positive().optional().default(30),
});

export const MarkShippedSchema = z.object({
  trackingNumber: z.string().min(1),
  trackingUrl: z.string().url().optional(),
  carrier: z.string().optional(),
});

// ===========================================
// INSPECTION SCHEMAS
// ===========================================

export const SubmitInspectionSchema = z.object({
  overallResult: InspectionResultSchema,
  notes: z.string().optional(),
  photos: z.array(z.string().url()).optional(),
  itemResults: z.array(z.object({
    itemId: z.number().int().positive(),
    result: InspectionResultSchema,
    notes: z.string().optional(),
    condition: z.string().optional(),
  })).optional(),
});

// ===========================================
// REFUND SCHEMAS
// ===========================================

export const CreateRefundSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).optional().default('USD'),
  refundType: RefundTypeSchema,
  refundTo: z.enum(['original_payment', 'wallet', 'bank_account']).optional().default('original_payment'),
  reason: z.string().optional(),
});

export const ProcessRefundSchema = z.object({
  provider: PaymentProviderSchema.optional(),
  walletId: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

// ===========================================
// EXCHANGE SCHEMAS
// ===========================================

export const CreateExchangeSchema = z.object({
  items: z.array(z.object({
    originalProductId: z.string().min(1),
    originalVariantId: z.string().optional(),
    newProductId: z.string().min(1),
    newVariantId: z.string().optional(),
    newProductName: z.string().min(1),
    newVariantName: z.string().optional(),
    quantity: z.number().int().positive(),
    originalPrice: z.number().int().nonnegative(),
    newPrice: z.number().int().nonnegative(),
  })).min(1),
});

export const UpdateExchangeSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive().optional(),
    originalProductId: z.string().min(1),
    originalVariantId: z.string().optional(),
    newProductId: z.string().min(1),
    newVariantId: z.string().optional(),
    newProductName: z.string().min(1),
    newVariantName: z.string().optional(),
    quantity: z.number().int().positive(),
    originalPrice: z.number().int().nonnegative(),
    newPrice: z.number().int().nonnegative(),
  })).optional(),
  status: ExchangeStatusSchema.optional(),
});

// ===========================================
// QUERY SCHEMAS
// ===========================================

export const ReturnListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: ReturnRequestStatusSchema.optional(),
  userId: z.string().optional(),
  orderId: z.string().optional(),
  resolution: ReturnResolutionSchema.optional(),
  reason: ReturnReasonSchema.optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const RefundListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: RefundStatusSchema.optional(),
  returnId: z.coerce.number().int().positive().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

// ===========================================
// TYPE EXPORTS
// ===========================================

export type CreateReturnPolicy = z.infer<typeof CreateReturnPolicySchema>;
export type UpdateReturnPolicy = z.infer<typeof UpdateReturnPolicySchema>;
export type CreateReturnRequest = z.infer<typeof CreateReturnRequestSchema>;
export type UpdateReturnRequest = z.infer<typeof UpdateReturnRequestSchema>;
export type ApproveReturn = z.infer<typeof ApproveReturnSchema>;
export type RejectReturn = z.infer<typeof RejectReturnSchema>;
export type ReceiveReturn = z.infer<typeof ReceiveReturnSchema>;
export type AddReturnItem = z.infer<typeof AddReturnItemSchema>;
export type UpdateReturnItem = z.infer<typeof UpdateReturnItemSchema>;
export type SetItemDisposition = z.infer<typeof SetItemDispositionSchema>;
export type GenerateLabel = z.infer<typeof GenerateLabelSchema>;
export type MarkShipped = z.infer<typeof MarkShippedSchema>;
export type SubmitInspection = z.infer<typeof SubmitInspectionSchema>;
export type CreateRefund = z.infer<typeof CreateRefundSchema>;
export type ProcessRefund = z.infer<typeof ProcessRefundSchema>;
export type CreateExchange = z.infer<typeof CreateExchangeSchema>;
export type UpdateExchange = z.infer<typeof UpdateExchangeSchema>;
export type ReturnListQuery = z.infer<typeof ReturnListQuerySchema>;
export type RefundListQuery = z.infer<typeof RefundListQuerySchema>;

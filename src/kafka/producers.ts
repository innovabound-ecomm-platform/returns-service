/**
 * Kafka Event Producers for Returns Service
 * 
 * Emits events for return lifecycle changes.
 */

import { logger } from "../config/logger.js";
import { producer } from "./index.js";

// ===========================================
// RETURN EVENT PRODUCERS
// ===========================================

export interface ReturnRequestedEvent {
  returnId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  email: string;
  firstName: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    reason: string;
  }>;
  requestedAt: string;
}

export async function emitReturnRequested(data: ReturnRequestedEvent): Promise<void> {
  logger.info("Emitting return.requested event", { 
    returnId: data.returnId,
    orderId: data.orderId,
  });
  
  await producer.send("return.requested", data);
}

export interface ReturnApprovedEvent {
  returnId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  email: string;
  firstName: string;
  returnLabel?: string;
  returnInstructions?: string;
  approvedAt: string;
}

export async function emitReturnApproved(data: ReturnApprovedEvent): Promise<void> {
  logger.info("Emitting return.approved event", { 
    returnId: data.returnId,
    orderId: data.orderId,
  });
  
  await producer.send("return.approved", data);
}

export interface ReturnRejectedEvent {
  returnId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  email: string;
  firstName: string;
  reason: string;
  rejectedAt: string;
}

export async function emitReturnRejected(data: ReturnRejectedEvent): Promise<void> {
  logger.info("Emitting return.rejected event", { 
    returnId: data.returnId,
    orderId: data.orderId,
  });
  
  await producer.send("return.rejected", data);
}

export interface ReturnReceivedEvent {
  returnId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  email: string;
  firstName: string;
  receivedAt: string;
  inspectionStatus?: "PENDING" | "PASSED" | "FAILED";
}

export async function emitReturnReceived(data: ReturnReceivedEvent): Promise<void> {
  logger.info("Emitting return.received event", { 
    returnId: data.returnId,
    orderId: data.orderId,
  });
  
  await producer.send("return.received", data);
}

export interface ReturnCompletedEvent {
  returnId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  email: string;
  firstName: string;
  refundAmount: number;
  refundMethod: string;
  completedAt: string;
}

export async function emitReturnCompleted(data: ReturnCompletedEvent): Promise<void> {
  logger.info("Emitting return.completed event", { 
    returnId: data.returnId,
    orderId: data.orderId,
    refundAmount: data.refundAmount,
  });
  
  await producer.send("return.completed", data);
}

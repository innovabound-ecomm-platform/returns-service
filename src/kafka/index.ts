/**
 * Kafka Client Setup for Returns Service
 * 
 * Produces return lifecycle events for email/notification services.
 */

import { createKafkaClient, createProducer } from "@innovabound-ecomm-platform/kafka-client";
import { config } from "../config/index.js";

const kafkaClient = createKafkaClient(config.kafka.clientId);

export const producer = createProducer(kafkaClient);

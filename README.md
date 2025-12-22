# Returns Service

Returns and RMA (Return Merchandise Authorization) management service for the e-commerce platform. Handles the complete return lifecycle including return requests, shipping labels, inspections, refunds, and exchanges.

## Features

- **Return Requests**: Create and manage RMA requests with automatic status workflow
- **Return Policies**: Configurable return windows, fees, and conditions
- **Shipping Labels**: Generate and track return shipping labels
- **Inspections**: Warehouse inspection workflow with disposition management
- **Refunds**: Process refunds to original payment method or store credit
- **Exchanges**: Handle product exchanges with price difference handling
- **Audit History**: Complete audit trail of all return actions

## Architecture

This service follows the microservices architecture pattern:
- Uses `@innovabound-ecomm-platform/returns-db` for database operations
- Publishes events via `@innovabound-ecomm-platform/kafka-client`
- Communicates with order-service, payment-service, and fulfillment-service

## Return Status Flow

```
PENDING → APPROVED → LABEL_GENERATED → SHIPPED → RECEIVED → INSPECTING → INSPECTED
                                                                              ↓
                                                      COMPLETED ← PROCESSING_REFUND
                                                          ↓
                                                       CLOSED
```

Alternative paths:
- `PENDING → REJECTED` (if return denied)
- `APPROVED → CANCELLED` (if customer cancels)

## API Endpoints

### Return Policies
- `GET /policies` - List return policies
- `GET /policies/:id` - Get policy details
- `POST /policies` - Create return policy (admin)
- `PUT /policies/:id` - Update policy (admin)
- `DELETE /policies/:id` - Delete policy (admin)

### Return Requests
- `GET /returns` - List return requests (admin) or user's returns
- `GET /returns/:id` - Get return request details
- `POST /returns` - Create return request
- `PUT /returns/:id` - Update return request
- `POST /returns/:id/approve` - Approve return request (admin)
- `POST /returns/:id/reject` - Reject return request (admin)
- `POST /returns/:id/receive` - Mark return as received (admin)
- `POST /returns/:id/cancel` - Cancel return request
- `GET /returns/:id/history` - Get return history/timeline

### Return Items
- `GET /returns/:id/items` - List items in return request
- `POST /returns/:id/items` - Add item to return request
- `PUT /returns/:returnId/items/:itemId` - Update return item
- `DELETE /returns/:returnId/items/:itemId` - Remove return item

### Return Labels
- `POST /returns/:id/label` - Generate return shipping label
- `GET /returns/:id/label` - Get return label
- `POST /returns/:id/ship` - Mark return as shipped

### Inspections
- `POST /returns/:id/inspection` - Submit inspection results (admin)
- `GET /returns/:id/inspection` - Get inspection details
- `POST /returns/:returnId/items/:itemId/disposition` - Set item disposition

### Refunds
- `GET /refunds` - List refunds
- `GET /refunds/:id` - Get refund details
- `POST /returns/:id/refund` - Process refund for return
- `POST /refunds/:id/process` - Process pending refund (admin)

### Exchanges
- `POST /returns/:id/exchange` - Create exchange for return
- `GET /exchanges/:id` - Get exchange details
- `PUT /exchanges/:id` - Update exchange
- `POST /exchanges/:id/complete` - Complete exchange (admin)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | `3010` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `KAFKA_BROKERS` | Kafka broker addresses | - |
| `AUTH_SERVICE_URL` | Auth service URL | - |

## Events Published

- `return.created` - When a return request is created
- `return.approved` - When a return is approved
- `return.rejected` - When a return is rejected
- `return.received` - When returned items are received
- `return.inspected` - When inspection is complete
- `return.completed` - When return is fully processed
- `refund.initiated` - When refund processing starts
- `refund.completed` - When refund is successful
- `refund.failed` - When refund fails
- `exchange.created` - When exchange is created
- `exchange.completed` - When exchange is fulfilled

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Lint code
pnpm lint
```

## Docker

```bash
# Build image
docker build -t returns-service .

# Run container
docker run -p 3010:3010 returns-service
```

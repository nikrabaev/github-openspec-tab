# Proposal: Refunds from receipts

## Why

Today a rider who was charged for a ride that never really happened has one way to get the money back: write to support. An agent opens the ride in the admin tool, checks the dock records by hand, and issues a refund through the payment provider's dashboard, which is a separate login. The whole thing takes three to five working days, and in September it made up 41% of all support conversations.

Most of these cases are not judgement calls. A bike that was returned to the same dock within two minutes was almost always faulty. A ride that ended because the station lost power is our fault. The data to decide is already in the ride record, and the rider is already looking at the receipt when they notice the problem.

Riders on a phone have it worst: the support form asks for the ride number, which is only shown in the receipt email, so they switch between two apps and retype a twelve-character code. A refund request that starts from the receipt removes that step entirely.

## What Changes

- A rider can ask for a refund from the receipt, in the app or from the receipt email, without contacting support.
- Requests that match one of four automatic reasons (returned within two minutes, dock fault, station outage, duplicate charge) are refunded at once, with no agent involved.
- Every other request goes to a review queue with the ride record, the dock events and the rider's refund history attached, so an agent decides from one screen.
- **BREAKING**: `POST /v2/refunds` no longer accepts an `amount`. The service works out the amount from the ride, so a client cannot ask for more than was charged.
- A refund is always made to the payment method that was charged. Refunds to ride credit are removed.
- The receipt shows the state of a refund request, and the rider is told when it changes.

## Capabilities

### New Capabilities

### Modified Capabilities
- `ride-billing`: refund requests, automatic refunds, the review queue and what a receipt shows about them.

## Impact

- `services/billing/src/refunds/request-handler.ts`, `services/billing/src/refunds/auto-rules.ts` (new) and `services/billing/src/refunds/amount.ts` (new)
- `services/billing/src/receipt-builder.ts`: the refund state on a receipt
- `apps/rider/src/screens/ReceiptScreen.tsx` and `apps/admin/src/pages/RefundQueue.tsx` (new)
- The `POST /v2/refunds` and `GET /v2/refunds/:id` API routes; the admin tool's "Refund" button is removed
- Payment provider webhooks: `refund.succeeded` and `refund.failed` are now handled

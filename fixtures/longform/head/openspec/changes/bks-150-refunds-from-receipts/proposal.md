# Proposal: Refunds from receipts

## Why

A rider who was charged for a ride that never really happened has one way to get the money back: write to support. An agent checks the dock records by hand and issues the refund in the payment provider's dashboard. It takes three to five working days, and in September it made up 41% of all support conversations. Most of these cases are not judgement calls, and the data to decide them is already in the ride record.

## What Changes

- **A rider can ask for a refund from the receipt**, in the app or from the receipt email, without contacting support. The rider chooses one reason from a fixed list and is asked nothing else: not the ride number, not the amount. Asking twice for the same ride and reason returns the request that already exists.
- **Obvious cases are refunded at once.** A request that matches one of four automatic rules (returned within two minutes, dock fault, station outage, duplicate charge) is refunded with no agent involved. The rules are checked in a fixed order and the first that matches decides. "Returned within two minutes" applies at most three times a month per rider.
- **Every other request goes to a review queue**, oldest first, with the ride record, the dock events and the rider's refund history attached, so an agent decides from one screen. A decision records who made it and why. A request nobody has opened for two working days is raised to the support lead.
- **The service works out the amount.** `POST /v2/refunds` takes a ride and a reason and nothing else; it refunds what was charged for that ride minus anything already refunded. For a group ride the request names one bike's ride, and only that line of the receipt is refunded.
- **A refund always goes back to the payment method that was charged.** Refunds to ride credit are removed. They were 2% of all refunds and confused riders, who then asked for the money anyway.
- **The receipt shows the state of a request** beside the charge it belongs to (requested, being reviewed, refunded, declined), and the rider is told when it changes. A refunded charge no longer counts towards the daily fare cap.
- **Provider events are handled.** `refund.succeeded` and `refund.failed` move a request to its final state. An event is matched to its request by idempotency key, so one that arrives early, late or twice changes nothing it should not.
- **Data model:** two new tables, `refund_requests` and `refund_rules`, and one new column, `charges.refunded_amount`. Nothing is dropped or rebuilt.

**BREAKING**: `POST /v2/refunds` no longer accepts an `amount`. A client that sends one gets a 400. The rider app before 6.2 never called this route, so only the admin tool is affected, and its "Refund" button is removed by this change.

## Capabilities

### New Capabilities
- `refund-review`: how a request that no automatic rule approved reaches an agent and is decided: what the queue lists and in which order, what the review screen attaches to a request (the ride record, the dock events, the rider's refund history), who may approve or decline, what a decision records, and what happens to a request nobody has opened for two working days. Refund review has no spec today; this change gives the area its first.
- `payment-provider-refund-webhooks`: what the service does with the provider's `refund.succeeded` and `refund.failed` events: how an event finds its request (by idempotency key, never by amount), which request states accept it, why a repeated or late event changes nothing, and what is recorded when an event matches no request at all.

### Modified Capabilities
- `ride-billing`: "Daily fare cap" no longer counts a refunded charge, so a rider whose earlier ride was refunded is charged for later rides until the cap is reached again; two new requirements cover asking from the receipt and the automatic rules, including the order in which the rules are checked.
- `rider-notifications`: gains "Refund decided", sent when a request is `refunded` or `declined`. "Receipt email" learns the link that starts a request; the link names the ride and never carries the rider's session.
- `receipts`: "A receipt lists every charge of the ride" also shows the state of a refund request beside the charge it belongs to, and shows the total again with the refund next to it.

## Impact

- **billing service**: the request handler (`services/billing/src/refunds/`) is new, with the automatic rules (`services/billing/src/refunds/auto-rules.ts`) and the amount calculation beside it; the receipt builder (`services/billing/src/receipt-builder.ts`) reads the request state; a migration adds the two tables and the column.
- **api**: `POST /v2/refunds` and `GET /v2/refunds/:id` change shape as described above; the provider webhook route gains two event kinds.
- **rider app**: the receipt screen (`apps/rider/src/screens/ReceiptScreen.tsx`) gets "Something wrong with this charge?" and the state of a request; no other screen changes.
- **admin tool**: the review queue (`apps/admin/src/pages/RefundQueue.tsx`) is new; the "Refund" button on the ride page is removed; the rules page shows which rules are on, and who switched one off and when.
- **notifications**: one new template, "Refund decided", in the app and by email.
- **docs**: the glossary gains "refund request", "automatic rule" and "review queue"; the support handbook's refund chapter is rewritten.
- **Dependencies, outside this change**: automatic refunds are only as good as the dock events they read. BKS-139 (dock fault reports arrive late from older stations) should be settled before the "dock fault" rule is switched on. It is not part of this change.
- **Risks the design addresses**: a rider who learns the two-minute rule and uses it for free short rides; a provider event that arrives before our own call returns; a rule switched off during an incident and never switched back on. The design section "Risks / Trade-offs" says how each is held in check.

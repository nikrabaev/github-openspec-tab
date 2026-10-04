# Design: Refunds from receipts

## Context

A charge is created when a ride ends, and the receipt is built from the charge. Refunds exist today only as a manual action in the admin tool, which calls the payment provider directly and writes a note on the ride. Nothing in our own database records that a refund was asked for, who decided it or why, so the receipt cannot show it and support cannot see a rider's history without opening the provider's dashboard.

The billing service runs as three instances behind a queue. Charges are idempotent by ride id. The payment provider retries webhooks for up to three days and does not promise their order, so `refund.succeeded` can arrive before our own request to create the refund has returned.

## Goals / Non-Goals

**Goals:**
- A rider with an obviously wrong charge gets the money back without talking to anyone, and sees that it happened on the receipt within a minute of asking.
- An agent decides every other request from one screen, with the ride record, the dock events and the rider's refund history already attached.
- No request can refund more than was charged, however many times it is sent and from however many devices.

**Non-Goals:**
- Partial refunds chosen by the rider. The amount is always worked out by the service.
- Refunds for passes. Those keep their own flow in the account settings.
- Detecting fraud beyond a simple limit on automatic refunds per rider per month.

## Decisions

### Decision: A refund request is its own record, separate from the charge

The request is created the moment the rider asks, before anything is decided. It holds the ride, the reason the rider chose, the amount the service worked out, and a state: `requested`, `approved`, `sent`, `refunded`, `declined` or `failed`. The charge is not changed until the provider confirms the refund, and then only its `refunded_amount` is updated in the same transaction that moves the request to `refunded`.

Keeping the request apart from the charge means the receipt can show "refund requested" before any money has moved, and a declined request leaves a trace that support can read later. It also gives the review queue something to list: every request in `requested` that no automatic rule approved.

**With several instances:** two instances can pick up the same request from the queue. The handler takes a row lock on the request, re-reads its state and stops if it is no longer `requested`. The provider call carries the request id as its idempotency key, so even a crash between the call and the commit cannot send the money twice.

**Alternatives considered:**
- A `refund_state` column on the charge. Rejected: a charge can have a declined request and later an approved one, and one column cannot hold that history.
- Calling the provider first and recording the result afterwards. Rejected: a crash in between leaves money moved with nothing in our database to say why.

### Decision: Automatic rules are data, checked in a fixed order

Each rule is a row: a name, the reason it answers, and a predicate over the ride record written as a small set of comparisons (`duration_seconds < 120`, `end_dock = start_dock`, `dock_fault_reported = true`). The handler runs the rules in the order of the table below and stops at the first that matches. A request that matches no rule goes to the review queue.

Rules being rows rather than code means support can switch one off during an incident without a deploy, and the review screen can show which rule a request nearly matched and why it did not.

| Rule | Matches when | Checked against | Limit |
| --- | --- | --- | --- |
| `returned_quickly` | the bike was docked again within 120 seconds at the dock it left | `rides.duration_seconds`, `rides.start_dock_id`, `rides.end_dock_id` | 3 a month per rider |
| `dock_fault` | a fault was reported for the start dock within 10 minutes of the unlock | `dock_events.kind = 'fault'`, `dock_events.reported_at` | none |
| `station_outage` | the station was marked out of service at any point during the ride | `station_status_history.state = 'out_of_service'` | none |
| `duplicate_charge` | another charge exists for the same ride id | `charges.ride_id`, `charges.state = 'succeeded'` | none |

**Alternatives considered:**
- Hard-coded rules. Rejected: the first incident after launch would need a deploy to stop automatic refunds.
- A general rules engine. Rejected: four rules do not justify a new dependency, and the predicates must stay simple enough for support to read.

### Decision: The amount is always worked out by the service

`POST /v2/refunds` takes a ride id and a reason, nothing else. The service refunds what was charged for that ride minus anything already refunded, and never more. This removes a whole class of mistake (a client rounding differently, an old app version sending a stale amount) and makes the request idempotent by ride id and reason.

For a group ride the request names one bike's ride, and only that line of the receipt is refunded. The other lines are untouched, and the receipt total is shown again with the refund beside it.

**Alternatives considered:**
- Keep `amount` and reject a value above what was charged. Rejected: the client still has to know the right amount, and every old app version becomes a source of 400s.

### Decision: The receipt reads the request, never the provider

The receipt builder shows a refund from our own `refund_requests` row: its state, its amount and the time it last changed. It never asks the payment provider. A receipt is opened far more often than a refund changes, the provider's API is slow and rate limited, and a receipt that cannot be shown because a third party is down is a worse failure than one that is a minute behind.

The price is that the receipt can lag: between the provider sending the money and its `refund.succeeded` event reaching us, the receipt still says "Refund being sent". That gap is seconds on a normal day. If the event has not arrived after an hour, a sweep asks the provider for that one refund by idempotency key and applies the answer as if the event had come, so a lost event cannot leave a receipt wrong for good.

**With several instances:** the sweep runs on every instance, and two can pick the same request. Applying the provider's answer goes through the same handler as the event, under the same row lock, so the second one finds the request already `refunded` and stops.

**Alternatives considered:**
- Ask the provider when the receipt is opened and cache the answer. Rejected: the cache needs the same invalidation the events already give us, and adds a provider call to the most-opened screen in the app.

## Risks / Trade-offs

- [Risk] A rider learns the two-minute rule and uses it for free short rides → Mitigation: `returned_quickly` applies at most three times a month per rider, and only when the bike returns to the dock it left, which is no use for getting anywhere.
- [Risk] The provider's webhook arrives before our own call returns, and the handler does not find a request in `sent` → Mitigation: the webhook handler looks the request up by idempotency key and accepts `approved` as well as `sent`; either moves to `refunded`.
- [Risk] Support switches a rule off and forgets to switch it back on → Mitigation: a rule that is off shows a banner on the review queue with who switched it off and when.
- [Trade-off] Removing refunds to ride credit means every refund costs us a provider fee → Mitigation: accepted; ride credit refunds were 2% of the total and confused riders who then asked for the money anyway.

## Migration Plan

1. Ship the `refund_requests` and `refund_rules` tables, with the four rules present and switched off.
2. Ship the request handler and the review queue. All requests go to the queue while the rules are off, which lets support compare their own decisions with what each rule would have done.
3. Switch the rules on one at a time over two weeks, `duplicate_charge` first.
4. Remove the admin tool's "Refund" button once a week has passed with no request made through it.

## Open Questions

- Should a declined request be final, or can the rider ask again with a different reason?
- Do we tell the rider which rule approved the refund, or only that it was approved?

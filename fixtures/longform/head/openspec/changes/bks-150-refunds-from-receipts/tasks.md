# Tasks

## 1. Data model

- [x] 1.1 Add the `refund_requests` table with the six states, the worked-out amount and the idempotency key, and a partial unique index on (ride_id, reason) for requests that are not declined or failed
- [x] 1.2 Add the `refund_rules` table and seed the four rules, switched off, with their limits
- [ ] 1.3 Add `refunded_amount` to charges, defaulting to zero, and backfill it from the provider's export for refunds made by hand this year

## 2. Request handler

- [ ] 2.1 Accept `POST /v2/refunds` with a ride id and a reason; reject a body that carries an `amount` with 422 and a message that says the service works it out
- [ ] 2.2 Work out the amount from the charge minus what was already refunded, per bike for a group ride
- [ ] 2.3 Run the rules in table order under a row lock on the request, and stop at the first match
- [ ] 2.4 Call the provider with the request id as the idempotency key, and move the request to `sent` in the same transaction
- [ ] 2.5 Handle `refund.succeeded` and `refund.failed` webhooks in any order, looking the request up by idempotency key

## 3. Review queue

- [ ] 3.1 List requests in `requested` that no rule approved, oldest first, with the ride record, dock events and the rider's refund history on one screen
- [ ] 3.2 Show which rule each request came closest to matching and which comparison failed
- [ ] 3.3 Let an agent approve or decline with a reason, and record who decided and when
- [ ] 3.4 Show a banner for every rule that is switched off, with who switched it off and when

## 4. Rider app and receipt

- [ ] 4.1 Add "Something wrong with this charge?" to the receipt screen and to the receipt email, leading to the four reasons and "Something else"
- [ ] 4.2 Show the state of a refund request on the receipt, and the refunded amount beside the total once it is refunded
- [ ] 4.3 Send a push notification and an email when a request is approved, declined or fails

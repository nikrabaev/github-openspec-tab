## ADDED Requirements

### Requirement: A provider event finds its request by idempotency key
The system SHALL match a `refund.succeeded` or `refund.failed` event to a refund request by the idempotency key the request was sent with, and MUST NOT match by amount or by ride. An event SHALL be accepted when the request is `approved` or `sent`; in any other state the event MUST change nothing.

#### Scenario: The event arrives before our own call returns
- **WHEN** `refund.succeeded` arrives while the request is still `approved`
- **THEN** the request moves to `refunded`

#### Scenario: The same event arrives twice
- **WHEN** `refund.succeeded` arrives for a request that is already `refunded`
- **THEN** nothing changes
- **AND** the event is acknowledged so the provider stops retrying

#### Scenario: An event matches no request
- **WHEN** an event carries an idempotency key that no request holds
- **THEN** the event is recorded for support to look at
- **AND** no charge is changed

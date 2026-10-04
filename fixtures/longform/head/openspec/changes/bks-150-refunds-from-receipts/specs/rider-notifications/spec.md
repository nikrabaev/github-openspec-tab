## ADDED Requirements

### Requirement: Refund decided
The system SHALL tell the rider, in the app and by email, when a refund request is refunded or declined. The message for a declined request MUST say how to reach support.

#### Scenario: A request is refunded
- **WHEN** a request moves to `refunded`
- **THEN** the rider is told the amount and the payment method it went back to

#### Scenario: A request is declined
- **WHEN** an agent declines a request
- **THEN** the rider is told that it was declined and how to reach support

## MODIFIED Requirements

### Requirement: Receipt email
The system SHALL email the rider a receipt when a ride ends. The email SHALL include a link that starts a refund request for that ride; the link MUST name the ride and MUST NOT carry the rider's session.

#### Scenario: Ride ends
- **WHEN** a ride ends
- **THEN** the rider is emailed the receipt within five minutes

#### Scenario: Opening the refund link while signed out
- **WHEN** a rider who is signed out opens the refund link in a receipt email
- **THEN** the rider is asked to sign in before the reasons are shown

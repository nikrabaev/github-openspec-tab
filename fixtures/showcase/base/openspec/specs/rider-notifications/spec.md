# rider-notifications Specification

## Purpose
Defines the messages riders receive about their rides and passes.

## Requirements

### Requirement: Ride receipt
The system SHALL send a receipt by email within 5 minutes of the end of a ride.

#### Scenario: Ride ends
- **WHEN** a ride ends
- **THEN** the rider receives a receipt by email within 5 minutes

#### Scenario: Email bounces
- **WHEN** the receipt email bounces
- **THEN** the receipt is shown in the app on next launch

### Requirement: Pass expiry reminder
The system SHALL remind a rider 3 days before a pass expires.

#### Scenario: Pass about to expire
- **WHEN** a pass expires in 3 days
- **THEN** the rider receives a push notification

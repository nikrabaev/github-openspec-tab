# rider-notifications Specification

## Purpose
Defines what a rider is told, and when: receipts, ride reminders and account messages.

## Requirements

### Requirement: Receipt email
The system SHALL email the rider a receipt when a ride ends.

#### Scenario: Ride ends
- **WHEN** a ride ends
- **THEN** the rider is emailed the receipt within five minutes

### Requirement: Long ride reminder
The system SHALL remind a rider whose ride has lasted more than two hours that the ride is still running.

#### Scenario: Two hours pass
- **WHEN** a ride has lasted two hours
- **THEN** the rider gets a reminder in the app

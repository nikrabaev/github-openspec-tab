# rider-notifications Specification

## Purpose
Defines the messages riders receive about their rides and passes.

## Requirements

### Requirement: Ride receipt
The system SHALL send a receipt by email or push notification, whichever the rider chose, within 2 minutes of the end of a ride.

#### Scenario: Ride ends
- **WHEN** a ride ends
- **THEN** the rider receives a receipt on their chosen channel within 2 minutes

#### Scenario: Rider chose push
- **WHEN** a ride ends for a rider who chose push notifications
- **THEN** the receipt arrives as a push notification
- **AND** the full receipt is in the app

### Requirement: Pass expiry reminder
The system SHALL remind a rider 3 days before a pass expires.

#### Scenario: Pass about to expire
- **WHEN** a pass expires in 3 days
- **THEN** the rider receives a push notification

### Requirement: Overdue bike warning
The system SHALL warn a rider when a bike has been out for 12 hours.

#### Scenario: Bike out for 12 hours
- **WHEN** a bike has been out for 12 hours
- **THEN** the rider receives a push notification and an email

# ride-billing Specification

## Purpose
Defines how a ride is priced: the per-minute fare, pass discounts and the daily cap.

## Requirements

### Requirement: Per-minute fare
The system SHALL charge each ride by the minute, rounded up, at the fare of the bike type.

#### Scenario: Ride on a classic bike
- **WHEN** a rider ends a 12 minute 20 second ride on a classic bike
- **THEN** the ride is charged for 13 minutes at the classic fare

### Requirement: Daily fare cap
The system SHALL stop charging a rider once the rider's ride charges for the day reach the daily cap.

#### Scenario: Cap reached
- **WHEN** a rider's charges for the day reach the daily cap
- **THEN** further rides that day are not charged

### Requirement: Pass discounts
The system SHALL apply the discount of the rider's pass to every ride charge.

#### Scenario: Monthly pass
- **WHEN** a rider with a monthly pass ends a ride
- **THEN** the first 30 minutes are free

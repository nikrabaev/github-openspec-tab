# receipts Specification

## Purpose
Defines what a receipt shows for a ride and where a rider can open it.

## Requirements

### Requirement: A receipt lists every charge of the ride
The system SHALL list on a receipt every charge of the ride, with its amount and the bike it was for.

#### Scenario: A ride with one bike
- **WHEN** a rider opens the receipt of a ride with one bike
- **THEN** the receipt shows one charge and the total

### Requirement: Receipts stay available
The system SHALL keep a ride's receipt available in the app for at least two years.

#### Scenario: An old ride
- **WHEN** a rider opens the ride history and chooses a ride from last year
- **THEN** the receipt of that ride is shown

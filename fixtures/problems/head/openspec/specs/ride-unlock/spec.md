# ride-unlock Specification

## Purpose
Defines how a rider unlocks a bike at a dock, what the rider sees when an unlock fails, and what the system records about each attempt.

## Requirements

### Requirement: Unlock by QR code
The system SHALL unlock a docked bike when a rider with an active pass scans the bike's QR code in the app.

#### Scenario: Successful unlock
- **WHEN** a rider with an active pass scans the QR code of a docked bike
- **THEN** the dock releases the bike within 3 seconds
- **AND** a ride starts for that rider

#### Scenario: No active pass
- **WHEN** a rider without an active pass scans a QR code
- **THEN** the bike stays locked
- **AND** the app offers to buy a pass

### Requirement: Unlock failure feedback
The system SHALL tell the rider why an unlock failed and what to do next.

#### Scenario: Dock does not respond
- **WHEN** the dock does not confirm the release within 10 seconds
- **THEN** the app shows "This dock is not responding"
- **AND** the app suggests the nearest bike at the same station

### Requirement: Unlock with a station PIN
The system SHALL let a rider unlock a bike by typing a 6-digit PIN on the station keypad.

#### Scenario: Valid PIN
- **WHEN** a rider types a valid PIN on the station keypad
- **THEN** the station releases the first available bike

### Requirement: Reservation hold
The system SHALL keep a held bike locked to other riders for up to 10 minutes.

#### Scenario: Another rider scans a held bike
- **WHEN** a rider scans a bike that is held for someone else
- **THEN** the bike stays locked
- **AND** the app shows when the hold ends

### Requirement: Unlock audit trail
The system MUST record every unlock attempt with the rider, bike, dock, outcome and time.

#### Scenario: Failed attempt is recorded
- **WHEN** an unlock attempt fails
- **THEN** the attempt is recorded with its failure reason

### Requirement: Low battery lockout
The system SHALL NOT unlock an e-bike whose battery is below 10%.

#### Scenario: Battery too low
- **WHEN** a rider scans an e-bike with a battery below 10%
- **THEN** the bike stays locked
- **AND** the app explains that the bike needs charging

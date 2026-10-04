## MODIFIED Requirements

### Requirement: Unlock by QR code
The system SHALL unlock a docked bike when a rider with an active pass scans the bike's QR code in the app. A rider who leads a **group ride** MAY unlock up to 4 bikes with one pass; every extra bike MUST be at the same station as the first.

#### Scenario: Successful unlock
- **WHEN** a rider with an active pass scans the QR code of a docked bike
- **THEN** the dock releases the bike within 2 seconds
- **AND** a ride starts for that rider

#### Scenario: No active pass
- **WHEN** a rider without an active pass scans a QR code
- **THEN** the bike stays locked
- **AND** the app offers to buy a pass

#### Scenario: Leader unlocks a second bike
- **GIVEN** a rider has started a group ride
- **WHEN** the rider scans a second bike at the same station
- **THEN** the dock releases the bike
- **AND** the bike is added to the group ride

### Requirement: Unlock failure feedback
The system SHALL tell the rider why an unlock failed and what to do next, using the codes in [the unlock error table](docs/unlock-errors.md).

#### Scenario: Dock does not respond
- **WHEN** the dock does not confirm the release within 5 seconds
- **THEN** the app shows "This dock is not responding" with the code `DOCK_TIMEOUT`
- **AND** the app suggests the nearest bike at the same station

#### Scenario: Group limit reached
- **WHEN** a group ride leader scans a fifth bike
- **THEN** the bike stays locked
- **AND** the app shows "A group ride can have up to 4 bikes"

## ADDED Requirements

### Requirement: Group bikes come from one station
The system SHALL refuse to add a bike to a group ride when the bike is at a different station from the leader's first bike.

#### Scenario: Bike at another station
- **WHEN** a group ride leader scans a bike at a different station
- **THEN** the bike stays locked
- **AND** the app explains that the bikes of a group ride must come from one station

## REMOVED Requirements

### Requirement: Unlock with a station PIN
**Reason**: Station keypads are being retired. Fewer than 0.4% of unlocks used a PIN in the last quarter.
**Migration**: Riders unlock with the QR code. Stations show a notice with a link to install the app until the keypads are removed.

## RENAMED Requirements

- FROM: `### Requirement: Reservation hold`
- TO: `### Requirement: Bike hold`

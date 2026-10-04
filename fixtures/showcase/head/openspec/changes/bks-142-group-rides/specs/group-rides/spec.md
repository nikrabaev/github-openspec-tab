## Purpose
Lets one rider take out several bikes at once for people riding together, and keeps those bikes together as one group ride for unlocking, tracking and billing.

## ADDED Requirements

### Requirement: Start a group ride
The system SHALL let a rider with an active pass start a group ride of 2 to 4 bikes from one station.

#### Scenario: Leader starts a group ride
- **WHEN** a rider chooses "Ride together" and scans a first bike
- **THEN** a group ride starts with that rider as leader
- **AND** the app shows how many more bikes can be added

### Requirement: End a group ride
The system SHALL end a group ride when its last bike is docked, and MUST end it automatically 24 hours after it started.

#### Scenario: Last bike docked
- **WHEN** the last bike of a group ride is docked
- **THEN** the group ride ends
- **AND** the leader receives the receipt

#### Scenario: Ride left open
- **WHEN** a group ride has been open for 24 hours
- **THEN** the system ends it
- **AND** bikes that are still out are reported as overdue

### Requirement: Guests ride without an account
The system SHALL NOT require the people on the extra bikes to have an account. The leader MUST confirm that each guest is at least 16 years old.

#### Scenario: Leader confirms a guest's age
- **WHEN** the leader adds a bike for a guest
- **THEN** the app asks the leader to confirm the guest's age
- **AND** the bike unlocks only after the confirmation

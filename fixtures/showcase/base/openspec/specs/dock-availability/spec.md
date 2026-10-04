# dock-availability Specification

## Purpose
Defines what riders are told about free bikes and free docks at each station.

## Requirements

### Requirement: Free dock count
The system SHALL show the number of free docks at each station, updated within 60 seconds of a change.

#### Scenario: Bike docked
- **WHEN** a bike is docked at a station
- **THEN** the free dock count of that station goes down by one within 60 seconds

### Requirement: Station out of service
The system SHALL mark a station as out of service when it has not reported for 5 minutes.

#### Scenario: Station stops reporting
- **WHEN** a station has not reported for 5 minutes
- **THEN** the station is shown as out of service
- **AND** its counts are hidden

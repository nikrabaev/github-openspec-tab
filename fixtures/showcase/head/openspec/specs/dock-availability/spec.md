# dock-availability Specification

## Purpose
Defines what riders are told about free bikes and free docks at each station.

## Requirements

### Requirement: Free dock count
The system SHALL show the number of free docks at each station, updated within 30 seconds of a change. Reserved docks MUST NOT be counted as free.

#### Scenario: Bike docked
- **WHEN** a bike is docked at a station
- **THEN** the free dock count of that station goes down by one within 30 seconds

#### Scenario: Dock reserved by another rider
- **WHEN** another rider reserves a dock at a station
- **THEN** the free dock count of that station goes down by one

### Requirement: Station out of service
The system SHALL mark a station as out of service when it has not reported for 5 minutes.

#### Scenario: Station stops reporting
- **WHEN** a station has not reported for 5 minutes
- **THEN** the station is shown as out of service
- **AND** its counts are hidden

### Requirement: Reserve a dock
The system SHALL let a rider on an active ride reserve one free dock at a station for up to 10 minutes.

#### Scenario: Dock reserved
- **WHEN** a rider on an active ride reserves a dock at a station with a free dock
- **THEN** one dock at that station is held for the rider for 10 minutes

#### Scenario: Reservation expires
- **WHEN** the rider has not docked within 10 minutes
- **THEN** the dock is released to other riders
- **AND** the rider is told the reservation ended

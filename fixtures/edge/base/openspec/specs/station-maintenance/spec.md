# station-maintenance Specification

## Purpose
Defines how stations and docks are taken out of service, repaired and returned to service.

## Requirements

### Requirement: Report a broken dock
The system SHALL let a rider report a broken dock from the app.

#### Scenario: Rider reports a dock
- **WHEN** a rider reports a dock as broken
- **THEN** the dock is flagged for inspection

### Requirement: Dock inspection deadline
The system SHALL assign every flagged dock to a technician within 24 hours.

#### Scenario: Dock flagged
- **WHEN** a dock is flagged for inspection
- **THEN** a technician is assigned within 24 hours

### Requirement: Station closure notice
The system SHALL show a notice in the app when a station is closed for repair.

#### Scenario: Station closed
- **WHEN** a station is closed for repair
- **THEN** the app shows the closure and the nearest open station

### Requirement: Repair log
The system MUST keep a log of every repair with the technician, the dock and the parts used.

#### Scenario: Repair finished
- **WHEN** a technician finishes a repair
- **THEN** the repair is added to the log

### Requirement: Spare parts stock
The system SHALL track the stock of spare parts per depot.

#### Scenario: Part used
- **WHEN** a part is used in a repair
- **THEN** the depot stock goes down by one

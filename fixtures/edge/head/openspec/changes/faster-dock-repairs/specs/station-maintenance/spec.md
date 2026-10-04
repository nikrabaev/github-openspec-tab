## Added requirements

### Requirement: Technician route
The system SHALL give each technician a route of the docks assigned to them for the day.

#### Scenario: Morning route
- **WHEN** a technician starts the day
- **THEN** the app shows the assigned docks in route order

Example payload, which is not a requirement:

```md
### Requirement: Not a real requirement
#### Scenario: Not real
```

## MODIFIED Requirements

### Requirement: Dock inspection SLA
The system SHALL assign every flagged dock to a technician within 8 hours.

#### Scenario: Dock flagged
- **WHEN** a dock is flagged for inspection
- **THEN** a technician is assigned within 8 hours

### Requirement: Report a Broken Dock
The system SHALL let a rider report a broken dock from the app, with a photo.

#### Scenario: Rider reports a dock
- **WHEN** a rider reports a dock as broken
- **THEN** the dock is flagged for inspection

### Requirement: Depot opening hours
The system SHALL show depot opening hours to technicians.

#### Scenario: Depot closed
- **WHEN** a depot is closed
- **THEN** the app shows when it opens

## REMOVED Requirements

* `### Requirement: Spare parts stock`

## RENAMED Requirements

- FROM: `### Requirement: Dock inspection deadline`
- TO: `### Requirement: Dock inspection SLA`

## ADDED Requirements

### Requirement: Closure reason
The system SHALL record why a station was closed.

#### Scenario: Station closed
- **WHEN** a station is closed
- **THEN** the reason is recorded

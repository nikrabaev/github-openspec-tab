## ADDED Requirements

### Requirement: Group ride charges
The system SHALL charge every bike of a group ride to the leader's payment method, as one line per bike on a single receipt.

#### Scenario: Three bikes, one receipt
- **WHEN** a leader ends a group ride with three bikes
- **THEN** the leader receives one receipt with three ride lines
- **AND** each line shows the bike, the duration and the charge

#### Scenario: One bike returned late
- **WHEN** one bike of a group ride is docked after the others
- **THEN** that bike is charged for its own duration

## MODIFIED Requirements

### Requirement: Daily fare cap
The system SHALL stop charging a rider once the rider's ride charges for the day reach the daily cap. In a group ride the cap MUST apply to each bike on its own, not to the group as a whole.

#### Scenario: Cap reached
- **WHEN** a rider's charges for the day reach the daily cap
- **THEN** further rides that day are not charged

#### Scenario: Group ride and the cap
- **WHEN** two bikes of a group ride each reach the daily cap
- **THEN** each bike stops being charged at the cap
- **AND** the receipt shows the cap applied twice

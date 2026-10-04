## MODIFIED Requirements

### Requirement: A receipt lists every charge of the ride
The system SHALL list on a receipt every charge of the ride, with its amount and the bike it was for. Beside a charge that has a refund request, the receipt SHALL show the state of that request. When a charge was refunded, the receipt MUST show the total again with the refunded amount next to it.

#### Scenario: A ride with one bike
- **WHEN** a rider opens the receipt of a ride with one bike
- **THEN** the receipt shows one charge and the total

#### Scenario: A charge with a request being reviewed
- **WHEN** a rider opens the receipt of a ride that has a refund request in the review queue
- **THEN** the charge shows "Refund being reviewed"

#### Scenario: A refunded charge
- **WHEN** a rider opens the receipt of a ride whose charge was refunded
- **THEN** the charge shows "Refunded"
- **AND** the total is shown again with the refunded amount next to it

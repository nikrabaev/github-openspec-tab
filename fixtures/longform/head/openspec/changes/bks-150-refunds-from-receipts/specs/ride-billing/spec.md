## ADDED Requirements

### Requirement: A rider can ask for a refund from the receipt
The system SHALL let a rider ask for a refund of a ride charge from that ride's receipt, in the app and from the receipt email, by choosing one reason from a fixed list. The system MUST NOT ask the rider for the ride number, the amount or any other detail it already holds. A rider SHALL be able to ask once per ride and reason; a second request for the same ride and reason MUST return the first request rather than create another.

#### Scenario: Asking from the receipt
- **WHEN** a rider opens a receipt and chooses "Something wrong with this charge?"
- **THEN** the app shows the reasons the rider can choose from
- **AND** choosing one creates a refund request for that ride without further questions

#### Scenario: Asking twice
- **WHEN** a rider asks for a refund of a ride with a reason they have already given for that ride
- **THEN** no new request is created
- **AND** the app shows the state of the request that already exists

### Requirement: Obvious cases are refunded without an agent
The system SHALL refund a request at once, with no agent involved, when the ride matches one of the automatic rules in the table below. Rules MUST be checked in the order shown, and the first that matches decides. A request that matches no rule SHALL go to the review queue.

| Rule | Matches when |
| --- | --- |
| Returned quickly | the bike was docked again within 2 minutes at the dock it left |
| Dock fault | a fault was reported for the start dock within 10 minutes of the unlock |
| Station outage | the station was out of service at any point during the ride |
| Duplicate charge | another successful charge exists for the same ride |

#### Scenario: Bike returned within two minutes
- **WHEN** a rider asks for a refund of a ride that ended within 2 minutes at the dock where it started
- **THEN** the charge is refunded in full
- **AND** the receipt shows the refund within one minute

#### Scenario: No rule matches
- **WHEN** a rider asks for a refund and no automatic rule matches the ride
- **THEN** the request is placed in the review queue
- **AND** the receipt shows that the request is being reviewed

#### Scenario: The monthly limit is reached
- **WHEN** a rider who already had 3 "returned quickly" refunds this month asks for another
- **THEN** the request is placed in the review queue instead of being refunded automatically

## MODIFIED Requirements

### Requirement: Daily fare cap
The system SHALL stop charging a rider once the rider's ride charges for the day reach the daily cap. A refunded charge MUST NOT count towards the cap, so a rider whose earlier ride was refunded is charged for later rides until the cap is reached again.

#### Scenario: Cap reached
- **WHEN** a rider's charges for the day reach the daily cap
- **THEN** further rides that day are not charged

#### Scenario: A refund lowers the day's total
- **WHEN** one of a rider's charges for the day is refunded after the cap was reached
- **THEN** the day's total goes down by the refunded amount
- **AND** the rider's next ride that day is charged until the cap is reached again

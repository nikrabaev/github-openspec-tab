# ride-unlock changes

### Requirement: Unlock telemetry
The system SHALL report unlock timings to the metrics service.

#### Scenario: Timing reported
- **WHEN** an unlock completes
- **THEN** its duration is reported

## MODIFIED Requirements

### Requirement: Unlock by QR Code
The system SHALL unlock a docked bike when a rider with an active pass scans the bike's QR code in the app, retrying once if the dock is slow.

#### Scenario: Successful unlock
- **WHEN** a rider with an active pass scans the QR code of a docked bike
- **THEN** the dock releases the bike within 3 seconds
- **AND** a ride starts for that rider

#### Scenario: No active pass
- **WHEN** a rider without an active pass scans a QR code
- **THEN** the bike stays locked
- **AND** the app offers to buy a pass

### Requirement: Unlock retry policy
The system SHALL retry an unlock once when the dock does not answer.

#### Scenario: Second attempt succeeds
- **WHEN** the dock does not answer the first request
- **THEN** the system sends the request again

### Requirement: Unlock failure feedback
The system SHALL tell the rider why an unlock failed and what to do next.

#### Scenario: Retry also fails
- **WHEN** the second attempt fails as well
- **THEN** the app shows "This dock is not responding"

## ADDED Requirements

### Requirement: Unlock rate limit
The app limits unlock attempts to 5 per minute for each rider.

### Scenario: Too many attempts
- **WHEN** a rider makes a sixth attempt within a minute
- **THEN** the attempt is refused

### Requirement: Unlock audit trail
The system MUST record every unlock attempt, including retries, with the rider, bike, dock, outcome and time.

#### Scenario: Retry is recorded
- **WHEN** an unlock is retried
- **THEN** both attempts are recorded

## REMOVED Requirements

### Requirement: Unlock with a keypad

## RENAMED Requirements

- FROM: `### Requirement: Reservation hold`
- FROM: `### Requirement: Low battery lockout`
- TO: `### Requirement: Battery lockout`

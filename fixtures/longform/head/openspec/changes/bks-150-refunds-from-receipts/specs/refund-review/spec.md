## ADDED Requirements

### Requirement: The queue lists every request no rule approved
The system SHALL list in the review queue every refund request in state `requested` that no automatic rule approved, oldest first. A request MUST leave the queue the moment it is approved or declined, and MUST NOT appear in it again.

#### Scenario: A request no rule matches
- **WHEN** a rider asks for a refund and no automatic rule matches the ride
- **THEN** the request appears at the end of the review queue

#### Scenario: A request is decided
- **WHEN** an agent approves or declines a request
- **THEN** the request is no longer listed in the queue

### Requirement: An agent decides a request from one screen
The system SHALL show, on the review screen of a request, the ride record, the dock events of that ride and the rider's earlier refund requests, so that an agent can decide without opening another tool. A decision MUST record the agent and a reason. Only a member of the support team SHALL be able to decide a request.

#### Scenario: Approving a request
- **WHEN** an agent approves a request and gives a reason
- **THEN** the request moves to `approved`
- **AND** the decision records the agent, the reason and the time

#### Scenario: Someone outside support opens the queue
- **WHEN** a signed-in person who is not in the support team opens the review queue
- **THEN** the queue is not shown

### Requirement: A request nobody opens is raised
The system SHALL raise a request to the support lead when it has been in the queue for two working days without being opened.

#### Scenario: Two working days pass
- **WHEN** a request has been in the queue for two working days and no agent has opened it
- **THEN** the support lead is notified
- **AND** the request is marked as raised in the queue

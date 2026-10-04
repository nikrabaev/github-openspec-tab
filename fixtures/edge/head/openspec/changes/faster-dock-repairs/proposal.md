# Proposal: Faster dock repairs

## Why

Broken docks stay out of service for more than a day on average, and riders find full stations with docks they cannot use.

## What Changes

- Flagged docks are assigned within 8 hours instead of 24.
- Technicians get a daily route.
- Spare parts stock moves to the depot system and leaves this spec.

## Capabilities

### New Capabilities

### Modified Capabilities
- `station-maintenance`: shorter inspection deadline, technician routes, closure reasons.

## Impact

- `services/maintenance/src/assignments.ts`

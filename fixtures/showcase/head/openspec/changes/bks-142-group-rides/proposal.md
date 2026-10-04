# Proposal: Group rides

## Why

Families and visitors ride together, but today every bike needs its own account and pass. In the August survey, 31% of the people who gave up at a station were trying to take out more than one bike. Letting one rider unlock bikes for the people with them removes the largest single reason riders walk away.

Dock firmware has supported releasing several bikes to one rider since version 4.2, so nothing blocks this on the hardware side.

## What Changes

- A rider can start a **group ride** and unlock up to 4 bikes from one station with one pass.
- All bikes of a group ride are billed to the leader on a single receipt.
- The daily cap applies per bike, not per group.
- **BREAKING**: Unlock with a station PIN is removed. Station keypads are retired.
- "Reservation hold" is renamed to "Bike hold" to match the wording in the app.

## Capabilities

### New Capabilities
- `group-rides`: starting, tracking and ending a ride with several bikes under one leader.

### Modified Capabilities
- `ride-unlock`: a group ride leader can unlock extra bikes; PIN unlock is removed; the hold requirement is renamed.
- `ride-billing`: group ride charges, and how the daily cap applies to them.

## Impact

- `services/unlock/src/unlock-handler.ts` and `services/unlock/src/group-session.ts` (new)
- `services/billing/src/receipt-builder.ts`: one receipt, many ride lines
- `apps/rider/src/screens/ScanScreen.tsx`: the "Ride together" entry point
- Dock firmware 4.2 or later; stations on older firmware keep single unlock
- The `POST /v2/unlocks` API gains an optional `groupRideId`

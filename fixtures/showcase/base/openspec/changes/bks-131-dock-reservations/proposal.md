# Proposal: Dock reservations

## Why

Riders arrive at a full station and have to ride on to find a free dock. It is the top complaint in the commuter survey. Holding a dock for the last minutes of a ride lets riders end the ride where they planned.

## What Changes

- A rider on an active ride can reserve a free dock at a station for up to 10 minutes.
- Reserved docks are shown as taken to other riders.
- Free dock counts update twice as fast, so a reservation is visible before another rider arrives.

## Capabilities

### New Capabilities

### Modified Capabilities
- `dock-availability`: free dock counts exclude reserved docks; a new requirement covers reserving a dock.

## Impact

- `services/stations/src/availability.ts`
- `apps/rider/src/screens/StationScreen.tsx`

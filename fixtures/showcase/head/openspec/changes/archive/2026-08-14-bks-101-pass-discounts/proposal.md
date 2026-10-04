# Proposal: Pass discounts

## Why

Monthly pass holders were charged the full fare for short rides, which made the pass poor value.

## What Changes

- Every ride charge takes the discount of the rider's pass into account.

## Capabilities

### New Capabilities

### Modified Capabilities
- `ride-billing`: a new requirement for pass discounts.

## Impact

- `services/billing/src/fare.ts`

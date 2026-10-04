# Design: Group rides

## Context

An unlock is one request from the app to the unlock service, which checks the pass and asks the dock to release the bike. A ride is created when the dock confirms. Nothing links two rides to each other today, and billing closes each ride on its own.

## Goals / Non-Goals

**Goals:**
- One rider unlocks up to 4 bikes in under 30 seconds in total.
- One receipt per group ride.
- No change for riders who never use group rides.

**Non-Goals:**
- Splitting the cost between riders.
- Group rides that start at different stations.
- Guest accounts or guest tracking.

## Decisions

### Decision: A group ride is a parent record over ordinary rides

Each bike still gets its own ride. A new `group_ride` record holds the leader and links the rides. Billing, the daily cap and overdue handling keep working per ride, and the receipt builder groups by `group_ride_id`.

**Alternatives considered:**
- One ride with several bikes. Rejected: every query that assumes one bike per ride would change, and a bike docked late would need a partial close.
- Grouping in the app only. Rejected: the receipt and the support tools need the link.

### Decision: The leader scans each bike

The leader scans every bike, one after another. The app keeps the scanner open and shows a counter.

**Alternatives considered:**
- Pick a number and let the station release that many bikes. Rejected: a station cannot promise which bikes it releases, and a rider may be handed a bike with a flat tyre.

### Decision: The server enforces the same-station rule

The unlock service compares the station of each new bike with the station of the first bike. The app does not decide.

## Risks / Trade-offs

- [Risk] One stolen phone can now release four bikes → Mitigation: the first group ride of an account needs a card check, and the limit is 2 bikes for accounts younger than 7 days.
- [Risk] Docks on firmware older than 4.2 reject a second release within 60 seconds → Mitigation: the app hides "Ride together" at stations that report older firmware.
- [Trade-off] The daily cap applies per bike, so a group can pay up to four caps → Mitigation: the confirmation screen says so before the first scan.
- Receipts with many lines are longer than the current email template allows.

## Migration Plan

1. Ship the `group_ride` table and the nullable `group_ride_id` on rides.
2. Enable for staff accounts, then for 5% of riders.
3. Remove the PIN keypad code path once the keypads are physically disabled.

## Open Questions

- Should a guest under 16 be allowed when the leader is their guardian?
- Do we refund the unlock fee when a group bike is returned within 2 minutes?

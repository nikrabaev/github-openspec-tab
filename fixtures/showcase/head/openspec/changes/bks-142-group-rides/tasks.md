# Tasks

## 1. Data model

- [x] 1.1 Add the `group_ride` table and migration
- [x] 1.2 Add nullable `group_ride_id` to rides
- [x] 1.3 Backfill script dry run on staging

## 2. Unlock service

- [x] 2.1 Accept `groupRideId` on `POST /v2/unlocks`
- [ ] 2.2 Enforce the same-station rule
- [ ] 2.3 Enforce the 4-bike limit, and the 2-bike limit for new accounts
- [ ] 2.4 Remove the PIN unlock path

## 3. Billing

- [ ] 3.1 Group ride lines on one receipt
- [ ] 3.2 Apply the daily cap per bike

## 4. Rider app

- [ ] 4.1 "Ride together" entry point on the scan screen
- [ ] 4.2 Bike counter and guest age confirmation
- [ ] 4.3 Hide the entry point on firmware older than 4.2

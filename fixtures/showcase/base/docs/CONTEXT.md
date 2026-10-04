# Pedalway

The bike-share service: riders take bikes from docks at stations and return them to any station.

## Language

**Rider**:
A person with an account who takes out a bike.
_Avoid_: User, customer, cyclist

**Dock**:
A single locking point that holds one bike.
_Avoid_: Slot, rack

**Station**:
A group of docks at one location.

**Ride**:
The period between a bike leaving a dock and being docked again, charged to one rider.
_Avoid_: Trip, journey, rental

**Pass**:
What a rider buys to be allowed to unlock bikes for a period.
_Avoid_: Subscription, membership

**Group ride**:
Several rides started together by one leader and billed on one receipt.

**Leader**:
The rider who starts a group ride and pays for it.

**Hold**:
A bike or dock kept for one rider for a limited time.
_Avoid_: Reservation, booking

**Daily cap**:
The most a rider is charged for rides in one day.

## Relationships

- A **Station** has many **Docks**
- A **Rider** needs a **Pass** to start a **Ride**

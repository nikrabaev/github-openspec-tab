# Fix unlock timeouts

Unlocks time out too early on slow networks. This change raises the timeout and adds a retry.

Notes from the incident review:

- 2% of unlocks on 3G fail at the 10 second limit
- A second attempt succeeds 9 times out of 10

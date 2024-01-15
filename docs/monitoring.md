# Monitoring the Reserve Protocol and Rtokens

This document provides an overview of the monitoring setup for the Reserve Protocol and RTokens on both the Ethereum and Base networks. The monitoring is conducted through the [Hypernative](https://app.hypernative.xyz/) platform, utilizing the `FacadeMonitor` contract to retrieve the status for specific RTokens. This monitoring setup ensures continuous vigilance over the Reserve Protocol and RTokens, with alerts promptly notifying relevant channels in case of any issues.

## Checks/Alerts

The following alerts are currently setup for RTokens deployed in Mainnet and Base:

### Status (Basket Handler) - HIGH

Checks if the status of the Basket Handler for a specific RToken is SOUND. If not, triggers an alert via Slack, Discord, Telegram, and Pager Duty.

### Fully collateralized (Basket Handler) - HIGH

Checks if the Basket Handler for a specific RToken is FULLY COLLATERALIZED. If not, triggers an alert via Slack, Discord, Telegram, and Pager Duty.

### Batch Auctions Disabled - HIGH

Checks if the batch auctions for a specific RToken are DISABLED. If true, triggers an alert via Slack, Discord, Telegram, and Pager Duty.

### Dutch Auctions Disabled - HIGH

Checks if the any of the dutch auctions for a specific RToken is DISABLED. If true, triggers an alert via Slack, Discord, Telegram, and Pager Duty.

### Issuance Depleted - MEDIUM

Triggers and alert via Slack if the Issuance Throttle for a specific RToken is consumed > 99%

### Redemption Depleted - MEDIUM

Triggers and alert via Slack if the Redemption Throttle for a specific RToken is consumed > 99%

### Backing Fully Redeemable- MEDIUM

Triggers and alert via Slack if the backing of a specific RToken is not redeemable 100% on the underlying Defi Protocol. Provides checks for AAVE V2, AAVE V3, Compound V2, Compound V3, Stargate, Flux, and Morpho AAVE V2.

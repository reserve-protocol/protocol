# Origin Dollar collateral

`OUSDCollateral` holds **wOUSD** on Ethereum mainnet. Its reference is OUSD; its target
and unit of account are USD. It inherits the linear ERC-4626 conversion and revenue
hiding from `ERC4626FiatCollateral`.

## Pricing and defaults

The plugin **assumes 1 OUSD = 1 USD**. Its central USD/wOUSD price is the current
OUSD/wOUSD conversion ratio; `oracleError` widens this into low/high price estimates.
It reads no external price feed and cannot detect an OUSD depeg. The pricing margin
is not a bound on possible depeg losses.

A decrease below the exposed reference ratio causes an immediate, irreversible hard
default. Small decreases within revenue hiding are tolerated. Backing losses that
do not lower the wrapper ratio are not detected by this mechanism.

`chainlinkFeed` is retained because the inherited constructor requires a nonzero
address, but is never called. `oracleTimeout` must also be positive: it still enters
the inherited saved-price decay delay (`oracleTimeout + 300 seconds`) if wrapper
pricing fails. A wrapper conversion revert with a reason causes a hard default;
empty reverts propagate, following the parent contract's handling of possible
out-of-gas failures.

The shared configuration in `common/ousd.ts` uses a 0.5% pricing margin, 0.01% revenue
hiding, zero default threshold, one-second oracle timeout, seven-day price decay,
24-hour delay until default and $1m maximum trade volume. These are deployment
defaults, not a collateral risk assessment.

## Integration

Reserve transfers wOUSD directly on RToken redemption and sells wOUSD during
recollateralization. This plugin does not call Origin's withdrawal queue or monitor
capital pauses. Exit liquidity and the underlying strategies remain economic risks.

The [Origin contract registry](https://docs.originprotocol.com/registry/contracts/ousd-registry)
identifies wOUSD at `0xD2af830E8CBdFed6CC11Bab697bB25496ed6FA62` and OUSD at
`0x2A8e1E676Ec238d8A992307B495b45B3fEAa5e86`.
[WrappedOusd](https://github.com/OriginProtocol/origin-dollar/blob/master/contracts/contracts/token/WrappedOusd.sol)
inherits Origin's WOETH wrapper implementation.

Deploy using `scripts/deployment/phase2-assets/collaterals/deploy_origin_ousd.ts`
after the standard deployment prerequisites; verify using
`scripts/verification/collateral-plugins/verify_ousd.ts`. Both consume the same
constructor configuration and support Ethereum mainnet only.

## Tests

```sh
FORK= yarn hardhat test test/plugins/OUSDCollateral.test.ts
PROTO_IMPL=1 FORK=1 FORK_NETWORK=mainnet FORK_BLOCK=22164000 yarn hardhat test test/plugins/individual-collateral/origin/OUSDCollateral.test.ts
```

The fork suite requires an archive-capable `MAINNET_RPC_URL`. It uses real OUSD
transferred from the Curve OUSD/3CRV pool and wraps it through wOUSD's deposit
interface. It covers the ratio, transfers, registration, issuance and redemption.

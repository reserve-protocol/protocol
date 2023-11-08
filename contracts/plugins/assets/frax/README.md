# Staked FRAX (sFRAX) Collateral Plugin

## Summary

This plugin allows `sFRAX` holders to use their tokens as collateral in the Reserve Protocol.

sFRAX is a non-upgradeable ERC4626 vault that earns the user the right to an increasing quantity of FRAX over time. The income stream is administered through a timelock + multisig. The only control the timelock has over the vault is the ability to change the rate of interest accrual. At all times `sFRAX` can be redeemed for a prorata portion of the held `FRAX`.

The timelock + multisig targets a rate of appreciation for `sFRAX` equal to the IORB, or the FED's **interest rate on reserve balances**. In the background, an AMO puts FRAX to work in defi in order to try to cover as much of the interest as possible. Any interest that is not found defi is covered by FXS. If the frax protocol were unable to make good on the targeted IORB rate, they would either have to drop the `sFRAX` yield or risk de-pegging FRAX, which would begin to be become undercollateralized.

Since it is ERC4626, the redeemable FRAX amount can be gotten by dividing `sFRAX.totalAssets()` by `sFRAX.totalSupply()`.

No function needs be called in order to update `refPerTok()`. `totalAssets()` is already a function of the block timestamp and increases as time passes.

We can use 0 revenue hiding since the vault correctly rounds defensively in favor of `sFRAX` holders during deposit/withdrawal (thx t11s).

No rewards other than the ever-increasing exchange rate.

`sFRAX` contract: <https://etherscan.io/address/0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32#code>

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| sFRAX | FRAX | USD    | USD |

### Functions

#### refPerTok {ref/tok}

`return divuu(IStakedFrax(address(erc20)).totalAssets(), IStakedFrax(address(erc20)).totalSupply());`

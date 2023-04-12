# BendDAO bendWETH collateral plugin

## Summary
This plugin allows RToken to use bendWETH as collateral. bendWETH is the token minted when ETH is deposited into the BendDAO protocol for lending. It is an interest-bearing token and behaves in the same manner as AAVE ATokens based on the [docs](https://docs.benddao.xyz/portal/lending-protocol/bendeth-valuation).

bendWETH is also known as bendETH. I choose the word bendWETH cause the ETH is converted to WETH via gateway, and bendWETH is the [token](https://etherscan.io/token/0xeD1840223484483C0cb050E6fC344d1eBF0778a9#readProxyContract) symbol. The contract name is [BToken](https://github.com/BendDAO/bend-lending-protocol/blob/6d20ec4497f549fe2f02ffd88d6158714a6b8ccd/contracts/protocol/BToken.sol) and so far, bendWETH is the only BToken.

BendDAO deployed contracts can be found in the [docs](https://docs.benddao.xyz/developers/deployed-contracts/lending-protocol). Please note that the `LendPool` and `IncentivesController` can be derived from `LendPoolAddressProvider` contract methods.


## Implementation
### Units
| tok               | ref       | target    | UoA       |
| ----------------- | --------- | --------- | --------- |
| staticBendWETH    | WETH      | ETH       | USD       |


### Assumptions
* targetPerRef is always 1: ETH and WETH are interchangeable for 1:1 via the [WETH contract](https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2#code). A lot of protocols work with this assumption including Uniswap V3 which uses WETH as ETH, and BenDDAO protocol which uses a [gateway](https://etherscan.io/address/0x3B968D2D299B895A5Fcf3BBa7A64ad0F566e6F88#writeProxyContract) to implement conversion.
* refPerTok is never decreasing: refPerTok is the asset reserve normalized income which is always increasing. It's the income **accrued**. Logic can be found in [code](https://github.com/BendDAO/bend-lending-protocol/blob/6d20ec4497f549fe2f02ffd88d6158714a6b8ccd/contracts/libraries/logic/ReserveLogic.sol#L47-L67)


### ICollateral implementation
| method    | contract implementation  | explanation    |
| --------- | ------------------------ | -------------- |
| targetName        | FiatCollateral    | target name   |
| status            | FiatCollateral    | collateral status |
| refPerTok         | AppreciatingFiatCollateral    | {ref/tok} depends on _underlyingRefPerTok in BendWethCollateral contract  |
| targetPerRef      | FiatCollateral    | {target/ref} = 1  |
| refresh           | AppreciatingFiatCollateral    | update status if {ref/tok} or price cross thresholds |
| price             | Asset | price relies on tryPrice in BendWethCollateral contract |
| lotPrice          | Asset | lotPrice relies on tryPrice in BendWethCollateral contract |
| bal               | Asset | balance in whole token |
| erc20             | Asset | tok   |
| erc20Decimals     | Asset | tok decimals  |
| isCollateral      | FiatCollateral    | True  |
| maxTradeVolume    | Asset | max trade volume |
| claimRewards      | BendWethCollateral  | Claim BEND rewards. |

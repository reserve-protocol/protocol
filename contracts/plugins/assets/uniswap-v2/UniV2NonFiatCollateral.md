
# UniV2NonFiatCollateral Plugin (for non fiat LP)

## Files
_Plugin contracts_

- [UniV2NonFiatCollateral.sol](./UniV2NonFiatCollateral.sol)
- [UnitV2Asset.sol](./UniV2Asset.sol)

_Tests contracts_

- [pairMock.sol](../../mocks/uniswap-v2/pair-mock/pairMock.sol)
- [Uniswapv2 mock](../../mocks/uniswap-v2/mock-uni-v2/)


## Plugin Units

 * __Collateral token `{tok}`__ is `UNI-V2` Liquidity Token for a pair tokenA/tokenB.
 `UNI-V2` is an ERC20 compatible token that can be redeemed for a combination
 of tokenA + tokenB
   
 * __Reference unit `{ref}`__ is `UNIV2SQRT-TA-TB` a synthetic reference unit equal to 
 $ \sqrt{x y}$. This reference only increasing value per token will be detailled in [`refPerTok()` function](./UniV2Collateral.md#pluggin-functions) description. With 
      * x = current tokenA reserves
      * y = current tokenB reserves

 * __Target unit `{target}`__ `UNIV2SQRT-TA-TB`
   

 * __Unit of Account `{UoA}`__ is `USD`

 ## Pluggin Functions
 
__`refPerTok()`__

Same as [UniV2Collateral refPerTock](./UniV2Collateral.md#pluggin-functions)

TLDR; 
- $\dfrac{\sqrt{x y}}{l}$ as `refPerTok()` is nondecreasing over time.
- $\dfrac{\sqrt{x y}}{l}$ as `refPerTok() {ref}` is good market rate for 1 `{tok}` 


__`targetPerRef()`__

Since `{target}` ==  `{ref}`:

`targetPerRef() = 1`

TLDR;
- `targetPerRef() {target}` is a good price. 
- `targetPerRef()` is _constant_ an equal to $1$.

__`strictPrice()`__
Calculated via:
- get Amount of x tokenA and y tokenB removing L liquidity Tokens
- get oracle price for tokenA and tokenB

strickPrice = $\dfrac{p_x x + p_y y}{L}$ in {UoA/tok}

__`refresh()`__

- Checks refPerTok() prices do not decreased (Disables plugin if it does)
and updates status and price

Status is marked as `IFFY` if:
- pool ratio devitates from tokenA/tokenB expected oracle price ratio beyond default threshold

Status changes from `IFFY` to `DISABLED` if it's `IFFY` state stayed over delayUntilDefault time.

[Integrated tests](../../../../test/integration/individual-collateral/UniV2NonFiatCollateral.test.ts) ensure those features.

__`pricePerTarget()`__
- {UoA/target} is FixOne since `{target} = {UoA} = USD`

__`claimRewards()`__

In UniV2 rewards are earned removing Liquidity tokens.
There is no claimReward in this protocol version.


__`status()`, `isCollateral()` and `targetName()`__
- Implemeted in `UniV2NonFiatCollateral` contract.

__`price(bool)`, `bal(address)`, `erc20()`, `erc20Decimals()` and `maxTradeVolume()`__
- Implemeted in `UniV2Asset`.

## Tests
Added UniV2NonFiatCollateral to [integrated tests](../../../../test/integration/individual-collateral/UniV2NonFiatCollateral.test.ts)
Test all expected behaviour including:

- refPerTok non decreasing for add/remove liquidity 
- refPerTok non decreasing for swap trades
- pluggin disables if refPerTok decreases
- correct deployment
- correct price handling
- correct state management

### yarn slither
Skipped issues and warnings from other reserve contracts and UniswapV2 imports.

Issues:
```
UniV2NonFiatCollateral.refresh() (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#133-173) performs a multiplication on the result of a division:
        - deltaR = (pA.div(pB).mul(defaultThreshold)) (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#150)
```
```
UniV2NonFiatCollateral.status() (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#81-89) uses a dangerous strict equality:
        - _whenDefault == NEVER (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#82)
```
```
UniV2NonFiatCollateral.refresh().pA (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#143) is a local variable never initialized
```
```
UniV2NonFiatCollateral.refresh().pB (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#144) is a local variable never initialized
```
```
UniV2NonFiatCollateral.refresh().errData (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#154) is a local variable never initialized
```
```
UniV2NonFiatCollateral.refresh().errData_scope_0 (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#158) is a local variable never initialized
```
```
UniV2Asset.price(bool).p (contracts/plugins/assets/uniswap-v2/UniV2Asset.sol#101) is a local variable never initialized
```
```
UniV2Asset.price(bool) (contracts/plugins/assets/uniswap-v2/UniV2Asset.sol#100-107) ignores return value by this.strictPrice() (contracts/plugins/assets/uniswap-v2/UniV2Asset.sol#101-106)
```
```
UniV2NonFiatCollateral.refresh() (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#133-173) ignores return value by chainlinkFeedA.price_(oracleTimeout) (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#143-161)
```
```
UniV2NonFiatCollateral.refresh() (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#133-173) ignores return value by chainlinkFeedB.price_(oracleTimeout) (contracts/plugins/assets/uniswap-v2/UniV2NonFiatCollateral.sol#144-157)
```

Similar to other XXXXCollateral contracts issues, asumed to be safe.

### yarn test:integration
Added [test/integration/individual-collateral/UniV2NonFiatCollateral.test.ts](../../../../test/integration/individual-collateral/UniV2NonFiatCollateral.test.ts)

- Results:

```
UniswapV2NonFiatCollateral - Mainnet Forking P1
    Deployment
      ✔ Should setup RToken, Assets, and Collateral correctly
      ✔ Should register ERC20s and Assets/Collateral correctly
      ✔ Should register Basket correctly (1432ms)
      ✔ Should validate constructor arguments correctly
    RefPerTok non decreasing checks
      ✔ Adding/Removing liquidy should not change refPerTock (845ms)
      ✔ Swap Eth to tokens should increase refPerTock
      ✔ Swap token to Eth should increase refPerTock
      ✔ Swap tokens in and out should only increase refPerTock
    Issuance/Appreciation/Redemption
      ✔ Should issue, redeem, and handle appreciation rates correctly (2673ms)
    Rewards
      ✔ Should be able to claim rewards (if applicable)
    Price Handling
      ✔ Should handle invalid/stale Price (1114ms)
    Collateral Status
      ✔ Updates status in case of soft default on price A / price B to ratio  (994ms)
      ✔ Updates status in case of soft default on ratio
      ✔ Can revert to SOUND status in case of soft default on price A and B
      ✔ Can revert to SOUND status in case of soft default on ratio
      ✔ Updates status in case of hard default and persist in hard default state
      ✔ Reverts if any oracle reverts or runs out of gas, maintains status (586ms)
```

...

```
  86 passing (4m)
  33 pending
```

## Deployement
   
1) Deploy [UniV2NonFiatCollateral contract](./UniV2NonFiatCollateral.sol) with params 
(here for USDC/ETH pair): 
```ts
    const ORACLE_TIMEOUT = bn('3600') // 1 hour 
    const defaultThreshold = fp('0.05') // 5%
    const delayUntilDefault = bn('86400') // 24h
    const weth = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WETH || '')
    )

    const usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )
    // Get UniV2 Factory
    UniV2FactoryMock = await ethers.getContractAt(
      'UniswapV2MockFactory',
      networkConfig[chainId].UNISWAP_V2_FACTORY || ''
    )
    // Get pair for USDC/ETH
    const pairAddress = await UniV2FactoryMock.getPair(usdc.address, weth.address)
    const UniV2PairMock = await ethers.getContractAt('UniswapV2MockPair', pairAddress)
    // Get UniV2 Router02 contract
    const UniV2RouterMock = await ethers.getContractAt(
      'UniswapV2MockRouter02',
      networkConfig[chainId].UNISWAP_V2_ROUTE02 || ''
    )

    // Get Collateral
    const UniV2NonFiatCollateralFactory = await ethers.getContractFactory('UniV2NonFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    const unitName = 'UNIV2SQRT' + 'USDC' + 'ETH' //UNIV2SQRTUSDCETH
    
    const UniV2NonFiatCollateral = await UniV2NonFiatCollateralFactory.deploy(
      UniV2PairMock.address,
      fp('1'),
      config.rTokenMaxTradeVolume,
      delayUntilDefault,
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      networkConfig[chainId].chainlinkFeeds.WETH as string,
      ethers.utils.formatBytes32String(unitName),
      defaultThreshold,
      ORACLE_TIMEOUT
    )
```
Mainnet addresses for chainlink added in [config file](../../../../common/configuration.ts).

2) Initialize/set the base tokens, add some liquidy (uniswap Router is recomended) and the collateral should be ready.
3) Create Rtoken with UniV2Collateral
4) As UniV2 holder approve Rtoken adddress to transfer your LP tokens (ERC20).
5) test
6) Follow [deployment](../../../../docs/deployment.md).


# UniV2Collateral Plugin (for non fiat LP)

## Files
_Plugin contracts_

- [UniV2Collateral.sol](./UniV2Collateral.sol)
- [UnitV2Asset.sol](./UniV2Asset.sol)

_Tests contracts_

- [pairMock.sol](../../mocks/uniswap-v2/pair-mock/pairMock.sol)
- [Uniswapv2 mock](../../mocks/uniswap-v2/mock-uni-v2/)


## Plugin Units

 * __Collateral token `{tok}`__ is `UNI-V2` Liquidity Token for a pair tokenA/tokenB.
 `UNI-V2` is an ERC20 compatible token that can be redeemed for a combination
 of tokenA + tokenB
   
 * __Reference unit `{ref}`__ is `UNIV2SQRT-TA-TB` a synthetic reference unit equal to 
 $\sqrt{x y}$. This reference only increasing value per token will be detailled in [`refPerTok()` function](#pluggin-functions) description. With 
      * x = current tokenA reserves
      * y = current tokenB reserves

 * __Target unit `{target}`__ `USD` converting tokenA and tokenB to USD from oracle prices.
   

 * __Unit of Account `{UoA}`__ is `USD`

 ## Pluggin Functions
 
__`refPerTok()`__

`{ref}` is a synthetic reference unit equal to 
$$\sqrt{x y}$$
In [implementation](#implementation) we found that:
$$\dfrac{k'}{k} = \left( \dfrac{l'}{l} \right)^2$$
Whenever liquidity is added or removed from the poll. Thus
$$\dfrac{x'y'}{xy} = \left( \dfrac{l'}{l} \right)^2$$
$$\dfrac{x'y'}{l'^2}=\dfrac{xy}{l^2}$$
Meaning that: 
- This quantity doesn't change if liquidity is added or removed: it's constant
- Can be calculated any time via a contract call to unswap pair
-  When trading with without fees $k' = k$ . $\dfrac{\sqrt{x'y'}}{l}$ remains constant.
- When trading with fees $k' = k \cdot (1 + \beta \dfrac{1-\lambda}{\lambda})$
  and $0<\lambda<1$ then $k' > k$ so $\dfrac{x'y'}{l^2}>\dfrac{xy}{l^2}$; since square root function is an increasing function 
  $\sqrt{\dfrac{x'y'}{l^2}}>\sqrt{\dfrac{xy}{l^2}}$ demostrating 
  this ref can only increase when a trade is made with fees.
- initial value is equal to $\sqrt{\dfrac{xy}{l^2}}= \sqrt{\dfrac{xy}{(\sqrt{xy})^2}} = \sqrt{1} = 1$
- It's a ref per token since {ref} = refPerToken() * {tok}

TLDR; 
- $\dfrac{\sqrt{x y}}{l}$ as `refPerTok()` is nondecreasing over time.
- $\dfrac{\sqrt{x y}}{l}$ as `refPerTok() {ref}` is good market rate for 1 `{tok}` 


__`targetPerRef()`__ usd per sqrt(x*y)

Since `{ref}` is `sqrt(x*y)` we take:
- $p_x$ = tokenA/USD from oracle ~ a USD
- $p_y$ = tokenB/USD from oracle ~ b USD
- x and y reserves from uniswap pair ~ b:a ratio
- removing LP tokens gives x token and y tokens with $y \approx \frac{a}{b} x$ and value in usd is $a x + b y \approx  a x + b\frac{a}{b} x \approx 2ax$ 
- so tagetPerRef = $\dfrac{2a x }{\sqrt{xy}} \approx \dfrac{2ax}{\sqrt{\frac{a}{b}x^2}} \approx 2  \sqrt{ab}$

For example consider a DAI/USDC pair:
- $p_x$ = tokenA/USD from oracle ~ 1 USD 
- $p_y$ = tokenB/USD from oracle ~ 1 USD
- x and y reserves from uniswap pair ~ 1:1 ratio
- redeem L gives x token and y tokens with $x \approx y$ and a value in usd is $p_x x + p_y y \approx  1 \cdot x+ 1 \cdot y \approx 2x$ so tagetPerRef = $\dfrac{2x}{\sqrt{xy}} \approx \dfrac{2x}{\sqrt{x^2}} \approx 2$
- tragetPerRef = $2  \sqrt{ab} \approx 2 \sqrt{1 \cdot 1} = 2$

TLDR;
- `targetPerRef() {target}` is a good price. 
- `targetPerRef()` is _constant_ an equal to $2 \sqrt{ab}$.

__`strictPrice()`__
Calculated via:
- get Amount of x tokenA and y tokenB removing L liquidity Tokens
- get oracle price for tokenA and tokenB

strickPrice = $\dfrac{p_x x + p_y y}{L}$ in {UoA/tok}

__`refresh()`__

- Checks refPerTok() prices do not decreased (Disables plugin if it does)
and updates status and price

Status is marked as `IFFY` if:
- tokenA and/or tokenB depegs beyond default threshold
- prices feeds for A and/or B fails
- pool ratio depegs from tokenA/tokenB expected ratio beyond default threshold

Status changes from `IFFY` to `DISABLED` if it's `IFFY` state stayed over delayUntilDefault time.

[Integrated tests](../../../../test/integration/individual-collateral/UniV2Collateral.test.ts) ensure those features.

__`pricePerTarget()`__
- {UoA/target} is FixOne since `{target} = {UoA} = USD`

__`claimRewards()`__

In UniV2 rewards are earned removing Liquidity tokens.
There is no claimReward in this protocol version.


__`status()`, `isCollateral()` and `targetName()`__
- Implemeted in `UniV2Collateral` contract.

__`price(bool)`, `bal(address)`, `erc20()`, `erc20Decimals()` and `maxTradeVolume()`__
- Implemeted in `UniV2Asset`.

## Tests
Added UniV2Collateral to [integrated tests](../../../../test/integration/individual-collateral/UniV2Collateral.test.ts)
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
UniV2Collateral.refresh() (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#129-183) performs a multiplication on the result of a division:
        - deltaR = (pegA.div(pegB).mul(defaultThreshold)) (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#158)
```
```
UniV2Collateral.status() (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#87-95) uses a dangerous strict equality:
        - _whenDefault == NEVER (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#88)
```
```
UniV2Collateral.refresh().pA (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#140) is a local variable never initialized
```
```
UniV2Collateral.refresh().pB (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#147) is a local variable never initialized
```
```
UniV2Collateral.refresh().errData (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#163) is a local variable never initialized
```
```
UniV2Collateral.refresh().errData_scope_0 (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#168) is a local variable never initialized
```
```
UniV2Asset.price(bool).p (contracts/plugins/assets/uniswap-v2/UniV2Asset.sol#101) is a local variable never initialized
```
```
UniV2Asset.price(bool) (contracts/plugins/assets/uniswap-v2/UniV2Asset.sol#100-107) ignores return value by this.strictPrice() (contracts/plugins/assets/uniswap-v2/UniV2Asset.sol#101-106)
```
```
UniV2Collateral.refresh() (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#129-183) ignores return value by chainlinkFeedA.price_(oracleTimeout) (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#140-171)
```
```
UniV2Collateral.refresh() (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#129-183) ignores return value by chainlinkFeedB.price_(oracleTimeout) (contracts/plugins/assets/uniswap-v2/UniV2Collateral.sol#147-166)
```
Similar to other XXXXCollateral contracts issues, asumed to be safe.

### yarn test:integration
Added [test/integration/individual-collateral/UniV2Collateral.test.ts](../../../../test/integration/individual-collateral/UniV2Collateral.test.ts)

- Results:

```
  UniswapV2Collateral - Mainnet Forking P1
    Deployment
      ✔ Should setup RToken, Assets, and Collateral correctly
      ✔ Should register ERC20s and Assets/Collateral correctly
      ✔ Should register Basket correctly (1333ms)
      ✔ Should validate constructor arguments correctly
    RefPerTok non decreasing checks
      ✔ Adding/Removing liquidy should not change refPerTock (614ms)
      ✔ Swap tokenA to tokenB should increase refPerTock (819ms)
      ✔ Swap tokenB to tokenA should increase refPerTock
      ✔ Swap tokens in and out should only increase refPerTock (749ms)
    Issuance/Appreciation/Redemption
      ✔ Should issue, redeem, and handle appreciation rates correctly (3619ms)
    Rewards
      ✔ Should be able to claim rewards (if applicable) (1170ms)
    Price Handling
      ✔ Should handle invalid/stale Price (1691ms)
    Collateral Status
      ✔ Updates status in case of soft default on price A
      ✔ Updates status in case of soft default on price B
      ✔ Updates status in case of soft default on price A and B
      ✔ Updates status in case of soft default on ratio
      ✔ Can revert to SOUND status in case of soft default on price A  (512ms)
      ✔ Can revert to SOUND status in case of soft default on price B
      ✔ Can revert to SOUND status in case of soft default on price A and B
      ✔ Can revert to SOUND status in case of soft default on ratio
      ✔ Updates status in case of hard default and persist in hard default state
      ✔ Reverts if any oracle reverts or runs out of gas, maintains status (636ms)
```

...

```
  86 passing (4m)
  33 pending
```

## Deployement
   
1) Deploy [UniV2Collateral contract](./UniV2Collateral.sol) with params 
(here for DAI/USDC pair): 
```ts
    const ORACLE_TIMEOUT = bn('3600') // 1 hour  
    const dai = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI || '')
    )

    const usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )

    // Get UniV2 Factory
    const UniV2FactoryMock = await ethers.getContractAt(
      'UniswapV2Factory',
      networkConfig[chainId].UNISWAP_V2_FACTORY || ''
    )

    // Get pair for DAI/USDC
    const pairAddress = await UniV2FactoryMock.getPair(dai.address, usdc.address)
    const UniV2Pair = await ethers.getContractAt('UniswapV2Pair', pairAddress)
    const fallbackPrice_: BigNumberish = fp('2')
    const maxTradeVolume: config.rTokenMaxTradeVolume
    const defaultThreshold = fp('0.05') // 5%
    const delayUntilDefault = bn('86400') // 24h
    const pegA = fp('1') // 18 decimals (dai 18 decimals) 
    const pegB = fp('1') // 18 decimals (even if usdc is 6 decimals)

    let UniV2CollateralFactory = await ethers.getContractFactory('UniV2Collateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    let UniV2Collateral = await UniV2CollateralFactory.deploy(
      UniV2Pair.address,
      fallbackPrice
      maxTradeVolume,
      delayUntilDefault,
      networkConfig[chainId].chainlinkFeeds.DAI as string,
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      pegA,
      pegB,
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

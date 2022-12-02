# Euler Finance Lending Plugins - Documentation
### Author: [Shr1ftyy](https://github.com/Shr1ftyy)
Twitter: [https://twitter.com/shr1ftyy](https://twitter.com/shr1ftyy)
Discord: Shr1ftyy#5402

## 1.0 Introduction - Overview of Euler Finance Lending Positions
These plugins facilitate the usage of Euler Finance's eTokens as collateral. eTokens are minted and 
burnt upon the supply and withdraw of lending assets (see [https://docs.euler.finance/getting-started/white-paper#lending-and-borrowing](https://docs.euler.finance/getting-started/white-paper#lending-and-borrowing)). 
They represent a lender's share of the total tokens (which includes the yield generated from the borrowers of the 
underlying token) in their lending market, which eTokens can be redeemed for. eTokens which represent usd-pegged [stablecoins](#20-usd-pegged-stablecoins), 
[self-referential](#30-self-referential-tokens) tokens, and non-fiat tokens are supported.

Refer to Euler Finance's [documentation](https://docs.euler.finance/getting-started/white-paper) for a more in-depth overview
of the inner workings of Euler's lending system.

## 2.0 USD-pegged Stablecoins 
Smart Contract: [ETokenFiatCollateral.sol](./ETokenFiatCollateral.sol) 

### 2.1 Units and Price Calculations

| **Units**       | `tok`      | `ref`                                                   | `target` | `UoA` |
|-----------------|------------|---------------------------------------------------------|----------|-------|
| **Description** | the eToken | the eToken's <br>underlying asset <br>(i.e. USDC) | USD      | USD   |

$$ P = \frac{\text{UoA}}{\text{tok}} \text{ is the intended peg price of the underlying asset, and}$$

$$ \delta = P \tau $$

$$ \text{ where } \delta \text{ is the maximum price deviation with } \tau \text{ being the default threshold}$$

### 2.2 Defaulting Conditions    

- **Soft default**:
  - $P' \notin [P - \delta, P + \delta], \text{where } P' \text{ is the actual price of one unit of the underlying asset}$

- **Hard default**: 
  - $\text{refPerTok} _t \lt \text{refPerTok} _{t-1}$

**Since eTokens represent a share of a lending pool which accrues yield from borrowers who pay interest, 
unless the pool is exploited, $\text{refPerTok}$ should be non-decreasing.**

### 2.3 Deployment and Configuration

Deploy [ETokenFiatCollateral.sol](./ETokenFiatCollateral.sol) with the following constructor args:
``` cpp
uint192 fallbackPrice_, // fallback price
AggregatorV3Interface chainlinkFeed_, // {uoa/ref} chainlink feed
IERC20Metadata erc20_, // address of eToken (an EToken.sol contract (see https://docs.euler.finance/developers/getting-started/contract-reference#underlyingtoetoken))
uint192 maxTradeVolume_, // max trade volume - default
uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // USD
uint192 defaultThreshold_, // maximum price drift from peg (%) - default
uint256 delayUntilDefault_, // time till status goes from IFFY to DISABLED
int8 referenceERC20Decimals_ // decimals of reference token - default
```

## 3.0 Self-Referential Tokens
<!-- TODO: write here after finishing `ETokenNonFiatCollateral.sol` -->
Smart Contract: [ETokenSelfReferentialCollateral.sol](./ETokenSelfReferentialCollateral.sol)

`ETokenSelfReferentialCollateral.sol` adds support for eTokens that represent shares of a lending pool
that contain assets that do not need any price-fluctuation-related default checks on the reference
asset, since the reference and target assets are the same (i.e the reference unit for the eToken eLINK 
is LINK, which is also its target unit).


### 3.1 Units and Price Calculations

| **Units**       | `tok`      | `ref`                                                   | `target` | `UoA` |
|-----------------|------------|---------------------------------------------------------|----------|-------|
| **Description** | the eToken | the eToken's <br>underlying asset <br>(i.e. WETH) |   the eToken's <br>underlying asset <br>(i.e. WETH)    | USD   |

### 3.2 Defaulting Conditions    

- **Soft default**:
  - The price retrieved from the price oracle for the reference token has not been updated in a while.
- **Hard default**: 
  - $\text{refPerTok} _t \lt \text{refPerTok} _{t-1}$

### 3.3 Deployment and Configuration

Deploy [ETokenSelfReferentialCollateral.sol](./ETokenSelfReferentialCollateral.sol) with the following constructor args:
``` cpp
uint192 fallbackPrice_, // fallback price
AggregatorV3Interface chainlinkFeed_, // {uoa/ref} chainlink feed
IERC20Metadata erc20_, // address of eToken (an EToken.sol contract (see https://docs.euler.finance/developers/getting-started/contract-reference#underlyingtoetoken))
uint192 maxTradeVolume_, // max trade volume - default
uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // name of the eToken's underlying token
uint256 delayUntilDefault_, // time till status goes from IFFY to DISABLED
int8 referenceERC20Decimals_ // decimals of reference token - default
```

## 4.0 Non-Fiat Tokens
<!-- TODO: write here after finishing `ETokenNonFiatCollateral.sol` -->
Smart Contract: [ETokenNonFiatCollateral.sol](./ETokenNonFiatCollateral.sol)

`ETokenNonFiatCollateral.sol` adds support for eTokens that represent shares of a lending pool
that contain reference assets that have targets that are another token (i.e eWBTC represent shares
of wBTC lending pool, which should be pegged to BTC).


### 4.1 Units and Price Calculations

| **Units**       | `tok`      | `ref`                                                   | `target` | `UoA` |
|-----------------|------------|---------------------------------------------------------|----------|-------|
| **Description** | the eToken | the eToken's <br>underlying asset <br>(i.e. wBTC) |   the reference token's target asset (i.e BTC)    | USD   |

$$ P = \frac{\text{target}}{\text{ref}} \text{ is the intended peg rate between the underlying asset and it's target asset, and}$$

$$ \delta = P \tau $$

$$ \text{ where } \delta \text{ is the maximum exchange rate deviation with } \tau \text{ being the default threshold}$$

### 4.2 Defaulting Conditions    

- **Soft default**:
  - The price retrieved from the price oracle for the reference token has not been updated in a while.
  - $P' \notin [P - \delta, P + \delta], \text{where } P' \text{ is the actual price of one unit of the underlying asset}$
- **Hard default**: 
  - $\text{refPerTok} _t \lt \text{refPerTok} _{t-1}$

### 4.3 Deployment and Configuration

Deploy [ETokenNonFiatCollateral.sol](./ETokenNonFiatCollateral.sol) with the following constructor args:
``` cpp
uint192 fallbackPrice_, // fallback price
AggregatorV3Interface refUnitChainlinkFeed_, // {uoa/ref} chainlink feed
AggregatorV3Interface targetUnitUSDChainlinkFeed_, // {uoa/target} chainlink feed
IERC20Metadata erc20_, // address of eToken (an EToken.sol contract (see https://docs.euler.finance/developers/getting-started/contract-reference#underlyingtoetoken))
uint192 maxTradeVolume_, // max trade volume - default
uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // name of the eToken's underlying token
uint256 delayUntilDefault_, // time till status goes from IFFY to DISABLED
int8 referenceERC20Decimals_ // decimals of reference token - default
```

## 4.0 Testing 
The unit tests for these plugins are written in [ETokenFiatCollateral.sol](./ETokenFiatCollateral.sol), [ETokenNonFiatCollateral.sol](./ETokenNonFiatCollateral.sol),  and [ETokenSelfReferentialCollateral.sol](./ETokenSelfReferentialCollateral.sol). They are intented to 
be run at block number `16081743` on an Ethereum Mainnet fork. This is done automatically in the `before()` block in the testing scripts.

## 4.0 Addressing Slither Findings
Slither was used to scan the plugin contracts for vulnerabilities, the reported findings for each contract are described below:
- `Possible reentrancy in refresh() initiated by the external call IEToken(address(erc20)).touch().  - present in all EToken plugin contracts`. This external call does not create a reentrancy attack vector in this contract, and hence can be dismissed.


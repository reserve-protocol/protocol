# Euler Finance Lending Plugins - Documentation
### Author: [Shr1ftyy](https://github.com/Shr1ftyy)

## 1.0 Introduction - Overview of Euler Finance Lending Positions
These plugins facilitate the usage of Euler Finance's eTokens as collateral. eTokens are minted and 
burnt upon the supply and withdraw of lending assets (see [https://docs.euler.finance/getting-started/white-paper#lending-and-borrowing](https://docs.euler.finance/getting-started/white-paper#lending-and-borrowing)). They represent a lender's share of the total token  
(which includes the yield generated from the borrowers of the underlying token) in their lending market, which eTokens can be redeemed for. eTokens which represent usd-pegged stablecoins and non-stablecoins are supported.

Refer to Euler Finance's [documentation](https://docs.euler.finance/getting-started/white-paper) for a more in-depth overview
of the inner workings of Euler's lending system.

## 2.0 Stablecoin Assets

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

Since eTokens represent a share of a lending pool which accrues yield from borrowers who pay interest, 
unless the pool is exploited, $\text{refPerTok}$ should be non-decreasing.

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

## Non-Stablecoin Assets
TODO: write here after finishing `ETokenNonFiatCollateral.sol`

## 3.0 Testing 
TODO: write here after finishing `ETokenNonFiatCollateral.sol`

<!---

The unit tests for these plugins are [FraxSwapCollateral.test.ts](../../../test/integration/individual-collateral/FraxSwapCollateral.test.ts) and [FTokenFiatCollateral.test.ts](../../../test/integration/individual-collateral/FTokenFiatCollateral.test.ts) are intented to be run on `MAINNET_BLOCK=15995569`,
since Fraxlend and Fraxswap pools did not exist during the default testing block number.


## 4.0 Addressing Slither Findings
Slither was used to scan the plugin contracts for vulnerabilities, the reported findings for each contract are described below:

- `FTokenFiatCollateral.sol`:
  - `Possible reentrancy in refresh() initiated by the external call IFraxlendPair(address(erc20)).addInterest().  - L#68`. This external call does not create a reentrancy attack vector in this contract, and hence can be dismissed.

-->
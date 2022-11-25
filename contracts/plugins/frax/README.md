# Fraxlend Collateral Plugins - Documentation
### Author: [Shr1ftyy](https://github.com/Shr1ftyy)
## 1.0 FraxSwap Liquidity Pool (LP) Token Plugins 

### 1.1 Introduction 

A Fraxswap LP Token (represented by a Frax) represents the a share of underlying tokens ($A$ & $B$) in a liquidity pool.
The dollar value of a share (`tok`) of pool increases over time as more users swap from token $A$ 
to token $B$ and vice versa, paying fees to the liquidity providers to do so. Please refer to Frax
Finance's [documentation](https://docs.frax.finance/fraxswap/technical-specifications) for more
details on how this works. 

This plugin currently supports both non-fiat and usd-pegged stablecoin pair LP tokens are supported.

### 1.2 Units and Price Calculations

This plugins uses the [Defi Protocol Invariant](https://github.com/reserve-protocol/protocol/blob/master/docs/collateral.md#defi-protocol-invariant) to calculate $\frac{\text{ref}}{\text{tok}}$ as shown below:

$$ \frac{\text{ref}}{\text{tok}} = \frac{\sqrt{xy}}{L}, \text{where }$$

$$ x \text{ and } y \text{ are the amount of tokens } A \text{ and } B \text{ in the pool respectively,} $$

$$ \text{and } L \text{ is the total } \text{supply of LP tokens. } $$

Methods used price of an LP token, as well as fiat peg related variables are highlighted below

$$ P_A = \frac{\text{UoA}}{A}, P_B = \frac{\text{UoA}}{B} $$

$$ \text{where } P_A, P_B \text{ denote the intended price of the tokens (if they're pegged)} $$

$$ P_{\rho} = \frac{P_{A}'x + P_{B}'y}{L}, $$

$$ \delta_A = P_A \tau $$

$$ \delta_B = P_B \tau $$

$$ \text{where } P_{\rho}, P_{A}',  P_{B}' \text{ is the live price of an LP token, token } A, \text{ token } B, $$

$$ \tau \text{ and is price drift default threshold} $$

### 1.3 Defaulting Conditions    
- **Soft-default**:
  - if token $A$ is supposed to be pegged $P_A$:
    - $P'_A \notin [P_A - \delta_A, P_A + \delta_A]$

  - if token $B$ is supposed to be pegged $P_B$:
    - $P'_B \notin [P_B - \delta_B, P_B + \delta_B]$ 
  
  - $P'_A \le 0$ OR $P'_B \le 0$

- **Hard default**: 
  - $\text{refPerTok} _{t} \lt \text{refPerTok} _{t-1}$

### 1.4 Deployment and Configuration

Deploy [FraxSwapCollateral.sol](./FraxSwapCollateral.sol) with construct args:
```
uint192 fallbackPrice_, // fallback price

uint256 tokenisFiat_, 
// bitmap of which tokens are fiat:
// e.g if the bit representation of tokenisFiat is:
// 00...001 -> token0 is pegged to UoA
// 00...010 -> token1 is pegged to UoA
// 00...011 -> both of them are pegged to UoA;

AggregatorV3Interface token0chainlinkFeed_, // chainlink feed for {uoa/token0}
AggregatorV3Interface token1chainlinkFeed_, // chainlink feed for {uoa/token1}
IERC20Metadata erc20_, // address of LP token
uint192 maxTradeVolume_, // max trade volume - default

uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // FSV2SQRT{token0 symbol}{token1 symbol}
uint192 defaultThreshold_, // maximum price drift from peg (%) - default
uint256 delayUntilDefault_, // time till status goes from IFFY to DISABLED
```
      
## 2.0 Fraxlend fToken Plugin (currently only supports USD stablecoins)
### 2.1 An Overview of Fraxlend
![Fraxlend Diagram](https://3191235985-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-MJQZW1mSg2O5N7HXHo0-1972196547%2Fuploads%2F0Eg35ekKh60kbHi0nwed%2FEcosystem%20Participants.png?alt=media&token=0e08bb51-4238-4b64-853a-04f2819f580b)
<div align = "center">
Figure 1 - Showcases the inflow and outflow of tokens and information 
in the Fraxlend lending market (the <a href=https://github.com/FraxFinance/fraxlend/blob/main/src/contracts/FraxlendPair.sol>
FraxlendPair</a> smart contract)
</div>
<p></p>

This plugin facilitates the usage of Fraxlend's fTokens as collateral. fTokens are minted and 
burnt upon the supply and withdraw of [assets](https://docs.frax.finance/fraxlend/fraxlend-overview#:~:text=Lenders%20provide%20Asset%20Tokens%20to%20the%20pool%20in%20exchange%20for%20fTokens) (the tokens which lenders can lend)
to the Fraxlend lending market. They represent a lender's share of the total *assets* 
(which includes the yield generated from borrowers) of their respective Fraxlend market, which fTokens 
can be redeemed for. Currently, only fTokens representing tokens that are pegged to USD are supported, since as of this moment,
only FRAX (a USD-pegged stablecoin) can be lent out to borrowers on Fraxlend.

Refer to Frax Finance's [documentation](https://docs.frax.finance/fraxlend/fraxlend-overview) for a more in-depth overview
of the inner workings of Fraxlend.

### 2.2 Units and Price Calculations

| **Units**       | `tok`      | `ref`                                                   | `target` | `UoA` |
|-----------------|------------|---------------------------------------------------------|----------|-------|
| **Description** | the fToken | the fToken's <br>underlying asset <br>(i.e. USDC) | USD      | USD   |

$$ P = \frac{\text{UoA}}{\text{tok}} \text{ is the intended peg price of the underlying asset, and}$$

$$ \delta = P \tau $$

$$ \text{ where } \delta \text{ is the maximum price deviation with } \tau \text{ being the default threshold}$$

### 2.3 Defaulting Conditions    

- **Soft default**:
  - $P' \notin [P - \delta, P + \delta], \text{where } P' \text{ is the actual price of one unit of the underlying asset}$
  - The `FraxlendPair` contract of the fToken is `paused`.

- **Hard default**: 
  - $\text{refPerTok} _t \lt \text{refPerTok} _{t-1}$

Since fTokens represent a share of a lending pool which accrues yield from borrowers who pay interest, 
unless the pool is exploited, $\text{refPerTok}$ should be non-decreasing.

### 2.4 Deployment and Configuration

Deploy [FTokenFiatCollateral.sol](./FTokenFiatCollateral.sol) with construct args:
```
uint192 fallbackPrice_, // fallback price
AggregatorV3Interface uoaPerRefFeed_, // {uoa/ref} chainlink feed
IERC20Metadata erc20_, // address of fToken(a FraxSwapPair contract)
uint192 maxTradeVolume_, // max trade volume - default
uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // USD
uint192 defaultThreshold_, // maximum price drift from peg (%) - default
uint256 delayUntilDefault_, // time till status goes from IFFY to DISABLED
int8 referenceERC20Decimals_ // decimals of underlying token - default
```

## 3.0 Testing - Fraxswap and Fraxlend Plugins
The unit tests for these plugins are [FraxSwapCollateral.test.ts](../../../test/integration/individual-collateral/FraxSwapCollateral.test.ts) and [FTokenFiatCollateral.test.ts](../../../test/integration/individual-collateral/FTokenFiatCollateral.test.ts) are intented to be run on `MAINNET_BLOCK=15995569`,
since Fraxlend and Fraxswap pools did not exist during the default testing block number.


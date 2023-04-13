# Balancer LP Token Collateral Plugin - Documentation
### Author: [Shr1ftyy](https://github.com/Shr1ftyy)
## 1.0 Balancer Liquidity Pool (LP) Token Plugin

### 1.1 Introduction 

A Balancer LP Token represents the a share of underlying tokens ($A$ & $B$) in a liquidity pool.
The dollar value of a share (`tok`) of pool increases over time as more users swap from token $A$ 
to token $B$ and vice versa, paying fees to the liquidity providers to do so. Please refer to Balancer's [documentation](https://docs.balancer.fi/) for more
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

Deploy [BalancerLPCollateral.sol](./BalancerLPCollateral.sol) with construct args:
```
uint256 tokenisFiat_, 
// bitmap of which tokens are fiat:
// e.g if the bit representation of tokenisFiat is:
// 00...001 -> token0 is pegged to UoA
// 00...010 -> token1 is pegged to UoA
// 00...011 -> both of them are pegged to UoA;

uint48 priceTimeout; // The number of seconds over which saved prices decay
bytes32 poolId; // balancer pool id
AggregatorV3Interface token0chainlinkFeed_, // chainlink feed for {uoa/token0}
AggregatorV3Interface token1chainlinkFeed_, // chainlink feed for {uoa/token1}

uint192 oracleError; // The % the oracle feed can be off by
IERC20Metadata erc20_, // address of LP token
uint192 maxTradeVolume_, // max trade volume - default
uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // FSV2SQRT{token0 symbol}{token1 symbol}
uint192 defaultThreshold_, // maximum price drift from peg (%) - default
uint256 delayUntilDefault_, // time till status goes from IFFY to DISABLED
```

## 2.0 Testing
The unit tests for these plugins are [BalancerLPCollateral.test.ts](/test/plugins/individual-collateral/balancer/BalancerCollateralTestSuite.test.ts) and run at mainnet block `17031699` which is set in [constants.ts](/test/plugins/individual-collateral/balancer/constants.ts).
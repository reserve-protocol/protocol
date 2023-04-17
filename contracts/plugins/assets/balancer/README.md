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

Deploy [BalancerLPCollateral.sol](./BalancerLPCollateral.sol) with constructor args:
```solidity
{ // struct CollateralConfig 
    uint48 priceTimeout; // {s} The number of seconds over which saved prices decay
    AggregatorV3Interface chainlinkFeed; // unused but cannot be zero
    uint192 oracleError; // unused but cannot be zero
    BPool erc20; // The ERC20 of the collateral token
    uint192 maxTradeVolume; // {UoA} The max trade volume, in UoA
    uint48 oracleTimeout; // {s} The number of seconds until a oracle value becomes invalid
    bytes32 targetName; // The bytes32 representation of the target name
    uint192 defaultThreshold; // {1} A value like 0.05 that represents a deviation tolerance
    // set defaultThreshold to zero to create SelfReferentialCollateral
    uint48 delayUntilDefault; // {s} The number of seconds an oracle can mulfunction
},
{ // struct BalancerCollateralConfig 
    // bitmap of which tokens are fiat:
    // e.g if the bit representation of tokenIsFiat is:
    // 00...001 -> token0 is pegged to UoA
    // 00...010 -> token1 is pegged to UoA
    // 00...011 -> both of them are pegged to UoA;
    uint256 tokenIsFiat;
    bytes32 poolId; // balancer pool id
    AggregatorV3Interface token0ChainlinkFeed; // token0 feed
    AggregatorV3Interface token1ChainlinkFeed; // token0 feed
    ILiquidityGaugeFactory gaugeFactory; // address of balancer's gauge factory
    IBalancerMinter balancerMinter; // bal minter address
}

```

## 2.0 Testing
The unit tests for these plugins are [BalancerLPCollateral.test.ts](/test/plugins/individual-collateral/balancer/BalancerCollateralTestSuite.test.ts) and run at mainnet block `17031699` which is set in [constants.ts](/test/plugins/individual-collateral/balancer/constants.ts). \
**NOTE**: The `claimRewards()` function cannot be tested, since Balancer calculates BAL distributions to LPs off-chain, and transfers are only accounted for through this off-chain mechanism ([see here for more information on how this is done](https://github.com/balancer/bal-mining-scripts/))
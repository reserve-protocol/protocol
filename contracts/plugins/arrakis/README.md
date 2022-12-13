# Arrakis Collateral Plugins - Documentation
### Author: [Shr1ftyy](https://github.com/Shr1ftyy)
## 1.0 Arrakis Vault Token Plugins 

### 1.1 Introduction 

An Arrakis Vault Token represents the **a share of a share** underlying tokens ($A$ & $B$) in a Uniswap V3 pool. This is because Arrakis Vaults are simply LP positions in Uniswap V3, and users of Arrakis vaults essentially add liquidity to Arrakis's position on Uniswap V3 when they deposit their tokens into an Arrakis Vault.
The dollar value of a share (`tok`) of pool increases over time as more users swap from token $A$ 
to token $B$ and vice versa, paying fees which are accrued onto the Arrakis position in Uniswap. Please refer to Arrakis 
Finance's [documentation](https://docs.arrakis.fi/) as and Uniswap's [documentation](https://docs.uniswap.org/contracts/v3/reference/overview) and their [whitepaper](https://uniswap.org/whitepaper-v3.pd) for more details. 

This plugin currently supports both non-fiat and usd-pegged stablecoin pair LP tokens are supported.

### 1.2 Units and Price Calculations

This plugins uses the [Defi Protocol Invariant](https://github.com/reserve-protocol/protocol/blob/master/docs/collateral.md#defi-protocol-invariant) to calculate $\frac{\text{ref}}{\text{tok}}$ as shown below:

$$ \frac{\text{ref}}{\text{tok}} = \frac{\sqrt{xy}}{L}, \text{where }$$

$$ x \text{ and } y \text{ are the amount of tokens } A \text{ and } B \text{ in the vault respectively,} $$

$$ \text{and } L \text{ is the total } \text{supply of vault tokens. } $$

Methods used price of an LP token, as well as fiat peg related variables are highlighted below

$$ P_A = \frac{\text{UoA}}{A}, P_B = \frac{\text{UoA}}{B} $$

$$ \text{where } P_A, P_B \text{ denote the intended price of the tokens (if they're pegged)} $$

$$ P_{\rho} = \frac{P_{A}'x + P_{B}'y}{L}, $$

$$ \delta_A = P_A \tau $$

$$ \delta_B = P_B \tau $$

$$ \text{where } P_{\rho}, P_{A}',  P_{B}' \text{ is the live price of a vault token, token } A, \text{ token } B, $$

$$ \tau \text{ and is price drift default threshold for stablecoins} $$

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

Deploy [ArrakisVaultCollateral.sol](./ArrakisVaultCollateral.sol) with construct args:
``` cpp
uint192 fallbackPrice_, // fallback price

uint256 tokenisFiat_, 
// bitmap of which tokens are fiat:
// e.g if the bit representation of tokenisFiat is:
// 00...001 -> token0 is pegged to UoA
// 00...010 -> token1 is pegged to UoA
// 00...011 -> both of them are pegged to UoA;

AggregatorV3Interface token0chainlinkFeed_, // chainlink feed for {uoa/token0}
AggregatorV3Interface token1chainlinkFeed_, // chainlink feed for {uoa/token1}
int8 token0Decimals_, // decimal precision of token0
int8 token1Decimals_, // decimals precision of token1
IERC20Metadata erc20_, // address of LP token
uint192 maxTradeVolume_, // max trade volume - default

uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // FSV2SQRT{token0 symbol}{token1 symbol}
uint192 defaultThreshold_, // maximum price drift from peg (%) - default
uint256 delayUntilDefault_, // time till status goes from IFFY to DISABLED
```
## 3.0 Testing 
The unit tests for the plugin is in [ArrakisVaultCollateral.test.ts](../../../test/integration/individual-collateral/ArrakisVaultCollateral.test.ts), and run at block number `16136927`
<!-- 
## 4.0 Addressing Slither Findings
Slither was used to scan the plugin contracts for vulnerabilities, the reported findings for each contract are described below:

- `ArrakisVaultCollateral.sol`:
  - `Possible reentrancy in refresh() initiated by the external call IArrakisPair(address(erc20)).addInterest().  - L#68`. This external call does not create a reentrancy attack vector in this contract, and hence can be dismissed. -->
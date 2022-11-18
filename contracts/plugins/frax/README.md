# Fraxlend Collateral Plugins - Documentation
## 1.0 FraxSwap LP Token Plugins - 
**IGNORE THIS FOR NOW - THIS IS A WIP**

LP Token represents the share of underlying tokens ($A$ & $B$) in a pool     

  $$
  \text{Let } X \text { be some unit to test the stability of tokens off of (can be UoA = USD))} \\ 
    \frac{ref}{tok} = \frac{\sqrt{xy}}{L}, \text{where } \\
    x \text{ and } y \text{ are the amount of tokens } A \text{ and } B \\
    \text{in the pool respectively, and } L \text{ is the total }\\
    \text{supply of LP tokens }\\
    P_A = \frac{\frac{UoA}{A}}{\frac{UoA}{X}} \\
    P_B = \frac{\frac{UoA}{B}}{\frac{UoA}{X}} \\
    P_{\rho} = \frac{P_{A}'x + P_{B}'y}{L}, \\
    \text{where } P_{\rho} \text{ is the live price of an LP token and,}\\ 
    \tau \text{ be the price drift default threshold} \\ 
    \delta_A = P_A \tau \\ 
    \delta_B = P_B \tau
    $$

There are different situations 
                      
### 1.1 Defaulting Conditions    
`IFFY`:        
  - $A_X' \notin [A_X - \delta_A, A_X + \delta_A]$
  - $B_X' \notin [B_X - \delta_A, A_X + \delta_A]$
  - $B_X' \notin [B_X - \delta_A, A_X + \delta_A]$
      
## 2.0 FraxSwap Fraxlend fToken Plugin 
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
can be redeemed for.

Refer to Frax Finance's [documentation](https://docs.frax.finance/fraxlend/fraxlend-overview) for a more in-depth overview
of the inner workings of Fraxlend.

### 2.2 Units 
- `tok`: the fToken 
- `target`: the Asset token of the fToken (i.e wBTC)
- `ref`: the Asset token's underlying token (i.e BTC)
- `UoA`: USD

### 2.3 Deployment and Configuration
TODO: add stuff here
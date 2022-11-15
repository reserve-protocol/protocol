**IGNORE THIS FOR NOW - THIS IS A WIP**

LP Token represents share of underlying tokens ($A$ & $B$) in a pool     
                                                                    
- Let:

  $X$ be some unit to test the stability of tokens off of (can be UoA = USD))                                 
    $
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
    $

There are different situations 
                      
Status Conditions:    
`IFFY`:        
  - $A_X' \notin [A_X - \delta_A, A_X + \delta_A]$
  - $B_X' \notin [B_X - \delta_A, A_X + \delta_A]$
  - $B_X' \notin [B_X - \delta_A, A_X + \delta_A]$
      
      
      
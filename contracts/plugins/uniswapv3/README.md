# Uniswap V3 Collateral Plugins

### Resources used
[Uniswap V3 Whitepaper](https://uniswap.org/whitepaper-v3.pdf)  
[Uniswap V3 Online Rewferencer](https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager)

## Uniswap V3 USD Collateral

[TODO link to the collateral contract source code]

`{tok}` `UV3`  
`{ref}` Synthetic reference `UV3SQRT<A0><A1>`, like `UV3SQRTDAIUSDC` for DAI/USDC  
`{target}` `USD`  
`{UoA}` `USD`

Picking USD as target is a very common use case. Keeping `target` and `UoA` the same allows a few optimizations, hence 
the name of the collateral plugin. The contract can be extended to a more common case where both underlying assets in a Uniswap V3 pool are pegged to the same fiat currency, by adding another feed for the currency different from USD, using it as `target`, and overriding `pricePerTarget()` 
using the additional feed data.

The point of (1)
$(x + \dfrac{L}{\sqrt{p_{b}}})(y + L\sqrt{p_{a}}) = L^2$

formula 2.1 from the whitepaper

is to provide the same behavior as a constant product pool on some range $[p_{a}, p_{b}]$, i.e. we can use the same $\sqrt{x \cdot y}$ formula as `{ref}`, just like for Uniswap V2. Whenever the ratio of tokens is outside the predefined range, the position stops earning swap fees, `refPerTok` stops growing, which satisfies the non-decreasing behavior requirement.    


##### Synthetic target implementation details

{tok} UniswapV3Wrapper [TODO link] ERC20 wrapping a Uniswap V3 non-fungible liquidity position. UniswapV3Wrapper contract holds the position token, manages increasing/decreasing liquidity by its holders, and distributes rewards from the position to wrapper holders according to their balances. The ERC20 wrapper token represents shared ownership of the single non-fungible Uniswap position owned by its contract. 

Increasing/decreasing liquidity is permissionless - any address can add liquidity to the wrapped position by spending the required assets after approving their spending to UniswapV3Wrapper, and any address can remove liquidity by burning owned wrapper tokens.

{ref} Synthetic reference `UV3SQRT<A0><A1>`, where `A0` an `A1` are assets locked in a non-fungible Position on uniswap v3 pool wrapped with ERC20(UniswapV3Wrapper) token.

Due to Uniswap V3 contracts being non-upgradeable and implementing rather straighforward math, keeping their invariant (1), it is safe to define its `targetPerRef()` as 1 (`FIX_ONE`)

For the same reasons, `refPerTok()` will 
* keep its value on liquidity added and taken away through UniswapV3Wrapper
* grow on swaps when the asset ratio is within the fees receiving range due to fees being collecgted
* keep its value when the asset ratio is outside the range
* grow in the unlikely case when liquidity is added via Uniswap's NonFungiblePositionManager directly

Removing liquidity without using UniswapV3Wrapper can't happen, since the contract creates the position when it's deployed and keeps it forever.

##### IFFY/DISABLED status criteria

The contract sets `IFFY` status whenever one of the following is true:

* price of one of the assets is away from its peg value according to the oracle feed
* price of one of the assets is unknown due to its oracle feed interaction being unsuccessful for any reason  
* the pool is far enough from its 1:1 balance point, according to a disbalance threshold value defined on deploy

The mechanism of transitioning from IFFY to DISABLED is inherited from `Collateral` [TODO src link]



`claimRewards()` emits `RewardsClaimed(IERC20 indexed erc20, uint256 indexed amount)`
Rewards are claimed pro-rata between holders of the ERC20 wrapper token. Rewards distrubution mechanism is similar to that of [Aave Collateral Plugin TODO src link] simplified.

`strictPrice()`
Two oracle feeds are used to determine the price of the collateral.

In general case feeds are independent and do not guarantee calls to both feeds made in one transaction returning asset prices for the same tick or from the same price source. Therefore, calculated prices may fluctuate.

`strictPrice()` reverts when  
* the amount of liquidity in the wrapped position is 0
* feed interaction reverts

`fallbackPrice()` vs `_fallbackPrice()`
`_fallbackPrice()` uses 2 predefined values and the wrapped positions's principle to calculate the current price of liquidity unit. 

Thus, the user can evaluate the cost of increasing liquidity in the wrapped position before doing so, even. The original implementation remained untouched. We should discuss this with `reserve`.

`refPerTok()`
//TODO

`targetPerRef()`
The target is the same as ref, so the rate is always constant equal to one

Judging Criteria

​ If there are multiple submissions in this category that meet all acceptance criteria, we will decide the grant winner based on the following judgments: ​

    How clear, clean, and solidly-engineered is the implementation?
    How gas-efficient is the implementation? The Reserve protocol makes heavy use of the refresh(), price(), and status() functions, for users’ sake these need to be especially efficient.
    How easy is it to reason about what these Collateral plugins do?
    Do we see technical or economic vulnerabilities in these plugins, and how severe are they?
    Could these plugins be deployed and used on mainnet immediately, or are they missing prerequisites? For instance, do they require price feeds or trading mechanisms that don’t already exist?
    How large is the range of significant, natural use cases covered by this set of Collateral plugins? Example of this further described below. ​

For an illustration of “range of use cases,” when we implemented our Compound collateral plugins, we thought it important to implement three different kinds of Collateral contracts to capture three substantially different kinds of Compound-wrapped tokens:

    Tokens where the underlying token is a fiatcoin, and the Collateral plugin should default if the underlying token’s price diverges from the target unit’s price. For instance, cUSDC is redeemable for USDC, and the plugin should default if USDC loses its peg to USD.
    Tokens where the underlying token is pegged to some unstable asset, and the Collateral plugin should default if the underlying token’s price diverges from the target unit’s price. For instance, cWBTC has underlying token WBTC, and the plugin should default if WBTC loses its peg to BTC.
    Tokens where the underlying token simply is the target asset, and requires no default check. For instance, cETH has underlying token ETH, and so the underlying token itself needs no default check.

​ If we had implemented only one or two of these, the range of use cases would be notably smaller. The degree to which each Collateral plugin is configurable will also contribute to the range of use cases covered by the set of plugins. Again, we expect the already-existing Collateral plugins should be a good guide here. ​
### notes TODO

* price out of position bounds - TODO

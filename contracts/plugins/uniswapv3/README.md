1. USD target version
1. multiple feeds as collateral constructor args


### Using Uniswap V3 LP Tokens

#### Synthetic target implementation.

{tok} UniswapV3Collateral

{ref} Position on uniswap v3 pool wrapped with ERC20(UniswapV3Wrapper) token

{target} UNIV3TOK0TOK1FEE

`describe how to bounds affects prices. is it bounds part of target`

This token can be traded only for positions on same Uniswap V3 Pool `or no?`

`claimRewards()` emits `RewardsClaimed(IERC20 indexed erc20, uint256 indexed amount)`
Rewards are claimed pro-rata on depends on ownes of collatral token.

`strictPrice()`
We use two feeds to determine the value of the collateral. For each asset held by a Uniswap V3, a separate pool is used to provide price.

Feeds usually are independent and do not guarantee simultaneous calls will return asset prices at the same tick and from the same price source. Therefore, the value may have small fluctuations.

strictPrice only reverts if totalSupply of wrapped unit is 0.

`fallbackPrice()` vs
`_fallbackPrice()`
The original interface assumes the use of some predefined value as a fallback price.
We have implemented \_fallbackPrice() as the current cost per unit of liquidity on a given poolю Thus, the user can evaluate the value of a position when adding liquidity to it. The original implementation remained untouched. We should discuss this with `reserve`.

`refPerTok()`
There are nothing to check on position. Position has only liquidity.
Only possible non constant implementation is totalSupply() == liquidity? 1 : 0. Which still remains constant. `tbd`

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
* increasing / decreasing liquidity is
  * permissionless
  * does not change refPerTok
* price out of position bounds - TODO
https://gitcoin.co/issue/29515
Collateral Plugin - Convex - Volatile Curve Pools 

https://gitcoin.co/issue/29516
Collateral Plugin - Convex - Stable Curve Pools


/CRYPTO POOLS like USDT-BTC-WETH - strict order
//STABLE POOLS like DAI-USDC-USDT
//TODO REPORT_GAS FOR REFRESH
//TODO use shutdown in REFRESH
//TODO shutdown in refresh
// {
//     index: 9,
//     poolInfo: [
//       '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
//       '0x30D9410ED1D5DA1F6C8391af5338C93ab8d4035C',
//       '0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A',
//       '0x689440f2Ff927E1f24c72F1087E1FAF471eCe1c8',
//       '0x0000000000000000000000000000000000000000',
//       false,
//       lptoken: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
//       token: '0x30D9410ED1D5DA1F6C8391af5338C93ab8d4035C',
//       gauge: '0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A',
//       crvRewards: '0x689440f2Ff927E1f24c72F1087E1FAF471eCe1c8',
//       stash: '0x0000000000000000000000000000000000000000',
//       shutdown: false
//     ]
//   }
// lptoken:  the underlying token(ex. the curve lp token)
// token: the convex deposit token(a 1:1 token representing an lp deposit).  The supply of this token can be used to calculate the TVL of the pool
// gauge: the curve "gauge" or staking contract used by the pool
// crvRewards: the main reward contract for the pool
// stash: a helper contract used to hold extra rewards (like snx) on behalf of the pool until distribution is called
// shutdown: a shutdown flag of the pool

Seems like v2 vs v1

https://classic.curve.fi/files/CurveDAO.pdf
https://classic.curve.fi/files/crypto-pools-paper.pdf   v2
https://classic.curve.fi/files/stableswap-paper.pdf     v1
https://curve.readthedocs.io/exchange-cross-asset-swaps.html

https://www.curve.fi/contracts

# Matrix of fees
https://resources.curve.fi/crv-token/understanding-crv#the-crv-matrix

https://github.com/convex-eth/platform
https://docs.convexfinance.com/convexfinanceintegration/booster



https://docs.yearn.finance/vaults/yearn-lens/
Registry adapters have the ability to return metadata specific to an asset type (for example for vaults: pricePerShare, controller, etc.)

https://curve.readthedocs.io/registry-registry.html


https://github.com/yearn/yearn-lens/blob/584df312b84b005f2ae3668c5908de82d2e844cd/contracts/Oracle/Calculations/Curve.sol#L378


https://github.com/yearn/yearn-lens/blob/master/contracts/Oracle/Calculations/Curve.sol

interface ICurveRegistry {
    function get_pool_from_lp_token(address arg0)
        external
        view
        returns (address);

    function get_underlying_coins(address arg0)
        external
        view
        returns (address[8] memory);

    function get_virtual_price_from_lp_token(address arg0)
        external
        view
        returns (uint256);
}

//https://github.com/yearn/yearn-lens/tree/master/contracts/Oracle/Calculations
// calculates price based on amount out
// we tries to calculate based on burn?


withdraw

function withdraw()

Withdraws the calling account's tokens from this Vault, redeeming amount _shares for an appropriate amount of tokens. See note on setWithdrawalQueue for further details of withdrawal ordering and behavior.

Measuring the value of shares is based on the total outstanding debt that this contract has ("expected value") instead of the total balance sheet it has ("estimated value") has important security considerations, and is done intentionally. If this value were measured against external systems, it could be purposely manipulated by an attacker to withdraw more assets than they otherwise should be able to claim by redeeming their shares. On withdrawal, this means that shares are redeemed against the total amount that the deposited capital had "realized" since the point it was deposited, up until the point it was withdrawn. If that number were to be higher than the "expected value" at some future point, withdrawing shares via this method could entitle the depositor to more than the expected value once the "realized value" is updated from further reports by the Strategies to the Vaults. Under exceptional scenarios, this could cause earlier withdrawals to earn "more" of the underlying assets than Users might otherwise be entitled to, if the Vault's estimated value were otherwise measured through external means, accounting for whatever exceptional scenarios exist for the Vault (that aren't covered by the Vault's own design.) In the situation where a large withdrawal happens, it can empty the vault balance and the strategies in the withdrawal queue. Strategies not in the withdrawal queue will have to be harvested to rebalance the funds and make the funds available again to withdraw.
Parameters:
Name	Type	Description
maxShares 	* *	How many shares to try and redeem for tokens, defaults to all.
recipient 	* *	The address to issue the shares in this Vault to. Defaults to the caller's address.
maxLoss 	* *	The maximum acceptable loss to sustain on withdrawal. Defaults to 0.01%. If a loss is specified, up to that amount of shares may be burnt to cover losses on withdrawal.
Return Values:
Description
The quantity of tokens redeemed for _shares. 

https://github.com/yearn/yearn-vaults/blob/74364b2c33bd0ee009ece975c157f065b592eeaf/contracts/Vault.vy#L966
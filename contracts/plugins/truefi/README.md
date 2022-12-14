For [Gitcoin Bounty 2964](https://gitcoin.co/issue/29624)
Closes #499 {https://github.com/reserve-protocol/protocol/issues/499}

## Team Members
### Nirmal Manoj C
Email: nirmal.manoj@research.iiit.ac.in
Github: @NirmalManoj 
Telegram: `@NirmalManoj` 
Discord: nirmal#0912

### Apoorva Thirupathi
Email: apoorva.thirupathi@research.iiit.ac.in
Github: @apoorvam-web3 
Telegram: `@apoo_rva`
Discord: apoorva#9650

# Introduction 

TrueFi is one of DeFi's first uncollateralised lending protocol, powered by on-chain credit scores.

Our collateral plugin allows for TrueFi's tfUSDC [one of their lending pool tokens] to be used within the Reserve Protocol ecosystem as collateral for being used in the basket to create asset-backed currencies.

When a lender deposits their USDC to the USDC lending pool, a lender receives lending pool tokens called tfUSDC, these are tradable ERC-20 tokens that represent the lender’s proportional representation in the USDC pool, and their claim to the principal and interest due on repayment of all loans to the USDC Loan Pool. 

As the pool starts earning yields and disbursing loans, the value of the pool tokens may increase or decrease depending on returns within the pool.

Loan Tokens are tokenized IOUs. Lending Pool tokens are a collection of Loan Tokens and other pool assets that grow in value as the Lending Pool generates yield. 

TrueFi users deposit USDC into lending pools to receive tfUSDC tokens in return. TRU tokens acrrue as rewards if the tfUSDC is staked.

## Accounting Units

| `tok`  | `ref` | `tgt` | `UoA` |
| :----: | :---: | :---: | :---: |
| tfUSDC | USDC  |  USD  |  USD  |

## Main Files 
The main files for the plugin are `TFTokenCollateral.sol`, `TFTokenMock.sol`, `ITFToken.sol` and `TFTokenCollateral.test.ts`.

## Relevant External Contracts 

tfUSDC : https://etherscan.io/token/0xa991356d261fbaf194463af6df8f0464f8f1c742
Functions called from above contract in our code - poolValue() and totalSupply()

TrueMultiFarm: https://etherscan.io/address/0xec6c3FD795D6e6f202825Ddb56E01b3c128b0b10
Functions called from above contract in our code - claim(), claimable() and rewardToken()


## Implementation

Solidity code for the collateral plugin can be found [here](./TFTokenCollateral.sol), titled `TFTokenCollateral`.

Both `tfUSDC` & `USDC` use 6 decimals. Hence, we've done away with the `referenceERC20Decimals_` parameter in the constructor of TFTokenCollateral, as our contract code was exceeding the size limit & this way, we were able to deploy.

### strictPrice()

Gives the price of {tok} in terms of the {UoA}, calculated by multiplying `UoA/ref` with `refPerTok()`. 

### refPerTok()

The amount of USDC redeemable for each `tfToken` is calculated using the method mentioned [here](https://docs.truefi.io/faq/getting-started/lend/pool/how-lending-pool-lp-tokens-work#how-many-tfi-lp-tokens-will-i-get-for-lending-to-the-truefi-lending-pool) in TrueFi's documentation. There is no oracle with tfUSDC's price-feed at the moment, so we've have to take up this method instead.  

`poolValue()` - returns the value of the pool, representing the present value of all its underlying tokens (the stablecoin USDC, loan tokens, and other tokens earned) in USDC

`totalSupply()` - returns the total supply of tfUSDC

We can calculate LP token price by checking the  poolValue()  and totalSupply() read functions on the lending pool smart contract:
LP token price = `poolValue()` / `totalSupply()`

We can use this LP token price to find how many LP tokens a lender will receive in return for lending tokens to the pool.

### refresh()

#### Conditions for Defaulting 
Soft default - When USDC's[our underlying token] price falls outside the `peg-delta` price range, the `status` is marked `IFFY` and defaults eventually.  

Hard default - When the `refperTok` at time t < `refperTok` at time t-1. `refperTok` should be non-decreasing. If refperTok decreases, it is considered that TrueFi's USDC pool is exploited and status is changed to `DISABLED` immediately. 

The general scenario where LP tokens might drop in value is in the case of impermanent loss, but as tfUSDC is pegged to a stablecoin, USDC, there's a smaller price range & it is less volatile, unlike other cases of LP tokens, where the underlying is a volatile crypto asset.

Similar to Reserve's [Compound](https://github.com/reserve-protocol/protocol/blob/master/contracts/plugins/assets/CTokenFiatCollateral.sol) collateral implementation, TrueFi's tfUSDC's `status` is changed to `DISABLED` when the USDC Chainlink oracle determines that USDC has lost its peg or the oracle malfunctions. 


`pricePerTarget()` returns 1 as target is USD

`targetPerRef()` returns 1 as our `{ref}` is a stablecoin for USD, our target. 

`status()`, `isCollateral()` & `targetName()` follow the implementation made the parent class. 

`claimRewards()` - In the case of tfUSDC, one accrues TRU rewards only if the token is staked. In order to use staked tfUSDC as collateral, we must create a wrapper token & rewards can be handed out to holders of the wrapped token, which we're yet to figure out how to do exactly. 

Currently, this functionality isn't a part of our code and claimRewards() doesnt do anything for now. 

### Deployment 

Deploy the collateral plugin `TFTokenCollateral.sol` with constructor arguments

```
uint192 fallbackPrice_, // 1 USDC
AggregatorV3Interface chainlinkFeed_, // USDC Price Feed
IERC20Metadata erc20_, // tfUSDC instance
uint192 maxTradeVolume_, // system default 
uint48 oracleTimeout_, // system default
bytes32 targetName_, // USD
uint192 defaultThreshold_, // system default
uint256 delayUntilDefault_, // system default
ITRUFarm trufarm_ // trufarm instance
```

### Testing 

To test the plugin for tfUSDC, run `yarn test:tf`, this will run the `TFTokenCollateral.test.ts` file. 
 
## Notes 

The unit tests in `TFTokenCollateral.test.ts` are predicated on `trueFi-deployment = 16159074`, a very recent block, and the fallback prices are from said block. This block has been chosen for the ease of calculation and checking by reading as proxy from Etherscan on the date of writing the code. The default block was an old one and the values from that block varied greatly from the current values, mainly `{ref/tok}`. 


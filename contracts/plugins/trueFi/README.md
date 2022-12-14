# TrueFi USDC Collateral Plugin - Documentation

[Gitcoin bounty 2964](https://gitcoin.co/issue/29624)

## 1.0 Introduction

### 1.1 Overview of TrueFi USDC

#### What is TrueFi?

TrueFi is an uncollateralized lending and borrowing platform that enables lenders to earn returns on loaned assets while having transparency on how the loaned capital is allocated.

#### What is tfUSDC?

TrueFi USDC (tfUSDC) is a tradeable ERC20 token that represents a lender’s proportional representation of USDC loaned to a tfUSDC/USDC lending pool.

In the beginning, when no loans have been disbursed by the TrueFi lending pool, lenders will receive one tfUSDC for every USDC lent to the pool.

As the pool starts earning yields and disbursing loans, the value of the tfUSDC token may increase or decrease depending on returns within the pool. The value of the pool represents the present value of all its underlying tokens (stablecoins, loan tokens, and other tokens earned).

#### Calculating price of tfUSDC

We can calculate tfUSDC price by checking the poolValue() and totalSupply() read functions on the lending pool smart contract:
`tfUSDC price = poolValue() / totalSupply()`
Note: The pool value is represented by the Underlying tokens(USDC)

We can use this tfUSDC price to find how many tfUSDC tokens a lender will receive in return for lending USDC tokens to the pool.

```
Example:
Bob lends 2,000,000 USDC to the tfUSDC pool.
Given that tfUSDC poolValue()= 46226887530770 and totalSupply()
42405680290948 at the time of lending,  we calculate tfUSDC LP price = 1.0901.
Bob will thus receive 2,000,000 / 1.0901 = 1,834,675.99 tfUSDC LP tokens
```

Price of tfUSDC started as 1 USDC but has increased overtime to 1.119 USDC at 12th Dec 2022

### 1.2 Overview of tfUSDC Collateral

#### Defaulting Conditions

- **Soft default**: The collateral status changes to IFFY(and eventually defaults) when USDC loses its peg to the USD
- **Hard default**: The collateral defaults immediately `refPerTok()` decreases

#### What may cause refPerTok() to decrease?

`refPerTok()`, in this case, `USDC/tfUSDC` is equal to the tfUSDC price calculated above.
The price of tfUSDC has historically grown, but may decrease in the event of a default on the tfUSDC/USDC loan pool.

**Potential risks that may cause a default on the tfUSDC/USDC loan pool**

- Potentially increased risk of loss: Protocols that require collateral are protected by that collateral in case of default. While this allows such platforms to be less selective in approving loans, uncollateralized loans come with a much higher standard of trust that must be met by a borrower. In case of default on an uncollateralized loan, a delinquent borrower will have been assessed for creditworthiness before the loan was made and will face both reputational damage and legal action.

- Potentially lower liquidity: While instant withdrawals are becoming a norm for new protocols, uncollateralized lending may not offer the same flexibility. Most borrowers for uncollateralized loans are interested in fixed-rate, fixed-term loans for predictable repayment. This means lenders who fund such loans need to be comfortable locking up their assets for the duration of the loan. TrueFi offers an alternative: the ability to withdraw their proportion of the pool tokens which would consist of stablecoins and loan tokens that you hold to maturity. You can redeem the loan tokens for the stablecoin at the end of loan terms.

### 1.3 Truefi Source location

Truefi USDC pool address is `0xA991356d261fbaF194463aF6DF8f0464F8f1c742`, and source code [TruefiPool2](https://github.com/trusttoken/contracts-pre22/contracts/truefi2/)

## 2.0 Plugin Implementation

### 2.1 Files

- **Collateral Contract**: [TfUsdcCollateral.sol](./TfUsdcCollateral.sol)
- **TrueFiPool2 interfaces**: [poolContracts](./poolContracts/)

### 2.2 Units

| `tok`  | `ref` | `target` | `UoA` |
| ------ | ----- | -------- | ----- |
| tfUSDC | USDC  | USD      | USD   |

### 2.3 Functions

- `refPerTok()`
  - Conversion rate of USDC/tfUSDC can be calculated using TrueFiPool2 functions :
    `refPerTok` = `poolValue()`/ `totalSupply()`
- `targetPerRef()`
  - Constantly returns 1
- `strictPrice()`
  - Returns `UoA/ref` \* `refPerTok()`
- `pricePerTarget()`
  - Returns 1 since `{UoA}` ==`{target}`
- `refresh()`
  - Changes Collateral Status to IFFY in case of a soft default, and DISABLED in case of a hard default.
- `claimRewards()`
  - Does nothing for now
- `status()`, `isCollateral()` & `targetName()`
  - Implemeted in Abstract Collateral Parent class

## 3.0 Tests & Deployments

### 3.1 Tests

- Integration tests for tfUSDC at [TfUsdcCollateral.test.ts](../../../test/integration/individual-collateral/TfUsdcCollateral.test.ts)
- To Run tfUSDC plugin tests,
  run `yarn test:tfUSDC` in terminal

### 3.2 Deployment

Deploy [TfUsdcCollateral](./TfUsdcCollateral.sol) with params:

```ts
    let fallbackPrice_: BigNumberish = fp('1.03')
    let chainlinkFeed_: networkConfig[chainId].chainlinkFeeds.USDC as string
    let poolAddress_: networkConfig[chainId].tokens.tfUSDC as string
    let maxTradeVolume_: config.rTokenMaxTradeVolume
    let oracleTimeout_: BigNumberish = ORACLE_TIMEOUT
    let targetName_: BytesLike =ethers.utils.formatBytes32String('USD')
    let defaultThreshold_: BigNumberish = defaultThreshold
    let delayUntilDefault_: BigNumberish = delayUntilDefault
    let referenceERC20Decimals_=6
    let truToken_:networkConfig[chainId].tokens.TRU as string

    const TfTokenCollateralFactory = await ethers.getContractFactory('TfUsdcCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    tfUsdcCollateral = <TfUsdcCollateral>(
      await TfTokenCollateralFactory.deploy(
        fallbackPrice_,
        chainlinkFeed_,
        poolAddress_,
        maxTradeVolume_,
        oracleTimeout_,
        targetName_,
        defaultThreshold_,
        delayUntilDefault_,
        referenceERC20Decimals_,
        truToken_
      )
    )
```

**NB**: Mainnet addresses for USDC chainlink feed, tfUSDC pool, and TRU added in [config file](../../../common/configuration.ts).

### Author

Github: [Emedudu](https://github.com/Emedudu)
Twitter: [https://twitter.com/Emeduduna](https://twitter.com/emeduduna)
Discord: Eme#0242

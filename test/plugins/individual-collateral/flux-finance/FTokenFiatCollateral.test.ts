import { setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  ICToken,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  USDC_HOLDER,
  USDT_HOLDER,
  FRAX_HOLDER,
  DAI_HOLDER,
  USDC_ORACLE_ERROR,
  USDT_ORACLE_ERROR,
  DAI_ORACLE_ERROR,
  FRAX_ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
} from './constants'
import { mintFToken, resetFork } from './helpers'

// FTokens are just CompoundV2 CTokens

/*
  Define interfaces
*/

interface FTokenEnumeration {
  testName: string
  underlying: string
  holderUnderlying: string
  fToken: string
  oracleError: BigNumberish
  chainlinkFeed: string
}

interface FTokenCollateralOpts extends CollateralOpts {
  comptroller?: string
  revenueHiding?: BigNumberish
}

// ====

const config = networkConfig['31337'] // use mainnet fork

// Test all 4 fTokens
const all = [
  {
    testName: 'fUSDC Collateral',
    underlying: config.tokens.USDC as string,
    holderUnderlying: USDC_HOLDER,
    fToken: config.tokens.fUSDC as string,
    oracleError: USDC_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.USDC as string,
  },
  {
    testName: 'fUSDT Collateral',
    underlying: config.tokens.USDT as string,
    holderUnderlying: USDT_HOLDER,
    fToken: config.tokens.fUSDT as string,
    oracleError: USDT_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.USDT as string,
  },
  {
    testName: 'fFRAX Collateral',
    underlying: config.tokens.FRAX as string,
    holderUnderlying: FRAX_HOLDER,
    fToken: config.tokens.fFRAX as string,
    oracleError: FRAX_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.FRAX as string,
  },
  {
    testName: 'fDAI Collateral',
    underlying: config.tokens.DAI as string,
    holderUnderlying: DAI_HOLDER,
    fToken: config.tokens.fDAI as string,
    oracleError: DAI_ORACLE_ERROR,
    chainlinkFeed: config.chainlinkFeeds.DAI as string,
  },
]
all.forEach((curr: FTokenEnumeration) => {
  const defaultCollateralOpts: FTokenCollateralOpts = {
    erc20: curr.fToken,
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: curr.chainlinkFeed,
    oracleTimeout: ORACLE_TIMEOUT,
    oracleError: curr.oracleError,
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    comptroller: config.FLUX_FINANCE_COMPTROLLER,
    revenueHiding: 0,
  }

  const deployCollateral = async (opts: FTokenCollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCollateralOpts, ...opts }

    const FTokenCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'CTokenFiatCollateral'
    ) // fTokens are the same as cTokens modulo some extra stuff we don't care about

    const collateral = <TestICollateral>await FTokenCollateralFactory.deploy(
      {
        erc20: opts.erc20,
        targetName: opts.targetName,
        priceTimeout: opts.priceTimeout,
        chainlinkFeed: opts.chainlinkFeed,
        oracleError: opts.oracleError,
        oracleTimeout: opts.oracleTimeout,
        maxTradeVolume: opts.maxTradeVolume,
        defaultThreshold: opts.defaultThreshold,
        delayUntilDefault: opts.delayUntilDefault,
      },
      opts.revenueHiding,
      { gasLimit: 2000000000 }
    )
    await collateral.deployed()

    // Push forward chainlink feed
    await pushOracleForward(opts.chainlinkFeed!)

    // sometimes we are trying to test a negative test case and we want this to fail silently
    // fortunately this syntax fails silently because our tools are terrible
    await expect(collateral.refresh())

    return collateral
  }

  type Fixture<T> = () => Promise<T>

  const makeCollateralFixtureContext = (
    alice: SignerWithAddress,
    opts: FTokenCollateralOpts = {}
  ): Fixture<CollateralFixtureContext> => {
    const collateralOpts = { ...defaultCollateralOpts, ...opts }

    const makeCollateralFixtureContext = async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
      collateralOpts.chainlinkFeed = chainlinkFeed.address

      const collateral = await deployCollateral(collateralOpts)
      const erc20 = await ethers.getContractAt('ICToken', (await collateral.erc20()) as string) // the fToken

      return {
        alice,
        collateral,
        chainlinkFeed,
        tok: erc20,
      }
    }

    return makeCollateralFixtureContext
  }

  /*
  Define helper functions
*/

  const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
    ctx: CollateralFixtureContext,
    amount: BigNumberish,
    user: SignerWithAddress,
    recipient: string
  ) => {
    const tok = ctx.tok as ICToken
    const underlying = await ethers.getContractAt('IERC20Metadata', await tok.underlying())
    await mintFToken(underlying, curr.holderUnderlying, tok, amount, recipient)
  }

  const reduceTargetPerRef = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
    const lastRound = await ctx.chainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  }

  const increaseTargetPerRef = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
    const lastRound = await ctx.chainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
    await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  }

  const increaseRefPerTok = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
    const totalSupply = await ctx.tok.totalSupply()
    await setStorageAt(
      ctx.tok.address,
      13, // interesting, the storage slot is 13 for fTokens and 14 for cTokens
      totalSupply.sub(totalSupply.mul(pctIncrease).div(100))
    ) // expand supply by pctDecrease, since it's denominator of exchange rate calculation
  }

  const reduceRefPerTok = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
    const totalSupply = await ctx.tok.totalSupply()
    await setStorageAt(
      ctx.tok.address,
      13, // interesting, the storage slot is 13 for fTokens and 14 for cTokens
      totalSupply.add(totalSupply.mul(pctDecrease).div(100))
    ) // expand supply by pctDecrease, since it's denominator of exchange rate calculation
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const collateralSpecificConstructorTests = () => {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const collateralSpecificStatusTests = () => {}

  const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
    const initRefPerTok = await ctx.collateral.refPerTok()

    const decimals = await ctx.chainlinkFeed.decimals()

    const initData = await ctx.chainlinkFeed.latestRoundData()
    return initData.answer
      .mul(bn(10).pow(18 - decimals))
      .mul(initRefPerTok)
      .div(fp('1'))
  }

  /*
    Run the test suite
  */

  const emptyFn = () => {
    return
  }

  const opts = {
    deployCollateral,
    collateralSpecificConstructorTests,
    collateralSpecificStatusTests,
    beforeEachRewardsTest: emptyFn,
    makeCollateralFixtureContext,
    mintCollateralTo,
    reduceTargetPerRef,
    increaseTargetPerRef,
    reduceRefPerTok,
    increaseRefPerTok,
    getExpectedPrice,
    itClaimsRewards: it.skip,
    itChecksTargetPerRefDefault: it,
    itChecksTargetPerRefDefaultUp: it,
    itChecksRefPerTokDefault: it,
    itChecksPriceChanges: it,
    itChecksNonZeroDefaultThreshold: it,
    itHasRevenueHiding: it,
    resetFork,
    collateralName: curr.testName,
    chainlinkDefaultAnswer: bn('1e8'),
    itIsPricedByPeg: true,
  }

  collateralTests(opts)
})

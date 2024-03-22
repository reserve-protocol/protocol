import { networkConfig } from '#/common/configuration'
import { bn, fp } from '#/common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { TestICollateral } from '@typechain/TestICollateral'
import { MockV3Aggregator__factory } from '@typechain/index'
import { expect } from 'chai'
import { BigNumber, BigNumberish, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import collateralTests from '../collateralTests'
import { getResetFork } from '../helpers'
import { CollateralOpts, CollateralFixtureContext } from '../pluginTestTypes'
import { pushOracleForward } from '../../../utils/oracles'
import { MAX_UINT192 } from '#/common/constants'
import {
  DELAY_UNTIL_DEFAULT,
  FORK_BLOCK,
  PYUSD_ORACLE_ERROR,
  PYUSD_ORACLE_TIMEOUT,
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  PRICE_TIMEOUT,
} from './constants'
import { mintCollateralTo } from './mintCollateralTo'

interface MAFiatCollateralOpts extends CollateralOpts {
  defaultPrice?: BigNumberish
  defaultRefPerTok?: BigNumberish
}

const makeFiatCollateralTestSuite = (
  collateralName: string,
  defaultCollateralOpts: MAFiatCollateralOpts
) => {
  const deployCollateral = async (opts: MAFiatCollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCollateralOpts, ...opts }

    const MetaMorphoCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'MetaMorphoFiatCollateral'
    )
    const collateral = <TestICollateral>await MetaMorphoCollateralFactory.deploy(
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

    await expect(collateral.refresh())

    return collateral
  }

  type Fixture<T> = () => Promise<T>

  const makeCollateralFixtureContext = (
    alice: SignerWithAddress,
    inOpts: MAFiatCollateralOpts = {}
  ): Fixture<CollateralFixtureContext> => {
    const makeCollateralFixtureContext = async () => {
      const opts = { ...defaultCollateralOpts, ...inOpts }

      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      const chainlinkFeed = <MockV3Aggregator>(
        await MockV3AggregatorFactory.deploy(8, opts.defaultPrice!)
      )
      opts.chainlinkFeed = chainlinkFeed.address

      // Hack: use wrapped vault by default unless the maxTradeVolume is infinite, in which
      //       case the mock would break things. Care! Fragile!
      if (!opts.maxTradeVolume || !MAX_UINT192.eq(opts.maxTradeVolume)) {
        const mockMetaMorphoFactory = await ethers.getContractFactory('MockMetaMorpho4626')
        const mockERC4626 = await mockMetaMorphoFactory.deploy(opts.erc20!)
        opts.erc20 = mockERC4626.address
      }

      const collateral = await deployCollateral({ ...opts })
      const tok = await ethers.getContractAt('IERC20Metadata', await collateral.erc20())
      return {
        alice,
        collateral,
        chainlinkFeed,
        tok,
      } as CollateralFixtureContext
    }

    return makeCollateralFixtureContext
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

  const reduceRefPerTok = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
    const mockERC4626 = await ethers.getContractAt('MockMetaMorpho4626', ctx.tok.address)
    await mockERC4626.applyMultiple(bn('100').sub(pctDecrease).mul(fp('1')).div(100))
  }

  const increaseRefPerTok = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
    const mockERC4626 = await ethers.getContractAt('MockMetaMorpho4626', ctx.tok.address)
    await mockERC4626.applyMultiple(bn('100').add(pctIncrease).mul(fp('1')).div(100))
  }

  const getExpectedPrice = async (ctx: CollateralFixtureContext): Promise<BigNumber> => {
    const clData = await ctx.chainlinkFeed.latestRoundData()
    const clDecimals = await ctx.chainlinkFeed.decimals()

    const refPerTok = await ctx.collateral.refPerTok()
    return clData.answer
      .mul(bn(10).pow(18 - clDecimals))
      .mul(refPerTok)
      .div(fp('1'))
  }

  /*
    Define collateral-specific tests
  */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const collateralSpecificConstructorTests = () => {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const collateralSpecificStatusTests = () => {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const beforeEachRewardsTest = async () => {}

  const opts = {
    deployCollateral,
    collateralSpecificConstructorTests,
    collateralSpecificStatusTests,
    beforeEachRewardsTest,
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
    resetFork: getResetFork(FORK_BLOCK),
    collateralName,
    chainlinkDefaultAnswer: defaultCollateralOpts.defaultPrice!,
    itIsPricedByPeg: true,
    toleranceDivisor: bn('1e9'), // 1 part in 1 billion
  }

  collateralTests(opts)
}

const makeOpts = (
  vault: string,
  chainlinkFeed: string,
  oracleTimeout: BigNumber,
  oracleError: BigNumber
): MAFiatCollateralOpts => {
  return {
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: PRICE_TIMEOUT,
    oracleTimeout: oracleTimeout,
    oracleError: oracleError,
    defaultThreshold: oracleError.add(fp('0.01')),
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    maxTradeVolume: fp('1e6'),
    revenueHiding: fp('0'),
    defaultPrice: bn('1e8'),
    defaultRefPerTok: fp('1'),
    erc20: vault,
    chainlinkFeed,
  }
}

/*
  Run the test suite
*/
const { tokens, chainlinkFeeds } = networkConfig[31337]
makeFiatCollateralTestSuite(
  'MetaMorphoFiatCollateral - steakUSDC',
  makeOpts(tokens.steakUSDC!, chainlinkFeeds.USDC!, USDC_ORACLE_TIMEOUT, USDC_ORACLE_ERROR)
)
makeFiatCollateralTestSuite(
  'MetaMorphoFiatCollateral - steakPYUSD',
  makeOpts(tokens.steakPYUSD!, chainlinkFeeds.pyUSD!, PYUSD_ORACLE_TIMEOUT, PYUSD_ORACLE_ERROR)
)
makeFiatCollateralTestSuite(
  'MetaMorphoFiatCollateral - bbUSDT',
  makeOpts(tokens.bbUSDT!, chainlinkFeeds.USDT!, USDT_ORACLE_TIMEOUT, USDT_ORACLE_ERROR)
)

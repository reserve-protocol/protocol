import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintSUSDS } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  IERC20Metadata,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  USDS_USD_PRICE_FEED,
  SUSDS,
} from './constants'
import { setCode } from '@nomicfoundation/hardhat-network-helpers'

/*
  Define deployment functions
*/

export const defaultSUSDSCollateralOpts: CollateralOpts = {
  erc20: SUSDS,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDS_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultSUSDSCollateralOpts, ...opts }

  const SUSDSCollateralFactory: ContractFactory = await ethers.getContractFactory('SUSDSCollateral')
  const collateral = <TestICollateral>await SUSDSCollateralFactory.deploy(
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

const chainlinkDefaultAnswer = bn('1e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<CollateralFixtureContext> => {
  const collateralOpts = { ...defaultSUSDSCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const susds = (await ethers.getContractAt('IERC20Metadata', SUSDS)) as IERC20Metadata
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tok = await ethers.getContractAt('IERC20Metadata', await collateral.erc20())

    return {
      alice,
      collateral,
      chainlinkFeed,
      tok,
      susds,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
  ctx: CollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintSUSDS(ctx.tok, user, amount, recipient)
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

const changeRefPerTok = async (ctx: CollateralFixtureContext, percentChange: BigNumberish) => {
  // get current chi
  const collateral = await ethers.getContractAt('SUSDSCollateral', ctx.collateral.address)
  const susds = await ethers.getContractAt('ISUsds', await collateral.erc20())
  await susds.drip()

  const chi = await susds.chi()

  // save old bytecode
  const oldBytecode = await network.provider.send('eth_getCode', [susds.address])

  // replace with mock (includes setter)
  const mockFactory = await ethers.getContractFactory('SUsdsMock')
  const mock = await mockFactory.deploy(await susds.usdsJoin(), await susds.vow())
  const bytecode = await network.provider.send('eth_getCode', [mock.address])
  await setCode(susds.address, bytecode)

  // set new rate
  const susdsAsMock = await ethers.getContractAt('SUsdsMock', susds.address)
  const newChi = chi.add(chi.mul(bn(percentChange)).div(bn('100')))
  await susdsAsMock.setChi(newChi)

  // restore bytecode
  await setCode(susds.address, oldBytecode)
}

const reduceRefPerTok = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))
}

const increaseRefPerTok = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctIncrease))
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

/*
  Run the test suite
*/

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
  itHasRevenueHiding: it.skip,
  resetFork,
  collateralName: 'SUSDSCollateral',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
  toleranceDivisor: bn('1e8'),
}

collateralTests(opts)

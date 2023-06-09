import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintSDAI } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  ISavingsDai,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  SDAI,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  DAI_USD_PRICE_FEED,
} from './constants'
import { advanceTime } from '#/test/utils/time'

interface SDaiCollateralFixtureContext extends CollateralFixtureContext {
  sdai: ISavingsDai
}

/*
  Define deployment functions
*/

export const defaultSDaiCollateralOpts: CollateralOpts = {
  erc20: SDAI,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: DAI_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultSDaiCollateralOpts, ...opts }

  const SDaiCollateralFactory: ContractFactory = await ethers.getContractFactory('SDaiCollateral')

  const collateral = <TestICollateral>await SDaiCollateralFactory.deploy(
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
): Fixture<SDaiCollateralFixtureContext> => {
  const collateralOpts = { ...defaultSDaiCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const sdai = (await ethers.getContractAt('ISavingsDai', SDAI)) as ISavingsDai
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      tok: sdai,
      sdai,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const mintCollateralTo: MintCollateralFunc<SDaiCollateralFixtureContext> = async (
  ctx: SDaiCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintSDAI(ctx.tok, user, amount, recipient)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

// prettier-ignore
const reduceRefPerTok = async (
  // ctx: SDaiCollateralFixtureContext,
  // pctDecrease: BigNumberish 
) => {
  // await whileImpersonating(await ctx.sdai.pot(), async (signer) => {
  //   console.log("burning", potBal.mul(fp(pctDecrease)).div(bn('100')))
  //   await dai.connect(signer).burn(signer.address, potBal.mul(pctDecrease).div(bn('100')))
  // })
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: SDaiCollateralFixtureContext,
) => {
  await advanceTime(3600)
  const pot = await ethers.getContractAt('IPot', await ctx.sdai.pot())
  await pot.drip();
}

const getExpectedPrice = async (ctx: SDaiCollateralFixtureContext): Promise<BigNumber> => {
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
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it.skip, // TODO make reduceRefPerTok work
  itChecksPriceChanges: it,
  itHasRevenueHiding: it.skip, // TODO make reduceRefPerTok work
  resetFork,
  collateralName: 'SDaiCollateral',
  chainlinkDefaultAnswer,
}

collateralTests(opts)

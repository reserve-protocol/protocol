import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintAnkrETH } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IAnkrETH,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ANKRETH,
  ANKRETH_OWNER,
  ETH_USD_PRICE_FEED,
} from './constants'
import { whileImpersonating } from '../../../utils/impersonation'

/*
  Define interfaces
*/

interface AnkrETHCollateralFixtureContext extends CollateralFixtureContext {
  ankreth: IAnkrETH
}

/*
  Define deployment functions
*/

export const defaultAnkrEthCollateralOpts: CollateralOpts = {
  erc20: ANKRETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultAnkrEthCollateralOpts, ...opts }

  const AnkrETHCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'AnkrStakedEthCollateral'
  )

  const collateral = <TestICollateral>await AnkrETHCollateralFactory.deploy(
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

const chainlinkDefaultAnswer = bn('1600e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<AnkrETHCollateralFixtureContext> => {
  const collateralOpts = { ...defaultAnkrEthCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const ankreth = (await ethers.getContractAt('IAnkrETH', ANKRETH)) as IAnkrETH
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      ankreth,
      tok: ankreth,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<AnkrETHCollateralFixtureContext> = async (
  ctx: AnkrETHCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintAnkrETH(ctx.ankreth, user, amount, recipient)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

const reduceRefPerTok = async (ctx: AnkrETHCollateralFixtureContext, pctDecrease: BigNumberish) => {
  const ankrETH = (await ethers.getContractAt('IAnkrETH', ANKRETH)) as IAnkrETH

  // Increase ratio so refPerTok decreases
  const currentRatio = await ankrETH.ratio()
  const newRatio: BigNumberish = currentRatio.add(currentRatio.mul(pctDecrease).div(100))

  // Impersonate AnkrETH Owner
  await whileImpersonating(ANKRETH_OWNER, async (ankrEthOwnerSigner) => {
    await ankrETH.connect(ankrEthOwnerSigner).updateRatio(newRatio)
  })
}

const increaseRefPerTok = async (
  ctx: AnkrETHCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const ankrETH = (await ethers.getContractAt('IAnkrETH', ANKRETH)) as IAnkrETH

  // Decrease ratio so refPerTok increases
  const currentRatio = await ankrETH.ratio()
  const newRatio: BigNumberish = currentRatio.sub(currentRatio.mul(pctIncrease).div(100))

  // Impersonate AnkrETH Owner
  await whileImpersonating(ANKRETH_OWNER, async (ankrEthOwnerSigner) => {
    await ankrETH.connect(ankrEthOwnerSigner).updateRatio(newRatio)
  })
}

const getExpectedPrice = async (ctx: AnkrETHCollateralFixtureContext): Promise<BigNumber> => {
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
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it,
  resetFork,
  collateralName: 'AnkrStakedETH',
  chainlinkDefaultAnswer,
}

collateralTests(opts)

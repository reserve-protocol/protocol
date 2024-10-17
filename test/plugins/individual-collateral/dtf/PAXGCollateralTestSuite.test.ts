import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintPAXG } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import { MockV3Aggregator, MockV3Aggregator__factory, TestICollateral } from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  DELAY_UNTIL_DEFAULT,
  PAXG,
  ONE_PERCENT_FEE,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  XAU_USD_PRICE_FEED,
} from './constants'

/*
  Define deployment functions
*/

interface PAXGCollateralOpts extends CollateralOpts {
  fee?: BigNumberish
}

export const defaultPAXGCollateralOpts: PAXGCollateralOpts = {
  erc20: PAXG,
  targetName: `DMR100XAU`,
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: XAU_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  fee: ONE_PERCENT_FEE,
}

export const deployCollateral = async (opts: PAXGCollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultPAXGCollateralOpts, ...opts }

  const PAXGCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'DemurrageCollateral'
  )
  const collateral = <TestICollateral>await PAXGCollateralFactory.deploy(
    {
      erc20: opts.erc20,
      targetName: opts.targetName,
      priceTimeout: opts.priceTimeout,
      chainlinkFeed: opts.chainlinkFeed,
      oracleError: opts.oracleError,
      oracleTimeout: opts.oracleTimeout,
      maxTradeVolume: opts.maxTradeVolume,
      defaultThreshold: bn('0'),
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
    },
    {
      isFiat: false,
      targetUnitFeed0: false,
      fee: opts.fee,
      feed1: ZERO_ADDRESS,
      timeout1: bn(0),
      error1: bn(0),
    },
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()
  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('266347300000') // $2,663.473

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: PAXGCollateralOpts = {}
): Fixture<CollateralFixtureContext> => {
  const collateralOpts = { ...defaultPAXGCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const collateral = await deployCollateral(collateralOpts)
    const tok = await ethers.getContractAt('IERC20Metadata', await collateral.erc20())

    return {
      alice,
      collateral,
      chainlinkFeed,
      tok,
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
  await mintPAXG(ctx.tok, amount, recipient)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceRefPerTok = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseRefPerTok = async () => {}

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
  itChecksTargetPerRefDefault: it.skip,
  itChecksTargetPerRefDefaultUp: it.skip,
  itChecksNonZeroDefaultThreshold: it.skip,
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  itChecksPriceChangesRefPerTok: it.skip,
  itHasRevenueHiding: it.skip,
  resetFork,
  collateralName: 'PAXG Demurrage Collateral',
  chainlinkDefaultAnswer,
  itIsAXGCricedByPeg: true,
  toleranceDivisor: bn('1e8'), // 1-part in 100 million
}

collateralTests(opts)

import collateralTests from '../collateralTests'
import {
  CurveCollateralFixtureContext,
  CurveMetapoolCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { makeWeUSDFraxBP, mintWeUSDFraxBP, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS, ONE_ADDRESS } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  eUSD_FRAX_BP,
  FRAX_BP,
  FRAX_BP_TOKEN,
  CVX,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  FRAX_USD_FEED,
  FRAX_ORACLE_TIMEOUT,
  FRAX_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  RTOKEN_DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  eUSD_FRAX_HOLDER,
} from '../constants'

type Fixture<T> = () => Promise<T>

export const defaultCvxStableCollateralOpts: CurveMetapoolCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
  oracleTimeout: bn('1'), // unused but cannot be zero
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: RTOKEN_DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'), // TODO
  nTokens: bn('2'),
  curvePool: FRAX_BP,
  lpToken: FRAX_BP_TOKEN,
  poolType: CurvePoolType.Plain, // for fraxBP, not the top-level pool
  feeds: [[FRAX_USD_FEED], [USDC_USD_FEED]],
  oracleTimeouts: [[FRAX_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT]],
  oracleErrors: [[FRAX_ORACLE_ERROR], [USDC_ORACLE_ERROR]],
  metapoolToken: eUSD_FRAX_BP,
  pairedTokenDefaultThreshold: DEFAULT_THRESHOLD,
}

export const deployCollateral = async (
  opts: CurveMetapoolCollateralOpts = {}
): Promise<[TestICollateral, CurveMetapoolCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: FRAX, USDC, eUSD
    const fraxFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const eusdFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeWeUSDFraxBP(eusdFeed)

    opts.feeds = [[fraxFeed.address], [usdcFeed.address]]
    opts.erc20 = fix.wPool.address
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxStableRTokenMetapoolCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CrvStableRTokenMetapoolCollateral'
  )

  const collateral = <TestICollateral>await CvxStableRTokenMetapoolCollateralFactory.deploy(
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
    {
      nTokens: opts.nTokens,
      curvePool: opts.curvePool,
      poolType: opts.poolType,
      feeds: opts.feeds,
      oracleTimeouts: opts.oracleTimeouts,
      oracleErrors: opts.oracleErrors,
      lpToken: opts.lpToken,
    },
    opts.metapoolToken,
    opts.pairedTokenDefaultThreshold
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return [collateral as unknown as TestICollateral, opts]
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CurveMetapoolCollateralOpts = {}
): Fixture<CurveCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxStableCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all feeds: FRAX, USDC, RToken
    const fraxFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const eusdFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const fix = await makeWeUSDFraxBP(eusdFeed)
    collateralOpts.feeds = [[fraxFeed.address], [usdcFeed.address]]

    collateralOpts.erc20 = fix.wPool.address
    collateralOpts.curvePool = fix.curvePool.address
    collateralOpts.metapoolToken = fix.metapoolToken.address

    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.metapoolToken,
      wrapper: fix.wPool,
      rewardTokens: [cvx, crv],
      chainlinkFeed: usdcFeed,
      poolTokens: [fix.frax, fix.usdc],
      feeds: [fraxFeed, usdcFeed, eusdFeed],
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCurveCollateralFunc<CurveCollateralFixtureContext> = async (
  ctx: CurveCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWeUSDFraxBP(ctx, amount, user, recipient, eUSD_FRAX_HOLDER)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  makeCollateralFixtureContext,
  mintCollateralTo,
  itChecksTargetPerRefDefault: it,
  itChecksRefPerTokDefault: it,
  itHasRevenueHiding: it,
  isMetapool: true,
  resetFork,
  collateralName: 'CrvStableRTokenMetapoolCollateral',
}

collateralTests(opts)

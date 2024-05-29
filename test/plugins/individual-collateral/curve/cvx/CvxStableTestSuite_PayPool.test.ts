import collateralTests from '../collateralTests'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { mintWPool } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  CurvePoolMock,
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  CRV,
  CVX,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  USDC,
  pyUSD_USD_FEED,
  PayPool,
  pyUSD_ORACLE_TIMEOUT,
  pyUSD_ORACLE_ERROR,
  PayPool_POOL_ID,
  pyUSD,
  PayPool_HOLDER,
} from '../constants'
import { getResetFork } from '../../helpers'

type Fixture<T> = () => Promise<T>

export const defaultCvxStableCollateralOpts: CurveCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: pyUSD_USD_FEED, // unused but cannot be zero
  oracleTimeout: USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'),
  nTokens: 2,
  curvePool: PayPool,
  lpToken: PayPool,
  poolType: CurvePoolType.Plain,
  feeds: [[pyUSD_USD_FEED], [USDC_USD_FEED]],
  oracleTimeouts: [[pyUSD_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT]],
  oracleErrors: [[pyUSD_ORACLE_ERROR], [USDC_ORACLE_ERROR]],
}

export const deployCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute feeds
    const pyUSDFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const wrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper')
    const wrapper = await wrapperFactory.deploy()
    await wrapper.initialize(PayPool_POOL_ID)

    opts.feeds = [[pyUSDFeed.address], [usdcFeed.address]]
    opts.erc20 = wrapper.address
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CurveStableCollateral'
  )

  const collateral = <TestICollateral>await CvxStableCollateralFactory.deploy(
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
    }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return [collateral, opts]
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CurveCollateralOpts = {}
): Fixture<CurveCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxStableCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute feeds
    const pyUSDFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    collateralOpts.feeds = [[pyUSDFeed.address], [usdcFeed.address]]

    // Use mock curvePool seeded with initial balances
    const CurvePoolMockFactory = await ethers.getContractFactory('CurvePoolMock')
    const realCurvePool = <CurvePoolMock>await ethers.getContractAt('CurvePoolMock', PayPool)
    const curvePool = <CurvePoolMock>(
      await CurvePoolMockFactory.deploy(
        [await realCurvePool.balances(0), await realCurvePool.balances(1)],
        [await realCurvePool.coins(0), await realCurvePool.coins(1)]
      )
    )
    await curvePool.setVirtualPrice(await realCurvePool.get_virtual_price())

    // Deploy Wrapper
    const wrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper')
    const wrapper = await wrapperFactory.deploy()
    await wrapper.initialize(PayPool_POOL_ID)

    collateralOpts.erc20 = wrapper.address
    collateralOpts.curvePool = curvePool.address
    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)
    const pyusd = <ERC20Mock>await ethers.getContractAt('ERC20Mock', pyUSD)

    return {
      alice,
      collateral,
      curvePool: curvePool,
      wrapper: wrapper,
      rewardTokens: [cvx, crv, pyusd],
      poolTokens: [
        await ethers.getContractAt('ERC20Mock', pyUSD),
        await ethers.getContractAt('ERC20Mock', USDC),
      ],
      feeds: [pyUSDFeed, usdcFeed],
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
  await mintWPool(ctx, amount, user, recipient, PayPool_HOLDER)
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
  itClaimsRewards: it,
  isMetapool: false,
  resetFork: getResetFork(19287000),
  collateralName: 'CurveStableCollateral - ConvexStakingWrapper (PayPool)',
}

collateralTests(opts)

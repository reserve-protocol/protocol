import collateralTests from '../collateralTests'
import {
  CurveCollateralFixtureContext,
  MintCurveCollateralFunc,
  CurveMetapoolCollateralOpts,
} from '../pluginTestTypes'
import { makeWMIM3Pool, mintWMIM3Pool, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { BigNumberish } from 'ethers'
import {
  CurveStableMetapoolCollateral,
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
  THREE_POOL,
  THREE_POOL_TOKEN,
  THREE_POOL_DEFAULT_THRESHOLD,
  CVX,
  DAI_USD_FEED,
  DAI_ORACLE_TIMEOUT,
  DAI_ORACLE_ERROR,
  MIM_DEFAULT_THRESHOLD,
  MIM_USD_FEED,
  MIM_ORACLE_TIMEOUT,
  MIM_ORACLE_ERROR,
  MIM_THREE_POOL,
  MIM_THREE_POOL_HOLDER,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDT_USD_FEED,
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
} from '../constants'

type Fixture<T> = () => Promise<T>

export const defaultCvxStableCollateralOpts: CurveMetapoolCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: MIM_USD_FEED,
  oracleTimeout: MIM_ORACLE_TIMEOUT,
  oracleError: MIM_ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: THREE_POOL_DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'), // TODO
  nTokens: 3,
  curvePool: THREE_POOL,
  lpToken: THREE_POOL_TOKEN,
  poolType: CurvePoolType.Plain,
  feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED]],
  oracleTimeouts: [[DAI_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
  oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
  metapoolToken: MIM_THREE_POOL,
  pairedTokenDefaultThreshold: MIM_DEFAULT_THRESHOLD,
}

export const deployCollateral = async (
  opts: CurveMetapoolCollateralOpts = {}
): Promise<[TestICollateral, CurveMetapoolCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds && !opts.chainlinkFeed) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: DAI, USDC, USDT
    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const mimFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeWMIM3Pool()

    opts.feeds = [[daiFeed.address], [usdcFeed.address], [usdtFeed.address]]
    opts.erc20 = fix.wPool.address
    opts.chainlinkFeed = mimFeed.address
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxStableCollateralFactory = await ethers.getContractFactory(
    'CurveStableMetapoolCollateral'
  )

  const collateral = <CurveStableMetapoolCollateral>await CvxStableCollateralFactory.deploy(
    {
      erc20: opts.erc20!,
      targetName: opts.targetName!,
      priceTimeout: opts.priceTimeout!,
      chainlinkFeed: opts.chainlinkFeed!,
      oracleError: opts.oracleError!,
      oracleTimeout: opts.oracleTimeout!,
      maxTradeVolume: opts.maxTradeVolume!,
      defaultThreshold: opts.defaultThreshold!,
      delayUntilDefault: opts.delayUntilDefault!,
    },
    opts.revenueHiding!,
    {
      nTokens: opts.nTokens!,
      curvePool: opts.curvePool!,
      poolType: opts.poolType!,
      feeds: opts.feeds!,
      oracleTimeouts: opts.oracleTimeouts!,
      oracleErrors: opts.oracleErrors!,
      lpToken: opts.lpToken!,
    },
    opts.metapoolToken!,
    opts.pairedTokenDefaultThreshold!
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

    // Substitute all 3 feeds: DAI, USDC, USDT
    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const mimFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeWMIM3Pool()

    collateralOpts.erc20 = fix.wPool.address
    collateralOpts.chainlinkFeed = mimFeed.address
    collateralOpts.feeds = [[daiFeed.address], [usdcFeed.address], [usdtFeed.address]]
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
      poolTokens: [fix.dai, fix.usdc, fix.usdt],
      feeds: [mimFeed, daiFeed, usdcFeed, usdtFeed],
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
  await mintWMIM3Pool(ctx, amount, user, recipient, MIM_THREE_POOL_HOLDER)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {
  it('does not allow empty metaPoolToken', async () => {
    await expect(deployCollateral({ metapoolToken: ZERO_ADDRESS })).to.be.revertedWith(
      'metapoolToken address is zero'
    )
  })

  it('does not allow invalid pairedTokenDefaultThreshold', async () => {
    await expect(deployCollateral({ pairedTokenDefaultThreshold: bn(0) })).to.be.revertedWith(
      'pairedTokenDefaultThreshold out of bounds'
    )

    await expect(
      deployCollateral({ pairedTokenDefaultThreshold: bn('1.1e18') })
    ).to.be.revertedWith('pairedTokenDefaultThreshold out of bounds')
  })

  it('does not allow invalid Pool Type', async () => {
    await expect(deployCollateral({ metapoolToken: ZERO_ADDRESS })).to.be.revertedWith(
      'metapoolToken address is zero'
    )
  })
}

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
  isMetapool: true,
  resetFork,
  collateralName: 'CurveStableMetapoolCollateral - ConvexStakingWrapper',
}

collateralTests(opts)

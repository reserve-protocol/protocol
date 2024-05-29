import collateralTests from '../collateralTests'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
  CurveBase,
} from '../pluginTestTypes'

import { mintL2Pool } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  CurvePoolMock,
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IConvexRewardPool,
} from '../../../../../typechain'
import { expectEvents } from '#/common/events'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  CRV,
  CVX,
  ARB,
  ARB_crvUSD_USD_FEED,
  ARB_USDC_USD_FEED,
  ARB_Convex_crvUSD_USDC,
  ARB_crvUSD_ORACLE_TIMEOUT,
  ARB_USDC_ORACLE_TIMEOUT,
  ARB_crvUSD_USDC,
  ARB_crvUSD_ORACLE_ERROR,
  ARB_USDC_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  ARB_crvUSD_USDC_HOLDER,
  USDC,
  crvUSD,
  FORK_BLOCK_ARBITRUM,
} from '../constants'
import { advanceBlocks, advanceToTimestamp, getLatestBlockTimestamp } from '#/test/utils/time'
import { getResetFork } from '../../helpers'

type Fixture<T> = () => Promise<T>

export const defaultCvxStableCollateralOpts: CurveCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ARB_crvUSD_USD_FEED, // unused but cannot be zero
  oracleTimeout: ARB_USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'),
  nTokens: 2,
  curvePool: ARB_crvUSD_USDC,
  lpToken: ARB_crvUSD_USDC,
  poolType: CurvePoolType.Plain,
  feeds: [[ARB_crvUSD_USD_FEED], [ARB_USDC_USD_FEED]],
  oracleTimeouts: [[ARB_crvUSD_ORACLE_TIMEOUT], [ARB_USDC_ORACLE_TIMEOUT]],
  oracleErrors: [[ARB_crvUSD_ORACLE_ERROR], [ARB_USDC_ORACLE_ERROR]],
}

export const deployCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute feeds
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const crvUSDFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    opts.feeds = [[usdcFeed.address], [crvUSDFeed.address]]
    opts.erc20 = ARB_Convex_crvUSD_USDC
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const L2CvxStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'L2ConvexStableCollateral'
  )

  const collateral = <TestICollateral>await L2CvxStableCollateralFactory.deploy(
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
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const crvUSDFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    collateralOpts.feeds = [[usdcFeed.address], [crvUSDFeed.address]]

    // Use mock curvePool seeded with initial balances
    const CurvePoolMockFactory = await ethers.getContractFactory('CurvePoolMock')
    const realCurvePool = <CurvePoolMock>(
      await ethers.getContractAt('CurvePoolMock', ARB_crvUSD_USDC)
    )
    const curvePool = <CurvePoolMock>(
      await CurvePoolMockFactory.deploy(
        [await realCurvePool.balances(0), await realCurvePool.balances(1)],
        [await realCurvePool.coins(0), await realCurvePool.coins(1)]
      )
    )
    await curvePool.setVirtualPrice(await realCurvePool.get_virtual_price())

    const crvUsdUSDCPool = <IConvexRewardPool>(
      await ethers.getContractAt('IConvexRewardPool', ARB_Convex_crvUSD_USDC)
    )

    collateralOpts.erc20 = crvUsdUSDCPool.address
    collateralOpts.curvePool = curvePool.address
    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)
    const arb = <ERC20Mock>await ethers.getContractAt('ERC20Mock', ARB)

    return {
      alice,
      collateral,
      curvePool: curvePool,
      wrapper: crvUsdUSDCPool, // no wrapper needed
      rewardTokens: [cvx, crv, arb],
      poolTokens: [
        await ethers.getContractAt('ERC20Mock', USDC),
        await ethers.getContractAt('ERC20Mock', crvUSD),
      ],
      feeds: [usdcFeed, crvUSDFeed],
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
  await mintL2Pool(ctx, amount, recipient, ARB_crvUSD_USDC_HOLDER)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('Claims rewards', async () => {
    // Reward claiming is tested here instead of in the generic suite due to not all 3
    // reward tokens being claimed for positive token balances

    const [collateral] = await deployCollateral()
    const amt = bn('20000').mul(bn(10).pow(await collateral.erc20Decimals()))

    // Transfer some tokens to the collateral plugin
    const crvUsdUSDCPool = <IConvexRewardPool>(
      await ethers.getContractAt('IConvexRewardPool', ARB_Convex_crvUSD_USDC)
    )
    await mintL2Pool(
      { wrapper: crvUsdUSDCPool } as CurveBase,
      amt,
      collateral.address,
      ARB_crvUSD_USDC_HOLDER
    )

    await advanceBlocks(1000)
    await advanceToTimestamp((await getLatestBlockTimestamp()) + 12000)

    const rewardTokens = [
      // Only ARB rewards as of the time of this plugin development
      <ERC20Mock>await ethers.getContractAt('ERC20Mock', ARB),
    ]

    // Expect 4 RewardsClaimed events to be emitted: [CVX, CRV, CRV_USD, ARB]
    const before = await Promise.all(rewardTokens.map((t) => t.balanceOf(collateral.address)))

    await expectEvents(collateral.claimRewards(), [
      {
        contract: collateral,
        name: 'RewardsClaimed',
        args: [CRV, anyValue],
        emitted: true,
      },
      {
        contract: collateral,
        name: 'RewardsClaimed',
        args: [CVX, anyValue],
        emitted: true,
      },
      {
        contract: collateral,
        name: 'RewardsClaimed',
        args: [crvUSD, anyValue],
        emitted: true,
      },
      {
        contract: collateral,
        name: 'RewardsClaimed',
        args: [ARB, anyValue],
        emitted: true,
      },
    ])

    // Reward token balances should grow
    const after = await Promise.all(rewardTokens.map((t) => t.balanceOf(collateral.address)))
    for (let i = 0; i < rewardTokens.length; i++) {
      expect(after[i]).gt(before[i])
    }
  })
}

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
  itClaimsRewards: it.skip, // in this file
  isMetapool: false,
  resetFork: getResetFork(FORK_BLOCK_ARBITRUM),
  collateralName: 'CurveStableCollateral - Convex L2 (crvUSD/USDC)',
  targetNetwork: 'arbitrum',
}

collateralTests(opts)

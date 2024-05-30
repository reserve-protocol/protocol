import collateralTests from '../collateralTests'
import forkBlockNumber from '#/test/integration/fork-block-numbers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { CollateralStatus } from '../../pluginTestTypes'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { ORACLE_TIMEOUT_BUFFER } from '../../fixtures'
import { makeUSDCUSDCPlus, mintUSDCUSDCPlus } from './helpers'
import { expectEvents } from '#/common/events'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { expectExactPrice } from '../../../../utils/oracles'
import { getResetFork } from '../../helpers'
import { CurveBase } from '../pluginTestTypes'
import {
  advanceBlocks,
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
} from '#/test/utils/time'
import {
  ConvexStakingWrapper,
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS, ONE_ADDRESS, MAX_UINT192 } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  USDC_USDCPLUS_POOL,
  USDC_USDCPLUS_LP_TOKEN,
  USDCPLUS_ASSET_REGISTRY,
  USDCPLUS_TIMELOCK,
  CVX,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  RTOKEN_DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  SDT,
  USDCPLUS,
} from '../constants'
import { whileImpersonating } from '../../../../utils/impersonation'

type Fixture<T> = () => Promise<T>

export const defaultCvxRecursiveCollateralOpts: CurveCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
  oracleTimeout: USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: RTOKEN_DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'),
  nTokens: 2,
  curvePool: USDC_USDCPLUS_POOL,
  lpToken: USDC_USDCPLUS_LP_TOKEN,
  poolType: CurvePoolType.Plain,
  feeds: [[USDC_USD_FEED], [ONE_ADDRESS]],
  oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [bn('1')]],
  oracleErrors: [[USDC_ORACLE_ERROR], [bn('1')]],
}

export const deployCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute both feeds: USDC, USDC+
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcplusFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeUSDCUSDCPlus(usdcplusFeed)

    opts.feeds = [[usdcFeed.address], [usdcplusFeed.address]]
    opts.erc20 = fix.gauge.address
  }

  opts = { ...defaultCvxRecursiveCollateralOpts, ...opts }

  const StakeDAORecursiveCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'StakeDAORecursiveCollateral'
  )

  const collateral = <TestICollateral>await StakeDAORecursiveCollateralFactory.deploy(
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

  return [collateral as unknown as TestICollateral, opts]
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CurveCollateralOpts = {}
): Fixture<CurveCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxRecursiveCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute both feeds: USDC, USDC+
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcplusFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeUSDCUSDCPlus(usdcplusFeed)

    collateralOpts.feeds = [[usdcFeed.address], [usdcplusFeed.address]]
    collateralOpts.erc20 = fix.gauge.address
    collateralOpts.curvePool = fix.curvePool.address

    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const sdt = <ERC20Mock>await ethers.getContractAt('ERC20Mock', SDT)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.curvePool,
      wrapper: fix.gauge as unknown as ConvexStakingWrapper, // cast to make work with curve tests
      rewardTokens: [sdt, cvx, crv],
      chainlinkFeed: usdcFeed,
      poolTokens: [fix.usdc, fix.usdcplus],
      feeds: [usdcFeed, usdcplusFeed],
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
  await mintUSDCUSDCPlus(ctx, amount, user, recipient)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('Does not depend on USDC+ RTokenAsset.price()', async () => {
    const [collateral, opts] = await deployCollateral({})
    const initialPrice = await collateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)

    // Swap out USDCPLUS's RTokenAsset with a mock one, which should be IGNORED
    const AssetMockFactory = await ethers.getContractFactory('AssetMock')
    const mockRTokenAsset = await AssetMockFactory.deploy(
      bn('1'), // unused
      ONE_ADDRESS, // unused
      bn('1'), // unused
      USDCPLUS,
      bn('1'), // unused
      bn('1') // unused
    )
    const usdcplusAssetRegistry = await ethers.getContractAt(
      'IAssetRegistry',
      USDCPLUS_ASSET_REGISTRY
    )
    const usdcFeed = await ethers.getContractAt('MockV3Aggregator', opts.feeds![0][0])
    const initialAnswer = await usdcFeed.latestAnswer()
    await whileImpersonating(USDCPLUS_TIMELOCK, async (signer) => {
      await usdcplusAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
    })

    // Set RTokenAsset to unpriced, which should end up being IGNORED
    await mockRTokenAsset.setPrice(0, MAX_UINT192)

    // Should be SOUND still
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    await expectExactPrice(collateral.address, initialPrice)

    // SOUND after decay period
    await advanceTime((await collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER)
    await usdcFeed.updateAnswer(initialAnswer)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    await expectExactPrice(collateral.address, initialPrice)

    // SOUND after full price timeout
    await advanceTime(await collateral.priceTimeout())
    await usdcFeed.updateAnswer(initialAnswer)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    await expectExactPrice(collateral.address, initialPrice)
  })

  it('Claims rewards', async () => {
    // Reward claiming is tested here instead of in the generic suite due to not all 3
    // reward tokens being claimed for positive token balances

    const [collateral] = await deployCollateral()
    const [alice] = await ethers.getSigners()
    const amt = bn('200').mul(bn(10).pow(await collateral.erc20Decimals()))

    // Transfer some gauge token to the collateral plugin
    await mintUSDCUSDCPlus({} as CurveBase, amt, alice, collateral.address)

    await advanceBlocks(1000)
    await advanceToTimestamp((await getLatestBlockTimestamp()) + 12000)

    const rewardTokens = [
      // StakeDAO is waiting to start SDT/CVX rewards as of the time of this plugin development
      // <ERC20Mock>await ethers.getContractAt('ERC20Mock', SDT),
      // <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX),
      <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV),
    ]

    // Expect 3 RewardsClaimed events to be emitted: [SDT, CVX, CRV]
    const before = await Promise.all(rewardTokens.map((t) => t.balanceOf(collateral.address)))
    await expectEvents(collateral.claimRewards(), [
      {
        contract: collateral,
        name: 'RewardsClaimed',
        args: [SDT, anyValue],
        emitted: true,
      },
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
    ])

    // All 3 reward token balances should grow
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
  resetFork: getResetFork(forkBlockNumber['new-curve-plugins']),
  collateralName: 'StakeDAORecursiveCollateral - StakeDAOGauge',
}

collateralTests(opts)

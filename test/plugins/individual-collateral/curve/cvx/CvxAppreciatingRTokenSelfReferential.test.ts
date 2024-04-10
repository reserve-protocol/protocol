import collateralTests from '../collateralTests'
import forkBlockNumber from '#/test/integration/fork-block-numbers'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { ORACLE_TIMEOUT_BUFFER } from '../../fixtures'
import { makeWETHPlusETH, mintWETHPlusETH } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { expectDecayedPrice, expectExactPrice, expectUnpriced } from '../../../../utils/oracles'
import { getResetFork } from '../../helpers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { advanceTime } from '../../../../utils/time'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS, ONE_ADDRESS, MAX_UINT192 } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  ETHPLUS_BP_POOL,
  ETHPLUS_BP_TOKEN,
  ETHPLUS_ETH_HOLDER,
  CVX,
  WETH_USD_FEED,
  WETH_ORACLE_TIMEOUT,
  WETH_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  RTOKEN_DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  ETHPLUS,
} from '../constants'
import { whileImpersonating } from '../../../../utils/impersonation'

type Fixture<T> = () => Promise<T>

export const defaultCvxStableCollateralOpts: CurveCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
  oracleTimeout: WETH_ORACLE_TIMEOUT, // max of oracleTimeouts
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: RTOKEN_DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'),
  nTokens: 2,
  curvePool: ETHPLUS_BP_POOL,
  lpToken: ETHPLUS_BP_TOKEN,
  poolType: CurvePoolType.Plain, // for fraxBP, not the top-level pool
  feeds: [[ONE_ADDRESS], [WETH_USD_FEED]],
  oracleTimeouts: [[bn('1')], [WETH_ORACLE_TIMEOUT]],
  oracleErrors: [[bn('1')], [WETH_ORACLE_ERROR]],
}

export const deployCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute both feeds: ETH+, ETH
    const ethplusFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('3300e8'))
    const ethFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('3300e8'))
    const fix = await makeWETHPlusETH(ethplusFeed)

    opts.feeds = [[ethplusFeed.address], [ethFeed.address]]
    opts.erc20 = fix.wPool.address
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxAppreciatingRTokenSelfReferentialCollateralFactory: ContractFactory =
    await ethers.getContractFactory('CurveAppreciatingRTokenSelfReferentialCollateral')

  const collateral = <TestICollateral>(
    await CvxAppreciatingRTokenSelfReferentialCollateralFactory.deploy(
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
  const collateralOpts = { ...defaultCvxStableCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute both feeds: ETH+, ETH
    const ethplusFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('3300e8'))
    const ethFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('3300e8'))
    const fix = await makeWETHPlusETH(ethplusFeed)

    collateralOpts.feeds = [[ethplusFeed.address], [ethFeed.address]]
    collateralOpts.erc20 = fix.wPool.address
    collateralOpts.curvePool = fix.curvePool.address

    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.curvePool,
      wrapper: fix.wPool,
      rewardTokens: [cvx, crv],
      chainlinkFeed: ethFeed,
      poolTokens: [fix.ethplus, fix.weth],
      feeds: [ethFeed, ethplusFeed], // reversed order here. 0th feed is always the one manipulated
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
  await mintWETHPlusETH(ctx, amount, user, recipient, ETHPLUS_ETH_HOLDER)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('Regression test -- becomes unpriced if inner RTokenAsset becomes unpriced', async () => {
    const [collateral] = await deployCollateral({})
    const initialPrice = await collateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)

    // Swap out ETHPLUS's RTokenAsset with a mock one
    const AssetMockFactory = await ethers.getContractFactory('AssetMock')
    const mockRTokenAsset = await AssetMockFactory.deploy(
      bn('1'), // unused
      ONE_ADDRESS, // unused
      bn('1'), // unused
      ETHPLUS,
      bn('1'), // unused
      bn('1') // unused
    )
    const ethplusAssetRegistry = await ethers.getContractAt(
      'IAssetRegistry',
      '0xf526f058858E4cD060cFDD775077999562b31bE0'
    )
    await whileImpersonating('0x5f4A10aE2fF68bE3cdA7d7FB432b10C6BFA6457B', async (signer) => {
      await ethplusAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
    })

    // Set RTokenAsset to unpriced
    // Would be the price under a stale oracle timeout for a poorly-coded RTokenAsset
    await mockRTokenAsset.setPrice(0, MAX_UINT192)
    await expectExactPrice(collateral.address, initialPrice)

    // Should decay after oracle timeout
    await advanceTime((await collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER)
    await expectDecayedPrice(collateral.address)

    // Should be unpriced after price timeout
    await advanceTime(await collateral.priceTimeout())
    await expectUnpriced(collateral.address)

    // refresh() should not revert
    await collateral.refresh()
  })

  it('Regression test -- refreshes inner RTokenAsset on refresh()', async () => {
    const [collateral] = await deployCollateral({})
    const initialPrice = await collateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)

    // Swap out ETHPLUS's RTokenAsset with a mock one
    const AssetMockFactory = await ethers.getContractFactory('AssetMock')
    const mockRTokenAsset = await AssetMockFactory.deploy(
      bn('1'), // unused
      ONE_ADDRESS, // unused
      bn('1'), // unused
      ETHPLUS,
      bn('1'), // unused
      bn('1') // unused
    )
    const ethplusAssetRegistry = await ethers.getContractAt(
      'IAssetRegistry',
      '0xf526f058858E4cD060cFDD775077999562b31bE0'
    )
    await whileImpersonating('0x5f4A10aE2fF68bE3cdA7d7FB432b10C6BFA6457B', async (signer) => {
      await ethplusAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
    })

    // Set RTokenAsset price to stale
    await mockRTokenAsset.setStale(true)
    expect(await mockRTokenAsset.stale()).to.be.true

    // Refresh CurveAppreciatingRTokenSelfReferentialCollateral
    await collateral.refresh()

    // Stale should be false again
    expect(await mockRTokenAsset.stale()).to.be.false
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
  itClaimsRewards: it,
  isMetapool: false,
  resetFork: getResetFork(forkBlockNumber['eth+/eth']),
  collateralName: 'CurveAppreciatingRTokenSelfReferentialCollateral - ConvexStakingWrapper',
}

collateralTests(opts)

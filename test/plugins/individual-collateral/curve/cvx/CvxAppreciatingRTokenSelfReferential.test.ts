import collateralTests from '../collateralTests'
import forkBlockNumber from '#/test/integration/fork-block-numbers'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { expectEvents } from '../../../../../common/events'
import { overrideOracle } from '../../../../utils/oracles'
import { ORACLE_TIMEOUT_BUFFER } from '../../fixtures'
import { makeWETHPlusETH, mintWETHPlusETH } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import { expectDecayedPrice, expectExactPrice, expectUnpriced } from '../../../../utils/oracles'
import { getResetFork } from '../../helpers'
import { networkConfig } from '../../../../../common/configuration'
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
  ETHPLUS_ASSET_REGISTRY,
  ETHPLUS_BASKET_HANDLER,
  ETHPLUS_BACKING_MANAGER,
  ETHPLUS_TIMELOCK,
} from '../constants'
import { whileImpersonating } from '../../../../utils/impersonation'

type Fixture<T> = () => Promise<T>

export const defaultCvxAppreciatingCollateralOpts: CurveCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('ETH'),
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
  poolType: CurvePoolType.Plain,
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

  opts = { ...defaultCvxAppreciatingCollateralOpts, ...opts }

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
  const collateralOpts = { ...defaultCvxAppreciatingCollateralOpts, ...opts }

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
      ETHPLUS_ASSET_REGISTRY
    )
    await whileImpersonating(ETHPLUS_TIMELOCK, async (signer) => {
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
      ETHPLUS_ASSET_REGISTRY
    )
    await whileImpersonating(ETHPLUS_TIMELOCK, async (signer) => {
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

  it('Regression test -- stays IFFY throughout inner RToken default + rebalancing', async () => {
    const [collateral, opts] = await deployCollateral({})
    const ethplusAssetRegistry = await ethers.getContractAt(
      'IAssetRegistry',
      ETHPLUS_ASSET_REGISTRY
    )
    const ethplus = await ethers.getContractAt('TestIRToken', ETHPLUS)
    const ethplusBasketHandler = await ethers.getContractAt(
      'TestIBasketHandler',
      ETHPLUS_BASKET_HANDLER
    )
    const wstETHCollateral = await ethers.getContractAt(
      'LidoStakedEthCollateral',
      await ethplusAssetRegistry.toAsset(networkConfig['1'].tokens.wstETH!)
    )
    const rethCollateral = await ethers.getContractAt(
      'RethCollateral',
      await ethplusAssetRegistry.toAsset(networkConfig['1'].tokens.rETH!)
    )

    const initialRefPerTok = await collateral.refPerTok()
    const initialPrice = await wstETHCollateral.price()
    expect(initialPrice[0]).to.be.gt(0)
    expect(initialPrice[1]).to.be.lt(MAX_UINT192)
    expect(await wstETHCollateral.status()).to.equal(0)

    // De-peg wstETH collateral 20%
    const targetPerRefFeed = await wstETHCollateral.targetPerRefChainlinkFeed()
    const targetPerRefOracle = await overrideOracle(targetPerRefFeed)
    const latestAnswer = await targetPerRefOracle.latestAnswer()
    await targetPerRefOracle.updateAnswer(latestAnswer.mul(4).div(5))
    const uoaPerRefFeed = await wstETHCollateral.chainlinkFeed()
    const uoaPerRefOracle = await overrideOracle(uoaPerRefFeed)
    await uoaPerRefOracle.updateAnswer(await uoaPerRefOracle.latestAnswer())

    // wstETHCollateral + CurveAppreciatingRTokenSelfReferentialCollateral should
    // become IFFY through the top-level refresh
    await expectEvents(collateral.refresh(), [
      {
        contract: ethplusBasketHandler,
        name: 'BasketStatusChanged',
        args: [0, 1],
        emitted: true,
      },
      {
        contract: wstETHCollateral,
        name: 'CollateralStatusChanged',
        args: [0, 1],
        emitted: true,
      },
      {
        contract: collateral,
        name: 'CollateralStatusChanged',
        args: [0, 1],
        emitted: true,
      },
    ])
    expect(await wstETHCollateral.status()).to.equal(1)
    expect(await collateral.status()).to.equal(1)
    expect(await ethplusBasketHandler.status()).to.equal(1)
    expect(await ethplusBasketHandler.isReady()).to.equal(false)
    expect(await collateral.refPerTok()).to.equal(initialRefPerTok) // refPerTok does not fall

    // Should remain IFFY while ETH+ is rebalancing
    await advanceTime((await wstETHCollateral.delayUntilDefault()) + 1) // 24h

    // prevent oracles from becoming stale
    for (const feedAddr of opts.feeds!) {
      const feed = await ethers.getContractAt('MockV3Aggregator', feedAddr[0])
      await feed.updateAnswer(await feed.latestAnswer())
    }
    const ethOracle = await overrideOracle(WETH_USD_FEED)
    await ethOracle.updateAnswer(await ethOracle.latestAnswer())
    await targetPerRefOracle.updateAnswer(await targetPerRefOracle.latestAnswer())
    await uoaPerRefOracle.updateAnswer(await uoaPerRefOracle.latestAnswer())
    const rethOracle = await overrideOracle(await rethCollateral.chainlinkFeed())
    await rethOracle.updateAnswer(await rethOracle.latestAnswer())
    const rethTargetPerTokOracle = await overrideOracle(
      await rethCollateral.targetPerTokChainlinkFeed()
    )
    await rethTargetPerTokOracle.updateAnswer(await rethTargetPerTokOracle.latestAnswer())

    // Should remain IFFY
    expect(await ethplusBasketHandler.status()).to.equal(2)
    expect(await wstETHCollateral.status()).to.equal(2)
    expect(await collateral.status()).to.equal(1)
    await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
    await ethplusBasketHandler.refreshBasket() // swaps WETH into basket in place of wstETH
    expect(await ethplusBasketHandler.status()).to.equal(0)
    expect(await ethplusBasketHandler.isReady()).to.equal(false)
    expect(await ethplusBasketHandler.fullyCollateralized()).to.equal(false)
    expect(await collateral.refPerTok()).to.equal(initialRefPerTok) // refPerTok does not fall

    // Advancing the warmupPeriod should not change anything while rebalancing
    await advanceTime((await ethplusBasketHandler.warmupPeriod()) + 1)
    expect(await ethplusBasketHandler.isReady()).to.equal(true)
    await collateral.refresh()
    expect(await ethplusBasketHandler.status()).to.equal(0)
    expect(await wstETHCollateral.status()).to.equal(2)
    expect(await collateral.status()).to.equal(1)
    expect(await collateral.refPerTok()).to.equal(initialRefPerTok) // refPerTok does not fall

    // Should go back to SOUND after fullyCollateralized again -- backs up to WETH
    const weth = await ethers.getContractAt('IERC20Metadata', networkConfig['1'].tokens.WETH!)
    const whale = '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'
    const whaleBal = await weth.balanceOf(whale)
    await whileImpersonating(whale, async (whaleSigner) => {
      await weth.connect(whaleSigner).transfer(ETHPLUS_BACKING_MANAGER, whaleBal)
    })
    expect(await ethplusBasketHandler.fullyCollateralized()).to.equal(true)
    await collateral.refresh()
    expect(await ethplusBasketHandler.status()).to.equal(0)
    expect(await collateral.status()).to.equal(0)
    expect(await collateral.refPerTok()).to.equal(initialRefPerTok) // refPerTok does not fall

    // refPerTok should finally fall after a 50% haircut
    const basketsNeeded = await ethplus.basketsNeeded()
    await whileImpersonating(ETHPLUS_BACKING_MANAGER, async (bm) => {
      console.log('whale', whaleBal, basketsNeeded, await weth.balanceOf(bm.address))
      await weth.connect(bm).transfer(whale, whaleBal.sub(basketsNeeded.mul(26).div(100))) // leave >25% WETH backing
      expect(await ethplusBasketHandler.fullyCollateralized()).to.equal(false)
      await ethplus.connect(bm).setBasketsNeeded(basketsNeeded.div(2)) // 50% haircut = WETH backing is sufficient
    })
    expect(await ethplusBasketHandler.fullyCollateralized()).to.equal(true)
    await collateral.refresh()
    expect(await ethplusBasketHandler.status()).to.equal(0)

    // ETH+/ETH collateral should finally become DISABLED once refPerTok falls
    expect(await collateral.status()).to.equal(2)
    expect(await collateral.refPerTok()).to.be.gt(initialRefPerTok.mul(70).div(100))
    expect(await collateral.refPerTok()).to.be.lt(initialRefPerTok.mul(71).div(100))
    // 70% < refPerTok < 71%, since sqrt(0.5) = 0.707
  })

  it('Read-only reentrancy', async () => {
    const [collateral] = await deployCollateral({})
    const factory = await ethers.getContractFactory('CurveReentrantReceiver')
    const reentrantReceiver = await factory.deploy(collateral.address)

    await whileImpersonating(ETHPLUS_ETH_HOLDER, async (whale) => {
      const amt = bn('1e18')
      const token = await ethers.getContractAt('IERC20Metadata', ETHPLUS_BP_TOKEN)
      await token.connect(whale).approve(ETHPLUS_BP_POOL, amt)
      const pool = await ethers.getContractAt('ICurvePool', ETHPLUS_BP_POOL)

      await expect(
        pool.connect(whale).remove_liquidity(amt, [1, 1], true, reentrantReceiver.address)
      ).to.be.revertedWith('refresh() reverted')
    })
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
  itChecksTargetPerRefDefault: it.skip,
  itClaimsRewards: it,
  isMetapool: false,
  resetFork: getResetFork(forkBlockNumber['new-curve-plugins']),
  collateralName: 'CurveAppreciatingRTokenSelfReferentialCollateral - ConvexStakingWrapper',
}

collateralTests(opts)

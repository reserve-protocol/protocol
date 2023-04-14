import {
  CollateralFixtureContext,
  CollateralOpts,
  CollateralStatus,
  MintCollateralFunc,
} from '../pluginTestTypes'
import { mintW3Pool, makeW3PoolStable, Wrapped3PoolFixtureStable, resetFork } from './helpers'
import hre, { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  CvxStableCollateral,
  ERC20Mock,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { MAX_UINT192, MAX_UINT48, ZERO_ADDRESS } from '../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  PRICE_TIMEOUT,
  THREE_POOL,
  THREE_POOL_TOKEN,
  CVX,
  DAI_USD_FEED,
  DAI_ORACLE_TIMEOUT,
  DAI_ORACLE_ERROR,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDT_USD_FEED,
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  THREE_POOL_HOLDER,
} from './constants'
import { useEnv } from '#/utils/env'
import { getChainId } from '#/common/blockchain-utils'
import { networkConfig } from '#/common/configuration'
import {
  advanceBlocks,
  advanceTime,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '#/test/utils/time'

type Fixture<T> = () => Promise<T>

/*
  Define interfaces
*/

interface CvxStableCollateralFixtureContext
  extends CollateralFixtureContext,
    Wrapped3PoolFixtureStable {
  usdcFeed: MockV3Aggregator
  daiFeed: MockV3Aggregator
  usdtFeed: MockV3Aggregator
  cvx: ERC20Mock
  crv: ERC20Mock
}

// interface CometCollateralFixtureContextMockComet extends CollateralFixtureContext {
//   cusdcV3: CometMock
//   wcusdcV3: ICusdcV3Wrapper
//   usdc: ERC20Mock
//   wcusdcV3Mock: CusdcV3WrapperMock
// }

interface CvxStableCollateralOpts extends CollateralOpts {
  revenueHiding?: BigNumberish
  nTokens?: BigNumberish
  curvePool?: string
  poolType?: CurvePoolType
  feeds?: string[][]
  oracleTimeouts?: BigNumberish[][]
  oracleErrors?: BigNumberish[][]
  lpToken?: string
}

/*
  Define deployment functions
*/

export const defaultCvxStableCollateralOpts: CvxStableCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('USD'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: DAI_USD_FEED, // unused but cannot be zero
  oracleTimeout: bn('1'), // unused but cannot be zero
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'), // TODO
  nTokens: bn('3'),
  curvePool: THREE_POOL,
  lpToken: THREE_POOL_TOKEN,
  poolType: CurvePoolType.Plain,
  feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED]],
  oracleTimeouts: [[DAI_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
  oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
}

export const deployCollateral = async (
  opts: CvxStableCollateralOpts = {}
): Promise<CvxStableCollateral> => {
  if (!opts.erc20 && !opts.feeds) {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: DAI, USDC, USDT
    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const fix = await makeW3PoolStable()

    opts.feeds = [[daiFeed.address], [usdcFeed.address], [usdtFeed.address]]
    opts.erc20 = fix.w3Pool.address
  }

  opts = { ...defaultCvxStableCollateralOpts, ...opts }

  const CvxStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CvxStableCollateral'
  )

  const collateral = <CvxStableCollateral>await CvxStableCollateralFactory.deploy(
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

  return collateral
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CvxStableCollateralOpts = {}
): Fixture<CvxStableCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxStableCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    // Substitute all 3 feeds: DAI, USDC, USDT
    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    collateralOpts.feeds = [[daiFeed.address], [usdcFeed.address], [usdtFeed.address]]

    const fix = await makeW3PoolStable()

    collateralOpts.erc20 = fix.w3Pool.address
    collateralOpts.curvePool = fix.curvePool.address
    const collateral = <TestICollateral>((await deployCollateral(collateralOpts)) as unknown)
    const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX) // use CVX

    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      chainlinkFeed: usdcFeed,
      curvePool: fix.curvePool,
      crv3Pool: fix.crv3Pool,
      w3Pool: fix.w3Pool,
      dai: fix.dai,
      usdc: fix.usdc,
      usdt: fix.usdt,
      tok: fix.w3Pool,
      rewardToken,
      usdcFeed,
      daiFeed,
      usdtFeed,
      cvx,
      crv,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<CvxStableCollateralFixtureContext> = async (
  ctx: CvxStableCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintW3Pool(ctx, amount, user, recipient, THREE_POOL_HOLDER)
}

/*
  Define collateral-specific tests
*/

const collateralSpecificConstructorTests = () => {
  it('does not allow 0 defaultThreshold', async () => {
    await expect(deployCollateral({ defaultThreshold: bn('0') })).to.be.revertedWith(
      'defaultThreshold zero'
    )
  })

  it('does not allow more than 4 tokens', async () => {
    await expect(deployCollateral({ nTokens: 5 })).to.be.revertedWith('up to 4 tokens max')
  })

  it('does not allow empty curvePool', async () => {
    await expect(deployCollateral({ curvePool: ZERO_ADDRESS })).to.be.revertedWith(
      'curvePool address is zero'
    )
  })

  it('does not allow more than 2 price feeds', async () => {
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[DAI_USD_FEED, DAI_USD_FEED, DAI_USD_FEED], [], []],
      })
    ).to.be.revertedWith('price feeds limited to 2')
  })

  it('requires at least 1 price feed per token', async () => {
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[DAI_USD_FEED, DAI_USD_FEED], [USDC_USD_FEED], []],
      })
    ).to.be.revertedWith('each token needs at least 1 price feed')
  })

  it('requires non-zero-address feeds', async () => {
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[ZERO_ADDRESS], [USDC_USD_FEED], [USDT_USD_FEED]],
      })
    ).to.be.revertedWith('t0feed0 empty')
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[DAI_USD_FEED, ZERO_ADDRESS], [USDC_USD_FEED], [USDT_USD_FEED]],
      })
    ).to.be.revertedWith('t0feed1 empty')
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[USDC_USD_FEED], [ZERO_ADDRESS], [USDT_USD_FEED]],
      })
    ).to.be.revertedWith('t1feed0 empty')
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[DAI_USD_FEED], [USDC_USD_FEED, ZERO_ADDRESS], [USDT_USD_FEED]],
      })
    ).to.be.revertedWith('t1feed1 empty')
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [ZERO_ADDRESS]],
      })
    ).to.be.revertedWith('t2feed0 empty')
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED, ZERO_ADDRESS]],
      })
    ).to.be.revertedWith('t2feed1 empty')
  })

  it('requires non-zero oracleTimeouts', async () => {
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        oracleTimeouts: [[bn('0')], [USDC_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
      })
    ).to.be.revertedWith('t0timeout0 zero')
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [bn('0')], [USDT_ORACLE_TIMEOUT]],
      })
    ).to.be.revertedWith('t1timeout0 zero')
    await expect(
      deployCollateral({
        erc20: THREE_POOL_TOKEN, // can be anything.
        oracleTimeouts: [[DAI_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT], [bn('0')]],
      })
    ).to.be.revertedWith('t2timeout0 zero')
  })

  it('requires non-zero oracleErrors', async () => {
    await expect(
      deployCollateral({
        oracleErrors: [[fp('1')], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
      })
    ).to.be.revertedWith('t0error0 too large')
    await expect(
      deployCollateral({
        oracleErrors: [[USDC_ORACLE_ERROR], [fp('1')], [USDT_ORACLE_ERROR]],
      })
    ).to.be.revertedWith('t1error0 too large')
    await expect(
      deployCollateral({ oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [fp('1')]] })
    ).to.be.revertedWith('t2error0 too large')
  })
}

/*
  Run the test suite
*/

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`Collateral: Convex - Stable (3Pool)`, () => {
  before(resetFork)
  describe('constructor validation', () => {
    it('validates targetName', async () => {
      await expect(deployCollateral({ targetName: ethers.constants.HashZero })).to.be.revertedWith(
        'targetName missing'
      )
    })

    it('does not allow missing ERC20', async () => {
      await expect(deployCollateral({ erc20: ethers.constants.AddressZero })).to.be.revertedWith(
        'missing erc20'
      )
    })

    it('does not allow missing chainlink feed', async () => {
      await expect(
        deployCollateral({ chainlinkFeed: ethers.constants.AddressZero })
      ).to.be.revertedWith('missing chainlink feed')
    })

    it('max trade volume must be greater than zero', async () => {
      await expect(deployCollateral({ maxTradeVolume: 0 })).to.be.revertedWith(
        'invalid max trade volume'
      )
    })

    it('does not allow oracle timeout at 0', async () => {
      await expect(deployCollateral({ oracleTimeout: 0 })).to.be.revertedWith('oracleTimeout zero')
    })

    it('does not allow missing delayUntilDefault if defaultThreshold > 0', async () => {
      await expect(deployCollateral({ delayUntilDefault: 0 })).to.be.revertedWith(
        'delayUntilDefault zero'
      )
    })

    describe('collateral-specific tests', collateralSpecificConstructorTests)
  })

  describe('collateral functionality', () => {
    let ctx: CvxStableCollateralFixtureContext
    let alice: SignerWithAddress

    let wallet: SignerWithAddress
    let chainId: number

    let collateral: TestICollateral
    let chainlinkFeed: MockV3Aggregator
    let usdcFeed: MockV3Aggregator
    let daiFeed: MockV3Aggregator
    let usdtFeed: MockV3Aggregator

    let crv: ERC20Mock
    let cvx: ERC20Mock

    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as SignerWithAddress[]

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
      await resetFork()
    })

    beforeEach(async () => {
      ;[, alice] = await ethers.getSigners()
      ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
      ;({ chainlinkFeed, collateral, usdcFeed, daiFeed, usdtFeed, crv, cvx } = ctx)

      await mintCollateralTo(ctx, bn('100e18'), wallet, wallet.address)
    })

    describe('functions', () => {
      it('returns the correct bal (18 decimals)', async () => {
        const amount = bn('20000').mul(bn(10).pow(await ctx.tok.decimals()))
        await mintCollateralTo(ctx, amount, alice, alice.address)

        const aliceBal = await collateral.bal(alice.address)
        expect(aliceBal).to.closeTo(
          amount.mul(bn(10).pow(18 - (await ctx.tok.decimals()))),
          bn('100').mul(bn(10).pow(18 - (await ctx.tok.decimals())))
        )
      })
    })

    describe('rewards', () => {
      it('does not revert', async () => {
        await expect(collateral.claimRewards()).to.not.be.reverted
      })

      it('claims rewards', async () => {
        const amount = bn('20000').mul(bn(10).pow(await ctx.tok.decimals()))
        await mintCollateralTo(ctx, amount, alice, collateral.address)

        await advanceBlocks(1000)
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)

        const crvBefore = await crv.balanceOf(collateral.address)
        const cvxBefore = await cvx.balanceOf(collateral.address)
        await expect(collateral.claimRewards()).to.emit(collateral, 'RewardsClaimed')
        const crvAfter = await crv.balanceOf(collateral.address)
        const cvxAfter = await cvx.balanceOf(collateral.address)
        expect(crvAfter).gt(crvBefore)
        expect(cvxAfter).gt(cvxBefore)
      })
    })

    describe('prices', () => {
      before(resetFork)
      it('prices change as feed price changes', async () => {
        const feedData = await usdcFeed.latestRoundData()
        const initialRefPerTok = await collateral.refPerTok()

        const [low, high] = await collateral.price()

        // Update values in Oracles increase by 10%
        const newPrice = feedData.answer.mul(110).div(100)

        await Promise.all([
          usdcFeed.updateAnswer(newPrice).then((e) => e.wait()),
          daiFeed.updateAnswer(newPrice).then((e) => e.wait()),
          usdtFeed.updateAnswer(newPrice).then((e) => e.wait()),
        ])

        const [newLow, newHigh] = await collateral.price()

        expect(newLow).to.be.closeTo(low.mul(110).div(100), 1)
        expect(newHigh).to.be.closeTo(high.mul(110).div(100), 1)

        // Check refPerTok remains the same (because we have not refreshed)
        const finalRefPerTok = await collateral.refPerTok()
        expect(finalRefPerTok).to.equal(initialRefPerTok)
      })

      it('prices change as refPerTok changes', async () => {
        const initRefPerTok = await collateral.refPerTok()
        const [initLow, initHigh] = await collateral.price()

        const curveVirtualPrice = await ctx.curvePool.get_virtual_price()
        await ctx.curvePool.setVirtualPrice(curveVirtualPrice.add(1e4))
        await ctx.curvePool.setBalances([
          await ctx.curvePool.balances(0).then((e) => e.add(1e4)),
          await ctx.curvePool.balances(1).then((e) => e.add(2e4)),
          await ctx.curvePool.balances(2).then((e) => e.add(3e4)),
        ])

        await collateral.refresh()
        expect(await collateral.refPerTok()).to.be.gt(initRefPerTok)

        const [newLow, newHigh] = await collateral.price()
        expect(newLow).to.be.gt(initLow)
        expect(newHigh).to.be.gt(initHigh)
      })

      it('returns a 0 price', async () => {
        await Promise.all([
          usdcFeed.updateAnswer(0).then((e) => e.wait()),
          daiFeed.updateAnswer(0).then((e) => e.wait()),
          usdtFeed.updateAnswer(0).then((e) => e.wait()),
        ])

        // (0, FIX_MAX) is returned
        const [low, high] = await collateral.price()
        expect(low).to.equal(0)
        expect(high).to.equal(0)

        // When refreshed, sets status to Unpriced
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('reverts in case of invalid timestamp', async () => {
        await usdcFeed.setInvalidTimestamp()

        // Check price of token
        const [low, high] = await collateral.price()
        expect(low).to.equal(0)
        expect(high).to.equal(MAX_UINT192)

        // When refreshed, sets status to Unpriced
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('decays lotPrice over priceTimeout period', async () => {
        // Prices should start out equal
        const p = await collateral.price()
        let lotP = await collateral.lotPrice()
        expect(p.length).to.equal(lotP.length)
        expect(p[0]).to.equal(lotP[0])
        expect(p[1]).to.equal(lotP[1])

        // Should be roughly half, after half of priceTimeout
        const priceTimeout = await collateral.priceTimeout()
        await advanceTime(priceTimeout / 2)
        lotP = await collateral.lotPrice()
        expect(lotP[0]).to.be.closeTo(p[0].div(2), p[0].div(2).div(10000)) // 1 part in 10 thousand
        expect(lotP[1]).to.be.closeTo(p[1].div(2), p[1].div(2).div(10000)) // 1 part in 10 thousand

        // Should be 0 after full priceTimeout
        await advanceTime(priceTimeout / 2)
        lotP = await collateral.lotPrice()
        expect(lotP[0]).to.equal(0)
        expect(lotP[1]).to.equal(0)
      })
    })

    describe('status', () => {
      it('maintains status in normal situations', async () => {
        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        // Force updates (with no changes)
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')

        // State remains the same
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
      })

      it('enters IFFY state when reference unit depegs below low threshold', async () => {
        const delayUntilDefault = await collateral.delayUntilDefault()

        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        // Depeg USDC:USD - Reducing price by 20% from 1 to 0.8
        const updateAnswerTx = await chainlinkFeed.updateAnswer(bn('8e7'))
        await updateAnswerTx.wait()

        // Set next block timestamp - for deterministic result
        const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
        await setNextBlockTimestamp(nextBlockTimestamp)
        const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

        await expect(collateral.refresh())
          .to.emit(collateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
      })

      it('enters IFFY state when reference unit depegs above high threshold', async () => {
        const delayUntilDefault = await collateral.delayUntilDefault()

        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        // Depeg USDC:USD - Raising price by 20% from 1 to 1.2
        const updateAnswerTx = await chainlinkFeed.updateAnswer(bn('1.2e8'))
        await updateAnswerTx.wait()

        // Set next block timestamp - for deterministic result
        const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
        await setNextBlockTimestamp(nextBlockTimestamp)
        const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

        await expect(collateral.refresh())
          .to.emit(collateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
      })

      it('enters DISABLED state when reference unit depegs for too long', async () => {
        const delayUntilDefault = await collateral.delayUntilDefault()

        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        // Depeg USDC:USD - Reducing price by 20% from 1 to 0.8
        const updateAnswerTx = await chainlinkFeed.updateAnswer(bn('8e7'))
        await updateAnswerTx.wait()

        // Set next block timestamp - for deterministic result
        const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
        await setNextBlockTimestamp(nextBlockTimestamp)
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

        // Move time forward past delayUntilDefault
        await advanceTime(delayUntilDefault)
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

        // Nothing changes if attempt to refresh after default
        const prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
      })

      it('enters DISABLED state when refPerTok() decreases', async () => {
        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        await mintCollateralTo(ctx, bn('20000e6'), alice, alice.address)

        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        // State remains the same
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        const currentExchangeRate = await ctx.curvePool.get_virtual_price()
        await ctx.curvePool.setVirtualPrice(currentExchangeRate.sub(1e3)).then((e) => e.wait())

        // Collateral defaults due to refPerTok() going down
        await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
      })

      it('enters IFFY state when price becomes stale', async () => {
        const oracleTimeout = DAI_ORACLE_TIMEOUT.toNumber()
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('does revenue hiding correctly', async () => {
        ctx = await loadFixture(makeCollateralFixtureContext(alice, { revenueHiding: fp('1e-6') }))
        ;({ collateral } = ctx)

        // Check initial state
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
        await mintCollateralTo(ctx, bn('20000e6'), alice, alice.address)
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')

        // State remains the same
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        // Decrease refPerTok by 1 part in a million
        const currentExchangeRate = await ctx.curvePool.get_virtual_price()
        const newVirtualPrice = currentExchangeRate.sub(currentExchangeRate.div(bn('1e6')))
        await ctx.curvePool.setVirtualPrice(newVirtualPrice)

        // Collateral remains SOUND
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        // One quanta more of decrease results in default
        await ctx.curvePool.setVirtualPrice(newVirtualPrice.sub(1))
        await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
      })

      it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
        const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
          'InvalidMockV3Aggregator'
        )
        const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
          await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
        )

        const fix = await makeW3PoolStable()

        const invalidCollateral = await deployCollateral({
          erc20: fix.w3Pool.address,
          feeds: [
            [invalidChainlinkFeed.address],
            [invalidChainlinkFeed.address],
            [invalidChainlinkFeed.address],
          ],
        })

        // Reverting with no reason
        await invalidChainlinkFeed.setSimplyRevert(true)
        await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
        expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Runnning out of gas (same error)
        await invalidChainlinkFeed.setSimplyRevert(false)
        await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
        expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)
      })
    })
  })
})

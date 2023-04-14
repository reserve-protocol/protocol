import {
  CollateralFixtureContext,
  CollateralOpts,
  CollateralStatus,
  MintCollateralFunc,
} from '../pluginTestTypes'
import { mintW3Pool, makeW3PoolVolatile, Wrapped3PoolFixtureVolatile, resetFork } from './helpers'
import hre, { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  CvxVolatileCollateral,
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
  CVX,
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  TRI_CRYPTO_HOLDER,
  TRI_CRYPTO,
  TRI_CRYPTO_TOKEN,
  WBTC_BTC_FEED,
  BTC_USD_FEED,
  BTC_ORACLE_TIMEOUT,
  WETH_USD_FEED,
  WBTC_BTC_ORACLE_ERROR,
  WBTC_ORACLE_TIMEOUT,
  WETH_ORACLE_TIMEOUT,
  USDT_USD_FEED,
  BTC_USD_ORACLE_ERROR,
  WETH_ORACLE_ERROR,
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

interface CvxVolatileCollateralFixtureContext
  extends CollateralFixtureContext,
    Wrapped3PoolFixtureVolatile {
  wethFeed: MockV3Aggregator
  wbtcFeed: MockV3Aggregator
  btcFeed: MockV3Aggregator
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

interface CvxVolatileCollateralOpts extends CollateralOpts {
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

export const defaultCvxVolatileCollateralOpts: CvxVolatileCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('TRICRYPTO'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDT_USD_FEED, // unused but cannot be zero
  oracleTimeout: bn('1'), // unused but cannot be zero
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'), // TODO
  nTokens: bn('3'),
  curvePool: TRI_CRYPTO,
  lpToken: TRI_CRYPTO_TOKEN,
  poolType: CurvePoolType.Plain,
  feeds: [[USDT_USD_FEED], [WBTC_BTC_FEED, BTC_USD_FEED], [WETH_USD_FEED]],
  oracleTimeouts: [
    [USDT_ORACLE_TIMEOUT],
    [WBTC_ORACLE_TIMEOUT, BTC_ORACLE_TIMEOUT],
    [WETH_ORACLE_TIMEOUT],
  ],
  oracleErrors: [
    [USDT_ORACLE_ERROR],
    [WBTC_BTC_ORACLE_ERROR, BTC_USD_ORACLE_ERROR],
    [WETH_ORACLE_ERROR],
  ],
}

const makeFeeds = async () => {
  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )

  // Substitute all 3 feeds: DAI, USDC, USDT
  const wethFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  const wbtcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  const btcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

  const wethFeedOrg = MockV3AggregatorFactory.attach(WETH_USD_FEED)
  const wbtcFeedOrg = MockV3AggregatorFactory.attach(WBTC_BTC_FEED)
  const btcFeedOrg = MockV3AggregatorFactory.attach(BTC_USD_FEED)
  const usdtFeedOrg = MockV3AggregatorFactory.attach(USDT_USD_FEED)

  await wethFeed.updateAnswer(await wethFeedOrg.latestAnswer())
  await wbtcFeed.updateAnswer(await wbtcFeedOrg.latestAnswer())
  await btcFeed.updateAnswer(await btcFeedOrg.latestAnswer())
  await usdtFeed.updateAnswer(await usdtFeedOrg.latestAnswer())

  return { wethFeed, wbtcFeed, btcFeed, usdtFeed }
}

export const deployCollateral = async (
  opts: CvxVolatileCollateralOpts = {}
): Promise<CvxVolatileCollateral> => {
  if (!opts.erc20 && !opts.feeds) {
    const { wethFeed, wbtcFeed, btcFeed, usdtFeed } = await makeFeeds()

    const fix = await makeW3PoolVolatile()

    opts.feeds = [[wethFeed.address], [wbtcFeed.address, btcFeed.address], [usdtFeed.address]]
    opts.erc20 = fix.w3Pool.address
  }

  opts = { ...defaultCvxVolatileCollateralOpts, ...opts }

  const CvxVolatileCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CvxVolatileCollateral'
  )

  const collateral = <CvxVolatileCollateral>await CvxVolatileCollateralFactory.deploy(
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

  return collateral
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CvxVolatileCollateralOpts = {}
): Fixture<CvxVolatileCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxVolatileCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const { wethFeed, wbtcFeed, btcFeed, usdtFeed } = await makeFeeds()

    collateralOpts.feeds = [
      [usdtFeed.address],
      [wbtcFeed.address, btcFeed.address],
      [wethFeed.address],
    ]

    const fix = await makeW3PoolVolatile()

    collateralOpts.erc20 = fix.w3Pool.address
    collateralOpts.curvePool = fix.curvePool.address
    const collateral = <TestICollateral>((await deployCollateral(collateralOpts)) as unknown)
    const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX) // use CVX

    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      chainlinkFeed: usdtFeed,
      curvePool: fix.curvePool,
      crv3Pool: fix.crv3Pool,
      w3Pool: fix.w3Pool,
      usdt: fix.usdt,
      wbtc: fix.wbtc,
      weth: fix.weth,
      tok: fix.w3Pool,
      rewardToken,
      wbtcFeed,
      btcFeed,
      wethFeed,
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

const mintCollateralTo: MintCollateralFunc<CvxVolatileCollateralFixtureContext> = async (
  ctx: CvxVolatileCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintW3Pool(ctx, amount, user, recipient, TRI_CRYPTO_HOLDER)
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
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[WETH_USD_FEED, WBTC_BTC_FEED, WETH_USD_FEED], [], []],
      })
    ).to.be.revertedWith('price feeds limited to 2')
  })

  it('requires at least 1 price feed per token', async () => {
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[WETH_USD_FEED], [WETH_USD_FEED], []],
      })
    ).to.be.revertedWith('each token needs at least 1 price feed')
  })

  it('requires non-zero-address feeds', async () => {
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[ZERO_ADDRESS], [WBTC_BTC_FEED, BTC_USD_FEED], [WETH_USD_FEED]],
      })
    ).to.be.revertedWith('t0feed0 empty')
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[WETH_USD_FEED, ZERO_ADDRESS], [WBTC_BTC_FEED, BTC_USD_FEED], [WETH_USD_FEED]],
      })
    ).to.be.revertedWith('t0feed1 empty')
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[USDT_USD_FEED], [ZERO_ADDRESS], [WETH_USD_FEED]],
      })
    ).to.be.revertedWith('t1feed0 empty')
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[USDT_USD_FEED], [USDT_USD_FEED, ZERO_ADDRESS], [WETH_USD_FEED]],
      })
    ).to.be.revertedWith('t1feed1 empty')
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[USDT_USD_FEED], [USDT_USD_FEED], [ZERO_ADDRESS]],
      })
    ).to.be.revertedWith('t2feed0 empty')
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        feeds: [[USDT_USD_FEED], [USDT_USD_FEED], [WETH_USD_FEED, ZERO_ADDRESS]],
      })
    ).to.be.revertedWith('t2feed1 empty')
  })

  it('requires non-zero oracleTimeouts', async () => {
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        oracleTimeouts: [[bn('0')], [USDT_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
      })
    ).to.be.revertedWith('t0timeout0 zero')
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        oracleTimeouts: [[USDT_ORACLE_TIMEOUT], [bn('0')], [USDT_ORACLE_TIMEOUT]],
      })
    ).to.be.revertedWith('t1timeout0 zero')
    await expect(
      deployCollateral({
        erc20: TRI_CRYPTO_TOKEN, // can be anything.
        oracleTimeouts: [
          [USDT_ORACLE_TIMEOUT],
          [USDT_ORACLE_TIMEOUT, USDT_ORACLE_TIMEOUT],
          [bn('0')],
        ],
      })
    ).to.be.revertedWith('t2timeout0 zero')
  })

  it('requires non-zero oracleErrors', async () => {
    await expect(
      deployCollateral({
        oracleErrors: [[fp('1')], [USDT_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
      })
    ).to.be.revertedWith('t0error0 too large')
    await expect(
      deployCollateral({
        oracleErrors: [[USDT_ORACLE_ERROR], [fp('1')], [USDT_ORACLE_ERROR]],
      })
    ).to.be.revertedWith('t1error0 too large')
    await expect(
      deployCollateral({ oracleErrors: [[USDT_ORACLE_ERROR], [USDT_ORACLE_ERROR], [fp('1')]] })
    ).to.be.revertedWith('t2error0 too large')
  })
}

/*
  Run the test suite
*/

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`Collateral: Convex - Volatile`, () => {
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
    let ctx: CvxVolatileCollateralFixtureContext
    let alice: SignerWithAddress

    let wallet: SignerWithAddress
    let chainId: number

    let collateral: TestICollateral
    let chainlinkFeed: MockV3Aggregator
    let wbtcFeed: MockV3Aggregator
    let btcFeed: MockV3Aggregator
    let wethFeed: MockV3Aggregator
    let usdtFeed: MockV3Aggregator

    let crv: ERC20Mock
    let cvx: ERC20Mock

    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as SignerWithAddress[]

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[, alice] = await ethers.getSigners()
      ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
      ;({ chainlinkFeed, collateral, wbtcFeed, btcFeed, wethFeed, usdtFeed, crv, cvx } = ctx)

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
      it('prices change as feed price changes', async () => {
        await collateral.refresh()

        const initialRefPerTok = await collateral.refPerTok()
        const [low, high] = await collateral.price()

        await Promise.all([
          btcFeed
            .updateAnswer(await btcFeed.latestRoundData().then((e) => e.answer.mul(110).div(100)))
            .then((e) => e.wait()),
          wethFeed
            .updateAnswer(await wethFeed.latestRoundData().then((e) => e.answer.mul(110).div(100)))
            .then((e) => e.wait()),
          usdtFeed
            .updateAnswer(await usdtFeed.latestRoundData().then((e) => e.answer.mul(110).div(100)))
            .then((e) => e.wait()),
        ])

        const [newLow, newHigh] = await collateral.price()
        const expectedNewLow = low.mul(110).div(100)
        const expectedNewHigh = high.mul(110).div(100)

        // Expect price to be correct within 1 part in 100 million
        // The rounding comes from the oracle .mul(110).div(100) calculations truncating
        expect(newLow).to.be.closeTo(expectedNewLow, expectedNewLow.div(bn('1e8')))
        expect(newHigh).to.be.closeTo(expectedNewHigh, expectedNewHigh.div(bn('1e8')))
        expect(newLow).to.be.lt(expectedNewLow)
        expect(newHigh).to.be.lt(expectedNewHigh)

        // Check refPerTok remains the same (because we have not refreshed)
        const finalRefPerTok = await collateral.refPerTok()
        expect(finalRefPerTok).to.equal(initialRefPerTok)
      })

      it('prices change as refPerTok changes', async () => {
        await collateral.refresh()

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
        await collateral.refresh()

        await Promise.all([
          wbtcFeed.updateAnswer(0).then((e) => e.wait()),
          wethFeed.updateAnswer(0).then((e) => e.wait()),
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
        await wbtcFeed.setInvalidTimestamp()

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
        await collateral.refresh()
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
        const oracleTimeout = USDT_ORACLE_TIMEOUT.toNumber()
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

        // Two more quanta of decrease results in default
        await ctx.curvePool.setVirtualPrice(newVirtualPrice.sub(2))
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

        const fix = await makeW3PoolVolatile()

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

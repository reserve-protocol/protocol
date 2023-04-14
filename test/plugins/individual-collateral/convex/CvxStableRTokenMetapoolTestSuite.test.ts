import {
  CollateralFixtureContext,
  CollateralOpts,
  CollateralStatus,
  MintCollateralFunc,
} from '../pluginTestTypes'
import { makeWeUSDFraxBP, mintWeUSDFraxBP, WrappedEUSDFraxBPFixture, resetFork } from './helpers'
import hre, { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  CvxStableRTokenMetapoolCollateral,
  ERC20Mock,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import {
  MAX_UINT256,
  MAX_UINT192,
  MAX_UINT48,
  ZERO_ADDRESS,
  ONE_ADDRESS,
} from '../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
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

interface CvxStableRTokenMetapoolCollateralFixtureContext
  extends CollateralFixtureContext,
    WrappedEUSDFraxBPFixture {
  fraxFeed: MockV3Aggregator
  usdcFeed: MockV3Aggregator
  eusdFeed: MockV3Aggregator
  cvx: ERC20Mock
  crv: ERC20Mock
}

// interface CometCollateralFixtureContextMockComet extends CollateralFixtureContext {
//   cusdcV3: CometMock
//   wcusdcV3: ICusdcV3Wrapper
//   usdc: ERC20Mock
//   wcusdcV3Mock: CusdcV3WrapperMock
// }

interface CvxStableRTokenMetapoolCollateralOpts extends CollateralOpts {
  revenueHiding?: BigNumberish
  nTokens?: BigNumberish
  curvePool?: string
  poolType?: CurvePoolType // for underlying fraxBP pool
  feeds?: string[][]
  oracleTimeouts?: BigNumberish[][]
  oracleErrors?: BigNumberish[][]
  lpToken?: string
  metapoolToken?: string
}

/*
    Define deployment functions
  */

export const defaultCvxStableCollateralOpts: CvxStableRTokenMetapoolCollateralOpts = {
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
}

export const deployCollateral = async (
  opts: CvxStableRTokenMetapoolCollateralOpts = {}
): Promise<CvxStableRTokenMetapoolCollateral> => {
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
    'CvxStableRTokenMetapoolCollateral'
  )

  const collateral = <CvxStableRTokenMetapoolCollateral>(
    await CvxStableRTokenMetapoolCollateralFactory.deploy(
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
      opts.defaultThreshold // use same 2% value
    )
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CvxStableRTokenMetapoolCollateralOpts = {}
): Fixture<CvxStableRTokenMetapoolCollateralFixtureContext> => {
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

    const collateral = <TestICollateral>((await deployCollateral(collateralOpts)) as unknown)
    const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX) // use CVX

    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      chainlinkFeed: usdcFeed,
      metapoolToken: fix.metapoolToken,
      realMetapool: fix.realMetapool,
      curvePool: fix.curvePool,
      wPool: fix.wPool,
      frax: fix.frax,
      usdc: fix.usdc,
      eusd: fix.eusd,
      tok: fix.wPool,
      rewardToken,
      fraxFeed,
      usdcFeed,
      eusdFeed,
      cvx,
      crv,
    }
  }

  return makeCollateralFixtureContext
}

/*
    Define helper functions
  */

const mintCollateralTo: MintCollateralFunc<
  CvxStableRTokenMetapoolCollateralFixtureContext
> = async (
  ctx: CvxStableRTokenMetapoolCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWeUSDFraxBP(ctx, amount, user, recipient, eUSD_FRAX_HOLDER)
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

  it('does not allow more than 2 tokens', async () => {
    await expect(deployCollateral({ nTokens: 1 })).to.be.reverted
    await expect(deployCollateral({ nTokens: 3 })).to.be.reverted
  })

  it('does not allow empty curvePool', async () => {
    await expect(deployCollateral({ curvePool: ZERO_ADDRESS })).to.be.revertedWith(
      'curvePool address is zero'
    )
  })

  it('does not allow more than 2 price feeds', async () => {
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        feeds: [[FRAX_USD_FEED, FRAX_USD_FEED, FRAX_USD_FEED], [], []],
      })
    ).to.be.revertedWith('price feeds limited to 2')
  })

  it('requires at least 1 price feed per token', async () => {
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        feeds: [[FRAX_USD_FEED, FRAX_USD_FEED], [USDC_USD_FEED], []],
      })
    ).to.be.revertedWith('each token needs at least 1 price feed')
  })

  it('requires non-zero-address feeds', async () => {
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        feeds: [[ZERO_ADDRESS], [FRAX_USD_FEED]],
      })
    ).to.be.revertedWith('t0feed0 empty')
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        feeds: [[FRAX_USD_FEED, ZERO_ADDRESS], [USDC_USD_FEED]],
      })
    ).to.be.revertedWith('t0feed1 empty')
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        feeds: [[FRAX_USD_FEED], [ZERO_ADDRESS]],
      })
    ).to.be.revertedWith('t1feed0 empty')
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        feeds: [[FRAX_USD_FEED], [USDC_USD_FEED, ZERO_ADDRESS]],
      })
    ).to.be.revertedWith('t1feed1 empty')
  })

  it('requires non-zero oracleTimeouts', async () => {
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        oracleTimeouts: [[bn('0')], [FRAX_ORACLE_TIMEOUT]],
      })
    ).to.be.revertedWith('t0timeout0 zero')
    await expect(
      deployCollateral({
        erc20: eUSD_FRAX_BP, // can be anything.
        oracleTimeouts: [[FRAX_ORACLE_TIMEOUT], [bn('0')]],
      })
    ).to.be.revertedWith('t1timeout0 zero')
  })

  it('requires non-zero oracleErrors', async () => {
    await expect(
      deployCollateral({
        oracleErrors: [[fp('1')], [USDC_ORACLE_ERROR]],
      })
    ).to.be.revertedWith('t0error0 too large')
    await expect(
      deployCollateral({
        oracleErrors: [[FRAX_ORACLE_ERROR], [fp('1')]],
      })
    ).to.be.revertedWith('t1error0 too large')
  })
}

/*
    Run the test suite
  */

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`Collateral: Convex - RToken Metapool (eUSD/fraxBP)`, () => {
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
    let ctx: CvxStableRTokenMetapoolCollateralFixtureContext
    let alice: SignerWithAddress

    let wallet: SignerWithAddress
    let chainId: number

    let collateral: TestICollateral
    let fraxFeed: MockV3Aggregator
    let usdcFeed: MockV3Aggregator
    let eusdFeed: MockV3Aggregator

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
      ;({ collateral, fraxFeed, usdcFeed, eusdFeed, crv, cvx } = ctx)

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
        const feedData = await usdcFeed.latestRoundData()
        const initialRefPerTok = await collateral.refPerTok()

        const [low, high] = await collateral.price()

        // Update values in Oracles increase by 10%
        const newPrice = feedData.answer.mul(110).div(100)

        await Promise.all([
          fraxFeed.updateAnswer(newPrice).then((e) => e.wait()),
          usdcFeed.updateAnswer(newPrice).then((e) => e.wait()),
          eusdFeed.updateAnswer(newPrice).then((e) => e.wait()),
        ])

        // Appreciated 10%
        const [newLow, newHigh] = await collateral.price()
        expect(newLow).to.be.closeTo(low.mul(110).div(100), 1)
        expect(newHigh).to.be.closeTo(high.mul(110).div(100), 1)

        // Check refPerTok remains the same
        const finalRefPerTok = await collateral.refPerTok()
        expect(finalRefPerTok).to.equal(initialRefPerTok)
      })

      it('prices change as refPerTok changes', async () => {
        const initRefPerTok = await collateral.refPerTok()
        const curveVirtualPrice = await ctx.metapoolToken.get_virtual_price()
        await ctx.metapoolToken.setVirtualPrice(curveVirtualPrice.add(1e4))
        await collateral.refresh()
        expect(await collateral.refPerTok()).to.be.gt(initRefPerTok)
      })

      it('returns a 0 price', async () => {
        await Promise.all([
          fraxFeed.updateAnswer(0).then((e) => e.wait()),
          usdcFeed.updateAnswer(0).then((e) => e.wait()),
          eusdFeed.updateAnswer(0).then((e) => e.wait()),
        ])

        // (0, 0) is returned
        const [low, high] = await collateral.price()
        expect(low).to.equal(0)
        expect(high).to.equal(0)

        // When refreshed, sets status to IFFY
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('still reads out pool token price when paired price is broken', async () => {
        await eusdFeed.updateAnswer(MAX_UINT256.div(2).sub(1))

        // (>0.5, +inf) is returned
        const [low, high] = await collateral.price()
        expect(low).to.be.gt(fp('0.5'))
        expect(high).to.be.gt(fp('1e27')) // won't quite be FIX_MAX always

        // When refreshed, sets status to IFFY
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('reverts in case of invalid timestamp', async () => {
        await usdcFeed.setInvalidTimestamp()

        // Check price of token
        const [low, high] = await collateral.price()
        expect(low).to.equal(0)
        expect(high).to.equal(MAX_UINT192)

        // When refreshed, sets status to IFFY
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
      before(resetFork)

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
        const updateAnswerTx = await usdcFeed.updateAnswer(bn('8e7'))
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
        const updateAnswerTx = await usdcFeed.updateAnswer(bn('1.2e8'))
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
        const updateAnswerTx = await usdcFeed.updateAnswer(bn('8e7'))
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

      // handy trick for dealing with expiring oracles
      it('resets fork', async () => {
        await resetFork()
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

        const currentExchangeRate = await ctx.metapoolToken.get_virtual_price()
        await ctx.metapoolToken.setVirtualPrice(currentExchangeRate.sub(1e3))

        // Collateral defaults due to refPerTok() going down
        await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
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
        const currentExchangeRate = await ctx.metapoolToken.get_virtual_price()
        const newVirtualPrice = currentExchangeRate.sub(currentExchangeRate.div(bn('1e6')))
        await ctx.metapoolToken.setVirtualPrice(newVirtualPrice)

        // Collateral remains SOUND
        await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

        // One quanta more of decrease results in default
        await ctx.metapoolToken.setVirtualPrice(newVirtualPrice.sub(1))
        await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
      })

      it('enters IFFY state when price becomes stale', async () => {
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
        const oracleTimeout = FRAX_ORACLE_TIMEOUT.toNumber()
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('enters IFFY state when _only_ the RToken de-pegs for 72h', async () => {
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

        // De-peg RToken to just below threshold of $0.98
        await eusdFeed.updateAnswer(fp('0.9799999'))
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

        // Advance 72h
        await setNextBlockTimestamp(
          RTOKEN_DELAY_UNTIL_DEFAULT.add(await getLatestBlockTimestamp()).toNumber()
        )
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      })

      it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
        const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
          'InvalidMockV3Aggregator'
        )
        const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
          await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
        )

        const fix = await makeWeUSDFraxBP(eusdFeed)

        const invalidCollateral = await deployCollateral({
          erc20: fix.wPool.address,
          feeds: [[invalidChainlinkFeed.address], [invalidChainlinkFeed.address]],
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

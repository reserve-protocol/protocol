// import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, CollateralStatus, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintRETH, getBWethDaiPool, mintBWETHDAI, transferWETH } from './helpers'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  BalancerLPCollateral,
  WETH9,
  InvalidMockV3Aggregator,
  IERC20Metadata,
  IVault,
  BPool,
} from '../../../../typechain'
import { ZERO, bn, fp } from '../../../../common/numbers'
import { MAX_UINT192, MAX_UINT256, MAX_UINT48, ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  DAI,
  BWETHDAI,
  BWETHDAIPOOLID,
  ETH_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  WETH_WHALE,
  BWETHDAI_WHALE,
  DAI_WHALE,
  GAUGE_FACTORY,
  BALANCER_MINTER,
  BAL,
} from './constants'
import { whileImpersonating } from '#/test/utils/impersonation'
import { useEnv } from '#/utils/env'
import { getChainId } from '#/common/blockchain-utils'
import { networkConfig } from '#/common/configuration'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp, setNextBlockTimestamp } from '#/test/utils/time'

/*
  Define interfaces
*/

interface BalancerLPCollateralFixtureContext
  extends Omit<CollateralFixtureContext, 'collateral' | 'tok'> {
  tok: BPool
  collateral: BalancerLPCollateral
  weth: WETH9
  dai: ERC20Mock
  bal: ERC20Mock
  wethFeed: MockV3Aggregator
  daiFeed: MockV3Aggregator
}

interface BalancerLPCollateralOpts extends CollateralOpts {
  tokenIsFiat?: BigNumberish
  token0ChainlinkFeed?: string
  token1ChainlinkFeed?: string
  poolId?: string
  gaugeFactory?: string
  balancerMinter?: string
}
/*
  Define deployment functions
*/

export const defaultBalancerLPCollateralOpts: BalancerLPCollateralOpts = {
  tokenIsFiat: 1,
  erc20: BWETHDAI,
  priceTimeout: PRICE_TIMEOUT,
  poolId: BWETHDAIPOOLID,
  token0ChainlinkFeed: DAI_USD_PRICE_FEED,
  token1ChainlinkFeed: ETH_USD_PRICE_FEED,
  gaugeFactory: GAUGE_FACTORY,
  balancerMinter: BALANCER_MINTER,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  targetName: ethers.utils.formatBytes32String('BWETHDAI'),
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'), // TODO: is this really needed?
}

export const deployCollateral = async (
  opts: BalancerLPCollateralOpts = {}
): Promise<BalancerLPCollateral> => {
  opts = { ...defaultBalancerLPCollateralOpts, ...opts }
  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )

  const BalancerLPCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'BalancerLPCollateral'
  )

  const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  const wethFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, bn('1e18'))

  if (!opts.token0ChainlinkFeed) {
    opts.token0ChainlinkFeed = daiFeed.address
  }

  if (!opts.token1ChainlinkFeed) {
    opts.token1ChainlinkFeed = wethFeed.address
  }

  const collateral = <BalancerLPCollateral>await BalancerLPCollateralFactory.deploy(
    {
      tokenIsFiat: opts.tokenIsFiat,
      priceTimeout: opts.priceTimeout,
      poolId: opts.poolId,
      token0ChainlinkFeed: opts.token0ChainlinkFeed,
      token1ChainlinkFeed: opts.token1ChainlinkFeed,
      gaugeFactory: opts.gaugeFactory,
      balancerMinter: opts.balancerMinter,
      oracleError: opts.oracleError,
      erc20: opts.erc20,
      maxTradeVolume: opts.maxTradeVolume,
      oracleTimeout: opts.oracleTimeout,
      targetName: opts.targetName,
      defaultThreshold: opts.defaultThreshold,
      delayUntilDefault: opts.delayUntilDefault,
    },
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()
  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const refPerTokChainlinkDefaultAnswer = fp('1')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: BalancerLPCollateralOpts = {}
): Fixture<BalancerLPCollateralFixtureContext> => {
  const collateralOpts = { ...defaultBalancerLPCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const daiFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const wethFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, bn('1e18'))

    collateralOpts.token0ChainlinkFeed = daiFeed.address
    collateralOpts.token1ChainlinkFeed = wethFeed.address

    const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
    const bal = (await ethers.getContractAt('ERC20Mock', BAL)) as ERC20Mock
    const dai = (await ethers.getContractAt('ERC20Mock', DAI)) as ERC20Mock // TODO: is this the ideal way to do this?
    // const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const bwethdai = (await getBWethDaiPool()).bwethdai

    return {
      alice,
      tokenIsFiat: 1,
      chainlinkFeed: daiFeed,
      collateral: collateral,
      token0ChainlinkFeed: daiFeed.address,
      token1ChainlinkFeed: wethFeed.address,
      poolId: '0x0b09dea16768f0799065c475be02919503cb2a3500020000000000000000001a',
      tok: bwethdai,
      weth: weth,
      bal: bal,
      dai: dai,
      wethFeed: wethFeed,
      daiFeed: daiFeed,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

// const mintCollateralTo: MintCollateralFunc<BalancerLPCollateralFixtureContext> = async (
const mintCollateralTo = async (
  ctx: BalancerLPCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintBWETHDAI(ctx.tok, user, amount, recipient)
}

const collateralSpecificConstructorTests = () => {
  // it('does not allow 0 defaultThreshold', async () => {
  //   await expect(deployCollateral({ defaultThreshold: bn('0') })).to.be.revertedWith(
  //     'defaultThreshold zero'
  //   )
  // })

  it('does now allow invalid tokenIsFiat bitmap', async () => {
    await expect(deployCollateral({ tokenIsFiat: 0 })).to.not.be.reverted
    await expect(deployCollateral({ tokenIsFiat: 1 })).to.not.be.reverted
    await expect(deployCollateral({ tokenIsFiat: 2 })).to.not.be.reverted
    await expect(deployCollateral({ tokenIsFiat: 3 })).to.not.be.reverted
    await expect(deployCollateral({ tokenIsFiat: 4 })).to.be.revertedWith(
      'invalid tokenIsFiat bitmap'
    )
  })

  it('requires non-zero-address feeds', async () => {
    await expect(
      deployCollateral({
        token0ChainlinkFeed: ZERO_ADDRESS,
        token1ChainlinkFeed: ETH_USD_PRICE_FEED,
      })
    ).to.be.revertedWith('missing chainlink feed')

    await expect(
      deployCollateral({
        token0ChainlinkFeed: ETH_USD_PRICE_FEED,
        token1ChainlinkFeed: ZERO_ADDRESS,
      })
    ).to.be.revertedWith('missing token1 chainlink feed')
  })
}

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`Collateral: BWETHDAI`, () => {
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
        deployCollateral({ token0ChainlinkFeed: ethers.constants.AddressZero })
      ).to.be.revertedWith('missing chainlink feed')
    })

    it('does not allow missing gaugeFactory', async () => {
      await expect(
        deployCollateral({ gaugeFactory: ethers.constants.AddressZero })
      ).to.be.revertedWith('missing gaugeFactory')
    })

    it('does not allow missing balancer minter', async () => {
      await expect(
        deployCollateral({ balancerMinter: ethers.constants.AddressZero })
      ).to.be.revertedWith('missing balancer minter')
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
    let ctx: BalancerLPCollateralFixtureContext
    let alice: SignerWithAddress
    let wethWhale: SignerWithAddress

    let chainId: number

    let collateral: BalancerLPCollateral
    let chainlinkFeed: MockV3Aggregator

    let weth: WETH9
    let bal: ERC20Mock
    let dai: ERC20Mock

    let daiFeed: MockV3Aggregator
    let wethFeed: MockV3Aggregator

    let bwethdai: BPool

    before(async () => {
      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[, alice] = await ethers.getSigners()
      ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
      let tok
      ;({ chainlinkFeed, collateral, daiFeed, wethFeed, tok, weth, dai, bal} = ctx)
      bwethdai = tok
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [WETH_WHALE],
      })
    })

    describe('functions', () => {
      it('returns the correct bal (18 decimals)', async () => {
        const amount = bn('20').mul(bn(10).pow(await ctx.tok.decimals()))
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

      // it('claims balancer rewards', async () => {
      //   const amount = bn('100').mul(bn(10).pow(await ctx.tok.decimals()))
      //   await mintCollateralTo(ctx, amount, alice, collateral.address)

      //   await advanceBlocks(1000)
      //   await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1200000)

      //   const balBefore = await bal.balanceOf(collateral.address)
      //   await expect(collateral.claimRewards()).to.emit(collateral, 'RewardsClaimed')
      //   const balAfter = await bal.balanceOf(collateral.address)
      //   expect(balAfter).gt(balBefore)
      // })
    })

    describe('prices', () => {
      before(resetFork)
      it('prices change as feed price changes', async () => {
        const feedData = await daiFeed.latestRoundData()
        const initialRefPerTok = await collateral.refPerTok()

        const [low, high] = await collateral.price()

        // Update values in Oracles increase by 10%
        const newPrice = feedData.answer.mul(110).div(100)

        await Promise.all([
          wethFeed.updateAnswer(newPrice).then((e) => e.wait()),
          daiFeed.updateAnswer(newPrice).then((e) => e.wait()),
        ])

        const [newLow, newHigh] = await collateral.price()

        expect(newLow).to.be.closeTo(low.mul(110).div(100), bn('1e18'))
        expect(newHigh).to.be.closeTo(high.mul(110).div(100), bn('1e18'))

        // Check refPerTok remains the same (because we have not refreshed)
        const finalRefPerTok = await collateral.refPerTok()
        expect(finalRefPerTok).to.equal(initialRefPerTok)
      })

      it('prices change as refPerTok changes', async () => {
        const initRefPerTok = await collateral.refPerTok()
        const [initLow, initHigh] = await collateral.price()

        const vault = (await ethers.getContractAt('IVault', await bwethdai.getVault())) as IVault
        // await transferWETH(weth, wethWhale, bn('10000e18'), BWETHDAI_WHALE)
        await whileImpersonating(WETH_WHALE, async (wethWhaleSigner) => {
          await weth.connect(wethWhaleSigner).approve(vault.address, bn('1000e18'))
          await weth.connect(wethWhaleSigner).approve(BWETHDAI, bn('1000e18'))
          await vault.connect(wethWhaleSigner).swap(
            {
              poolId: BWETHDAIPOOLID,
              kind: 0,
              assetIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              assetOut: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
              amount: bn('0.1e18'),
              userData: '0x',
            },
            {
              sender: wethWhaleSigner.address,
              fromInternalBalance: false,
              recipient: wethWhaleSigner.address,
              toInternalBalance: false,
            },
            bn('50e18'),
            '18681349549' // very far away in the future
          )
        })

        await whileImpersonating(DAI_WHALE, async (daiWhaleSigner) => {
          await dai.connect(daiWhaleSigner).approve(vault.address, bn('1000e18'))
          await dai.connect(daiWhaleSigner).approve(BWETHDAI, bn('1000e18'))
          await vault.connect(daiWhaleSigner).swap(
            {
              poolId: BWETHDAIPOOLID,
              kind: 1,
              assetIn: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
              assetOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              amount: bn('0.1e18'),
              userData: '0x',
            },
            {
              sender: daiWhaleSigner.address,
              fromInternalBalance: false,
              recipient: daiWhaleSigner.address,
              toInternalBalance: false,
            },
            bn('300e18'),
            '18681349549' // very far away in the future
          )
        })

        await collateral.refresh()
        expect(await collateral.refPerTok()).to.be.gt(initRefPerTok)

        const [newLow, newHigh] = await collateral.price()
        expect(newLow).to.be.gt(initLow)
        expect(newHigh).to.be.gt(initHigh)
      })

      it('returns a 0 price', async () => {
        await Promise.all([
          wethFeed.updateAnswer(0).then((e) => e.wait()),
          daiFeed.updateAnswer(0).then((e) => e.wait()),
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
        await daiFeed.setInvalidTimestamp()

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

        // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
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

        // Depeg DAI:USD - Raising price by 20% from 1 to 1.2
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

        // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
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

        const vault = (await ethers.getContractAt('IVault', await bwethdai.getVault())) as IVault
        // await transferWETH(weth, wethWhale, bn('10000e18'), BWETHDAI_WHALE)

        // should cause an imbalance in the pool
        await whileImpersonating(WETH_WHALE, async (wethWhaleSigner) => {
          await weth.connect(wethWhaleSigner).approve(vault.address, bn('1000e18'))
          await weth.connect(wethWhaleSigner).approve(BWETHDAI, bn('1000e18'))
          await vault.connect(wethWhaleSigner).swap(
            {
              poolId: BWETHDAIPOOLID,
              kind: 0,
              assetIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              assetOut: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
              amount: bn('100e18'),
              userData: '0x',
            },
            {
              sender: wethWhaleSigner.address,
              fromInternalBalance: false,
              recipient: wethWhaleSigner.address,
              toInternalBalance: false,
            },
            bn('5000e18'),
            '18681349549' // very far away in the future
          )
        })

        // Collateral defaults due to refPerTok() going down
        await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
      })

      it('enters IFFY state when price becomes stale', async () => {
        const oracleTimeout = ORACLE_TIMEOUT.toNumber()
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
        await collateral.refresh()
        expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
        const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
          'InvalidMockV3Aggregator'
        )
        const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
          await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
        )

        const fix = await getBWethDaiPool()

        const invalidCollateral = await deployCollateral({
          erc20: fix.bwethdai.address,
          token0ChainlinkFeed: invalidChainlinkFeed.address,
          token1ChainlinkFeed: invalidChainlinkFeed.address,
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

    // describe('collateral-specific tests', collateralSpecificStatusTests)
  })
})

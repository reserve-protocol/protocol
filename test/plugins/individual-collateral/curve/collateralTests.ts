import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  CurveCollateralTestSuiteFixtures,
} from './pluginTestTypes'
import { CollateralStatus } from '../pluginTestTypes'
import hre, { ethers } from 'hardhat'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, ContractFactory } from 'ethers'
import { getChainId } from '../../../../common/blockchain-utils'
import { bn, fp, toBNDecimals } from '../../../../common/numbers'
import {
  DefaultFixture,
  Fixture,
  getDefaultFixture,
  ORACLE_TIMEOUT_BUFFER,
  ORACLE_TIMEOUT,
} from '../fixtures'
import { expectInIndirectReceipt } from '../../../../common/events'
import { whileImpersonating } from '../../../utils/impersonation'
import {
  MAX_UINT48,
  MAX_UINT192,
  MAX_UINT256,
  TradeKind,
  ZERO_ADDRESS,
  ONE_ADDRESS,
} from '../../../../common/constants'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { useEnv } from '#/utils/env'
import { expectDecayedPrice, expectExactPrice, expectUnpriced } from '../../../utils/oracles'
import {
  IGovParams,
  IGovRoles,
  IRTokenSetup,
  networkConfig,
} from '../../../../common/configuration'
import {
  advanceBlocks,
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
} from '#/test/utils/time'
import {
  ERC20Mock,
  FacadeWrite,
  IAssetRegistry,
  IERC20Metadata,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  TestIBackingManager,
  TestIBasketHandler,
  TestICollateral,
  TestIDeployer,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
} from '../../../../typechain'
import snapshotGasCost from '../../../utils/snapshotGasCost'
import { IMPLEMENTATION, Implementation, ORACLE_ERROR, PRICE_TIMEOUT } from '../../../fixtures'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

const getDescribeFork = (targetNetwork = 'mainnet') => {
  return useEnv('FORK') && useEnv('FORK_NETWORK') === targetNetwork ? describe : describe.skip
}

export default function fn<X extends CurveCollateralFixtureContext>(
  fixtures: CurveCollateralTestSuiteFixtures<X>
) {
  const {
    deployCollateral,
    collateralSpecificConstructorTests,
    collateralSpecificStatusTests,
    makeCollateralFixtureContext,
    mintCollateralTo,
    isMetapool,
    resetFork,
    collateralName,
    itChecksTargetPerRefDefault,
    itClaimsRewards,
    targetNetwork,
  } = fixtures

  getDescribeFork(targetNetwork)(`Collateral: ${collateralName}`, () => {
    let defaultOpts: CurveCollateralOpts
    let mockERC20: ERC20Mock
    let collateral: TestICollateral

    before(async () => {
      await resetFork()
      ;[collateral, defaultOpts] = await deployCollateral({})
      const ERC20Factory = await ethers.getContractFactory('ERC20Mock')
      mockERC20 = await ERC20Factory.deploy('Mock ERC20', 'ERC20')
    })

    describe('constructor validation', () => {
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

      it('does not allow invalid Pool Type', async () => {
        await expect(deployCollateral({ poolType: 1 })).to.be.revertedWith('invalid poolType')
      })

      it('does not allow more than 2 price feeds', async () => {
        await expect(
          deployCollateral({
            erc20: mockERC20.address, // can be anything.
            feeds: [[ONE_ADDRESS, ONE_ADDRESS, ONE_ADDRESS], [], []],
          })
        ).to.be.revertedWith('price feeds limited to 2')
      })

      it('supports up to 2 price feeds per token', async () => {
        const nonzeroError = fp('0.01') // 1%
        const nTokens = Number(defaultOpts.nTokens) || 0

        const feeds: string[][] = []
        for (let i = 0; i < nTokens; i++) {
          feeds.push([ONE_ADDRESS, ONE_ADDRESS])
        }

        const oracleTimeouts: BigNumber[][] = []
        for (let i = 0; i < nTokens; i++) {
          oracleTimeouts.push([bn('1'), bn('1')])
        }

        const oracleErrors: BigNumber[][] = []
        for (let i = 0; i < nTokens; i++) {
          oracleErrors.push([nonzeroError, bn(0)])
        }

        await expect(
          deployCollateral({
            erc20: await collateral.erc20(),
            feeds,
            oracleTimeouts,
            oracleErrors,
          })
        ).to.not.be.reverted
      })

      it('requires at least 1 price feed per token', async () => {
        await expect(
          deployCollateral({
            erc20: mockERC20.address, // can be anything.
            feeds: [[ONE_ADDRESS, ONE_ADDRESS], [ONE_ADDRESS], []],
          })
        ).to.be.revertedWith('each token needs at least 1 price feed')

        await expect(
          deployCollateral({
            erc20: mockERC20.address, // can be anything.
            feeds: [[], [ONE_ADDRESS, ONE_ADDRESS], [ONE_ADDRESS]],
          })
        ).to.be.revertedWith('each token needs at least 1 price feed')

        await expect(
          deployCollateral({
            erc20: mockERC20.address, // can be anything.
            feeds: [[ONE_ADDRESS], [], [ONE_ADDRESS, ONE_ADDRESS]],
          })
        ).to.be.revertedWith('each token needs at least 1 price feed')
      })

      it('requires non-zero-address feeds', async () => {
        const nonzeroTimeout = bn(defaultOpts.oracleTimeouts![0][0])
        const nonzeroError = bn(defaultOpts.oracleErrors![0][0])

        // Complete all possible feeds
        const allFeeds: string[][] = []
        const allOracleTimeouts: BigNumber[][] = []
        const allOracleErrors: BigNumber[][] = []

        for (let i = 0; i < defaultOpts.nTokens!; i++) {
          allFeeds[i] = [ONE_ADDRESS, ONE_ADDRESS]
          allOracleTimeouts[i] = [nonzeroTimeout, nonzeroTimeout]
          allOracleErrors[i] = [nonzeroError, nonzeroError]
        }

        for (let i = 0; i < allFeeds.length; i++) {
          for (let j = 0; j < allFeeds[i].length; j++) {
            const feeds = allFeeds.map((f) => f.map(() => ONE_ADDRESS))
            feeds[i][j] = ZERO_ADDRESS

            await expect(
              deployCollateral({
                erc20: mockERC20.address, // can be anything.
                feeds,
                oracleTimeouts: allOracleTimeouts,
                oracleErrors: allOracleErrors,
              })
            ).to.be.revertedWith(`t${i}feed${j} empty`)
          }
        }
      })

      it('requires non-zero oracleTimeouts', async () => {
        const nonzeroError = bn(defaultOpts.oracleErrors![0][0])

        // Complete all possible feeds
        const allFeeds: string[][] = []
        const allOracleTimeouts: BigNumber[][] = []
        const allOracleErrors: BigNumber[][] = []

        for (let i = 0; i < defaultOpts.nTokens!; i++) {
          allFeeds[i] = [ONE_ADDRESS, ONE_ADDRESS]
          allOracleTimeouts[i] = [bn('1'), bn('1')]
          allOracleErrors[i] = [nonzeroError, nonzeroError]
        }

        for (let i = 0; i < allFeeds.length; i++) {
          for (let j = 0; j < allFeeds[i].length; j++) {
            const oracleTimeouts = allOracleTimeouts.map((f) => f.map(() => bn('1')))
            oracleTimeouts[i][j] = bn('0')

            await expect(
              deployCollateral({
                erc20: mockERC20.address, // can be anything.
                feeds: allFeeds,
                oracleTimeouts,
                oracleErrors: allOracleErrors,
              })
            ).to.be.revertedWith(`t${i}timeout${j} zero`)
          }
        }
      })

      it('requires non-large oracleErrors', async () => {
        const nonlargeError = fp('0.01') // 1%

        // Complete all possible feeds
        const allFeeds: string[][] = []
        const allOracleTimeouts: BigNumber[][] = []
        const allOracleErrors: BigNumber[][] = []

        for (let i = 0; i < defaultOpts.nTokens!; i++) {
          allFeeds[i] = [ONE_ADDRESS, ONE_ADDRESS]
          allOracleTimeouts[i] = [bn('1'), bn('1')]
          allOracleErrors[i] = [nonlargeError, nonlargeError]
        }

        for (let i = 0; i < allFeeds.length; i++) {
          for (let j = 0; j < allFeeds[i].length; j++) {
            const oracleErrors = allOracleErrors.map((f) => f.map(() => nonlargeError))
            oracleErrors[i][j] = fp('1')

            await expect(
              deployCollateral({
                erc20: mockERC20.address, // can be anything.
                feeds: allFeeds,
                oracleTimeouts: allOracleTimeouts,
                oracleErrors,
              })
            ).to.be.revertedWith(`t${i}error${j} too large`)
          }
        }
      })

      it('validates targetName', async () => {
        await expect(
          deployCollateral({ targetName: ethers.constants.HashZero })
        ).to.be.revertedWith('targetName missing')
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
        await expect(deployCollateral({ oracleTimeout: 0 })).to.be.revertedWith(
          'oracleTimeout zero'
        )
      })

      it('does not allow missing delayUntilDefault if defaultThreshold > 0', async () => {
        await expect(deployCollateral({ delayUntilDefault: 0 })).to.be.revertedWith(
          'delayUntilDefault zero'
        )
      })
      describe('collateral-specific constructor tests', collateralSpecificConstructorTests)
    })

    describe('collateral functionality', () => {
      let ctx: CurveCollateralFixtureContext
      let amt: BigNumber

      beforeEach(async () => {
        await resetFork()
        const [alice] = await ethers.getSigners()
        ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
        amt = bn('200').mul(bn(10).pow(await ctx.wrapper.decimals()))
        expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
      })

      describe('functions', () => {
        it('returns the correct bal (18 decimals)', async () => {
          await mintCollateralTo(ctx, amt, ctx.alice, ctx.alice.address)

          const aliceBal = await ctx.collateral.bal(ctx.alice.address)
          expect(aliceBal).to.closeTo(amt, amt.div(200))
        })
      })

      describe('rewards', () => {
        it('does not revert', async () => {
          await expect(ctx.collateral.claimRewards()).to.not.be.reverted
        })

        itClaimsRewards('claims rewards (plugin)', async () => {
          await mintCollateralTo(ctx, amt, ctx.alice, ctx.collateral.address)

          await advanceBlocks(1000)
          await advanceToTimestamp((await getLatestBlockTimestamp()) + 12000)

          const before = await Promise.all(
            ctx.rewardTokens.map((t) => t.balanceOf(ctx.collateral.address))
          )
          await expect(ctx.collateral.claimRewards()).to.emit(ctx.collateral, 'RewardsClaimed')
          const after = await Promise.all(
            ctx.rewardTokens.map((t) => t.balanceOf(ctx.collateral.address))
          )

          // Each reward token should have grew
          for (let i = 0; i < ctx.rewardTokens.length; i++) {
            expect(after[i]).gt(before[i])
          }
        })

        itClaimsRewards('claims rewards (wrapper)', async () => {
          await mintCollateralTo(ctx, amt, ctx.alice, ctx.alice.address)

          await advanceBlocks(1000)
          await advanceToTimestamp((await getLatestBlockTimestamp()) + 12000)

          const before = await Promise.all(
            ctx.rewardTokens.map((t) => t.balanceOf(ctx.alice.address))
          )
          await expect(ctx.wrapper.connect(ctx.alice).claimRewards()).to.emit(
            ctx.wrapper,
            'RewardsClaimed'
          )
          const after = await Promise.all(
            ctx.rewardTokens.map((t) => t.balanceOf(ctx.alice.address))
          )

          // Each reward token should have grew
          for (let i = 0; i < ctx.rewardTokens.length; i++) {
            expect(after[i]).gt(before[i])
          }
        })
      })

      describe('prices', () => {
        it('prices change as feed price changes', async () => {
          const initialRefPerTok = await ctx.collateral.refPerTok()
          const [low, high] = await ctx.collateral.price()

          // Update values in Oracles increase by 10%
          const initialPrices = await Promise.all(ctx.feeds.map((f) => f.latestRoundData()))
          for (const [i, feed] of ctx.feeds.entries()) {
            await feed.updateAnswer(initialPrices[i].answer.mul(110).div(100)).then((e) => e.wait())
          }

          const [newLow, newHigh] = await ctx.collateral.price()

          // with 18 decimals of price precision a 1e-9 tolerance seems fine for a 10% change
          // and without this kind of tolerance the Volatile pool tests fail due to small movements
          expect(newLow).to.be.closeTo(low.mul(110).div(100), fp('1e-9'))
          expect(newHigh).to.be.closeTo(high.mul(110).div(100), fp('1e-9'))

          // Check refPerTok remains the same (because we have not refreshed)
          const finalRefPerTok = await ctx.collateral.refPerTok()
          expect(finalRefPerTok).to.equal(initialRefPerTok)
        })

        it('prices change as refPerTok changes', async () => {
          const initRefPerTok = await ctx.collateral.refPerTok()
          const [initLow, initHigh] = await ctx.collateral.price()

          const curveVirtualPrice = await ctx.curvePool.get_virtual_price()
          await ctx.curvePool.setVirtualPrice(curveVirtualPrice.add(1e7))

          const newBalances = [
            await ctx.curvePool.balances(0).then((e) => e.add(1e7)),
            await ctx.curvePool.balances(1).then((e) => e.add(2e7)),
          ]
          if (!isMetapool && ctx.poolTokens.length > 2) {
            newBalances.push(await ctx.curvePool.balances(2).then((e) => e.add(3e7)))
          }
          await ctx.curvePool.setBalances(newBalances)

          await ctx.collateral.refresh()
          expect(await ctx.collateral.refPerTok()).to.be.gt(initRefPerTok)

          // if it's a metapool, then price may not be hooked up to the mock
          if (!isMetapool) {
            const [newLow, newHigh] = await ctx.collateral.price()
            expect(newLow).to.be.gt(initLow)
            expect(newHigh).to.be.gt(initHigh)
          }
        })

        it('decays for 0-valued oracle', async () => {
          const initialPrice = await ctx.collateral.price()

          // Set price of underlyings to 0
          for (const feed of ctx.feeds) {
            await feed.updateAnswer(0).then((e) => e.wait())
          }

          // Price remains same at first, though IFFY
          await ctx.collateral.refresh()
          await expectExactPrice(ctx.collateral.address, initialPrice)
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)

          // After oracle timeout decay begins
          const decayDelay = (await ctx.collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER
          await advanceToTimestamp((await getLatestBlockTimestamp()) + decayDelay)
          await advanceBlocks(1 + decayDelay / 12)
          await ctx.collateral.refresh()
          await expectDecayedPrice(ctx.collateral.address)

          // After price timeout it becomes unpriced
          const priceTimeout = await ctx.collateral.priceTimeout()
          await advanceToTimestamp((await getLatestBlockTimestamp()) + priceTimeout)
          await advanceBlocks(1 + priceTimeout / 12)
          await expectUnpriced(ctx.collateral.address)

          // When refreshed, sets status to DISABLED
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)
        })

        it('does not revert in case of invalid timestamp', async () => {
          await ctx.feeds[0].setInvalidTimestamp()

          // When refreshed, sets status to IFFY
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        it('handles stale price', async () => {
          await advanceTime(
            ORACLE_TIMEOUT_BUFFER +
              (await ctx.collateral.maxOracleTimeout()) +
              (await ctx.collateral.priceTimeout())
          )

          // (0, FIX_MAX) is returned
          await expectUnpriced(ctx.collateral.address)

          // Refresh should mark status IFFY
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        it('decays price over priceTimeout period', async () => {
          const savedLow = await ctx.collateral.savedLowPrice()
          const savedHigh = await ctx.collateral.savedHighPrice()
          // Price should start out at saved prices
          await ctx.collateral.refresh()
          let p = await ctx.collateral.price()
          expect(p[0]).to.equal(savedLow)
          expect(p[1]).to.equal(savedHigh)

          await advanceTime((await ctx.collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER)

          // Should be roughly half, after half of priceTimeout
          const priceTimeout = await ctx.collateral.priceTimeout()
          await advanceTime(priceTimeout / 2)
          p = await ctx.collateral.price()
          expect(p[0]).to.be.closeTo(savedLow.div(2), p[0].div(2).div(10000)) // 1 part in 10 thousand
          expect(p[1]).to.be.closeTo(savedHigh.mul(2), p[1].mul(2).div(10000)) // 1 part in 10 thousand

          // Should be 0 after full priceTimeout
          await advanceTime(priceTimeout / 2)
          await expectUnpriced(ctx.collateral.address)
        })

        it('lotPrice (deprecated) is equal to price()', async () => {
          const lotPrice = await ctx.collateral.lotPrice()
          const price = await ctx.collateral.price()
          expect(price.length).to.equal(2)
          expect(lotPrice.length).to.equal(price.length)
          expect(lotPrice[0]).to.equal(price[0])
          expect(lotPrice[1]).to.equal(price[1])
        })
      })

      describe('status', () => {
        it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
          const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
            'InvalidMockV3Aggregator'
          )
          const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
            await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
          )

          const [invalidCollateral] = await deployCollateral({
            erc20: ctx.wrapper.address,
            feeds: defaultOpts.feeds!.map((f) => f.map(() => invalidChainlinkFeed.address)),
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

        it('maintains status in normal situations', async () => {
          // Check initial state
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // Force updates (with no changes)
          await expect(ctx.collateral.refresh()).to.not.emit(
            ctx.collateral,
            'CollateralStatusChanged'
          )
          // State remains the same
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)
        })

        itChecksTargetPerRefDefault(
          'enters IFFY state when reference unit depegs below low threshold',
          async () => {
            const delayUntilDefault = await ctx.collateral.delayUntilDefault()

            // Check initial state
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

            // Depeg first feed - Reducing price by 20% from 1 to 0.8
            const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('8e7'))
            await updateAnswerTx.wait()

            // Check status + whenDefault
            const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
            const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

            await expect(ctx.collateral.refresh())
              .to.emit(ctx.collateral, 'CollateralStatusChanged')
              .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
            expect(await ctx.collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
          }
        )

        itChecksTargetPerRefDefault(
          'enters IFFY state when reference unit depegs above high threshold',
          async () => {
            const delayUntilDefault = await ctx.collateral.delayUntilDefault()

            // Check initial state
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

            // Depeg first feed - Raising price by 20% from 1 to 1.2
            const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('1.2e8'))
            await updateAnswerTx.wait()

            // Check status + whenDefault
            const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
            const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

            await expect(ctx.collateral.refresh())
              .to.emit(ctx.collateral, 'CollateralStatusChanged')
              .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
            expect(await ctx.collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
          }
        )

        itChecksTargetPerRefDefault(
          'enters DISABLED state when reference unit depegs for too long',
          async () => {
            const delayUntilDefault = await ctx.collateral.delayUntilDefault()

            // Check initial state
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

            // Depeg first feed - Reducing price by 20% from 1 to 0.8
            const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('8e7'))
            await updateAnswerTx.wait()

            // Check status + whenDefault
            await ctx.collateral.refresh()
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)

            // Move time forward past delayUntilDefault
            await advanceTime(delayUntilDefault)
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)

            // Nothing changes if attempt to refresh after default
            const prevWhenDefault: bigint = (await ctx.collateral.whenDefault()).toBigInt()
            await expect(ctx.collateral.refresh()).to.not.emit(
              ctx.collateral,
              'CollateralStatusChanged'
            )
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)
            expect(await ctx.collateral.whenDefault()).to.equal(prevWhenDefault)
          }
        )

        it('enters DISABLED state when refPerTok() decreases', async () => {
          // Check initial state
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          await mintCollateralTo(ctx, amt, ctx.alice, ctx.alice.address)

          await expect(ctx.collateral.refresh()).to.not.emit(
            ctx.collateral,
            'CollateralStatusChanged'
          )
          // State remains the same
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          const currentExchangeRate = await ctx.curvePool.get_virtual_price()
          await ctx.curvePool.setVirtualPrice(currentExchangeRate.sub(1e7)).then((e) => e.wait())

          // Collateral defaults due to refPerTok() going down
          await expect(ctx.collateral.refresh()).to.emit(ctx.collateral, 'CollateralStatusChanged')
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)
          expect(await ctx.collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
        })

        it('enters IFFY state when price becomes stale', async () => {
          const decayDelay = (await ctx.collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER
          await advanceToTimestamp((await getLatestBlockTimestamp()) + decayDelay)
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        it('does revenue hiding correctly', async () => {
          ctx = await loadFixture(
            makeCollateralFixtureContext(ctx.alice, { revenueHiding: fp('1e-6') })
          )

          // Check initial state
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)
          await mintCollateralTo(ctx, amt, ctx.alice, ctx.alice.address)
          await expect(ctx.collateral.refresh()).to.not.emit(
            ctx.collateral,
            'CollateralStatusChanged'
          )

          // State remains the same
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // Decrease refPerTok by 1 part in a million
          const refPerTok = await ctx.collateral.refPerTok()
          const currentExchangeRate = await ctx.curvePool.get_virtual_price()
          const newVirtualPrice = currentExchangeRate.sub(currentExchangeRate.div(bn('1e6'))).add(2)
          await ctx.curvePool.setVirtualPrice(newVirtualPrice)

          // Collateral remains SOUND
          await expect(ctx.collateral.refresh()).to.not.emit(
            ctx.collateral,
            'CollateralStatusChanged'
          )
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // Few more quanta of decrease results in default
          await ctx.curvePool.setVirtualPrice(newVirtualPrice.sub(4)) // sub 4 to compensate for rounding
          await expect(ctx.collateral.refresh()).to.emit(ctx.collateral, 'CollateralStatusChanged')
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)
          expect(await ctx.collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())

          // refPerTok should have fallen
          expect(await ctx.collateral.refPerTok()).to.be.closeTo(refPerTok.sub(2), 1)
        })

        describe('collateral-specific tests', collateralSpecificStatusTests)
      })

      describeGas('Gas Reporting', () => {
        if (IMPLEMENTATION != Implementation.P1 || !useEnv('REPORT_GAS')) return // hide pending

        context('refresh()', () => {
          beforeEach(async () => {
            await ctx.collateral.refresh()
            expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          })

          afterEach(async () => {
            await snapshotGasCost(ctx.collateral.refresh())
            await snapshotGasCost(ctx.collateral.refresh()) // 2nd refresh can be different than 1st
          })

          it('during SOUND', async () => {
            // pass
          })

          it('during soft default', async () => {
            // Depeg first feed - Reducing price by 20% from 1 to 0.8
            const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('8e7'))
            await updateAnswerTx.wait()
          })

          it('after soft default', async () => {
            // Depeg first feed - Reducing price by 20% from 1 to 0.8
            const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('8e7'))
            await updateAnswerTx.wait()
            await expect(ctx.collateral.refresh())
              .to.emit(ctx.collateral, 'CollateralStatusChanged')
              .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            await advanceTime(await ctx.collateral.delayUntilDefault())
          })

          it('after oracle timeout', async () => {
            const oracleTimeout = (await ctx.collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER
            await advanceToTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
            await advanceBlocks(oracleTimeout / 12)
          })

          it('after full price timeout', async () => {
            await advanceTime(
              ORACLE_TIMEOUT_BUFFER +
                (await ctx.collateral.priceTimeout()) +
                (await ctx.collateral.maxOracleTimeout())
            )
            const p = await ctx.collateral.price()
            expect(p[0]).to.equal(0)
            expect(p[1]).to.equal(MAX_UINT192)
          })

          it('after hard default', async () => {
            const currentExchangeRate = await ctx.curvePool.get_virtual_price()
            await ctx.curvePool.setVirtualPrice(currentExchangeRate.sub(1e3)).then((e) => e.wait())
          })
        })

        context('ERC20 Wrapper', () => {
          it('transfer', async () => {
            await mintCollateralTo(ctx, bn('2'), ctx.alice, ctx.alice.address)
            await snapshotGasCost(
              ctx.wrapper.connect(ctx.alice).transfer(ctx.collateral.address, bn('1'))
            )
            await snapshotGasCost(
              ctx.wrapper.connect(ctx.alice).transfer(ctx.collateral.address, bn('1'))
            )
          })
        })
      })
    })

    // Only run full protocol integration tests on mainnet
    // Protocol integration fixture not currently set up to deploy onto base
    getDescribeFork(targetNetwork)('integration tests', () => {
      const onBase = useEnv('FORK_NETWORK').toLowerCase() == 'base'
      const onArbitrum = useEnv('FORK_NETWORK').toLowerCase() == 'arbitrum'

      before(resetFork)

      let ctx: X
      let owner: SignerWithAddress
      let addr1: SignerWithAddress

      let chainId: number

      let defaultFixture: Fixture<DefaultFixture>

      let supply: BigNumber

      // Tokens/Assets
      let pairedColl: TestICollateral
      let pairedERC20: ERC20Mock
      let collateralERC20: IERC20Metadata
      let collateral: TestICollateral

      // Core Contracts
      let main: TestIMain
      let rToken: TestIRToken
      let assetRegistry: IAssetRegistry
      let backingManager: TestIBackingManager
      let basketHandler: TestIBasketHandler
      let rsrTrader: TestIRevenueTrader
      let rsr: ERC20Mock

      let deployer: TestIDeployer
      let facadeWrite: FacadeWrite
      let govParams: IGovParams
      let govRoles: IGovRoles

      const config = {
        dist: {
          rTokenDist: bn(0), // 0% RToken
          rsrDist: bn(10000), // 100% RSR
        },
        minTradeVolume: bn('0'), // $0
        rTokenMaxTradeVolume: MAX_UINT192, // +inf
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
        rewardRatio: bn('89139297916'), // per second. approx half life of 90 days
        unstakingDelay: bn('1209600'), // 2 weeks
        withdrawalLeak: fp('0'), // 0%; always refresh
        warmupPeriod: bn('60'), // (the delay _after_ SOUND was regained)
        tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
        batchAuctionLength: bn('900'), // 15 minutes
        dutchAuctionLength: bn('1800'), // 30 minutes
        backingBuffer: fp('0'), // 0%
        maxTradeSlippage: fp('0.01'), // 1%
        issuanceThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
        redemptionThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
        reweightable: false,
      }

      interface IntegrationFixture {
        ctx: X
        protocol: DefaultFixture
      }

      const integrationFixture: Fixture<IntegrationFixture> =
        async function (): Promise<IntegrationFixture> {
          return {
            ctx: await loadFixture(
              makeCollateralFixtureContext(owner, { maxTradeVolume: MAX_UINT192 })
            ),
            protocol: await loadFixture(defaultFixture),
          }
        }

      before(async () => {
        defaultFixture = await getDefaultFixture(collateralName)
        chainId = await getChainId(hre)
        if (!networkConfig[chainId]) {
          throw new Error(`Missing network configuration for ${hre.network.name}`)
        }
        ;[, owner, addr1] = await ethers.getSigners()
      })

      beforeEach(async () => {
        let protocol: DefaultFixture
        ;({ ctx, protocol } = await loadFixture(integrationFixture))
        ;({ collateral } = ctx)
        ;({ deployer, facadeWrite, govParams, rsr } = protocol)

        supply = fp('1')

        // Create a paired collateral of the same targetName
        pairedColl = await makePairedCollateral(await collateral.targetName())
        await pairedColl.refresh()
        expect(await pairedColl.status()).to.equal(CollateralStatus.SOUND)
        pairedERC20 = await ethers.getContractAt('ERC20Mock', await pairedColl.erc20())

        // Prep collateral
        collateralERC20 = await ethers.getContractAt('IERC20Metadata', await collateral.erc20())
        await mintCollateralTo(
          ctx,
          toBNDecimals(fp('1'), await collateralERC20.decimals()),
          addr1,
          addr1.address
        )

        // Set primary basket
        const rTokenSetup: IRTokenSetup = {
          assets: [],
          primaryBasket: [collateral.address, pairedColl.address],
          weights: [fp('0.5e-4'), fp('0.5e-4')],
          backups: [],
          beneficiaries: [],
        }

        // Deploy RToken via FacadeWrite
        const receipt = await (
          await facadeWrite.connect(owner).deployRToken(
            {
              name: 'RTKN RToken',
              symbol: 'RTKN',
              mandate: 'mandate',
              params: config,
            },
            rTokenSetup
          )
        ).wait()

        // Get Main
        const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
          .main
        main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

        // Get core contracts
        assetRegistry = <IAssetRegistry>(
          await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
        )
        backingManager = <TestIBackingManager>(
          await ethers.getContractAt('TestIBackingManager', await main.backingManager())
        )
        basketHandler = <TestIBasketHandler>(
          await ethers.getContractAt('TestIBasketHandler', await main.basketHandler())
        )
        rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
        rsrTrader = <TestIRevenueTrader>(
          await ethers.getContractAt('TestIRevenueTrader', await main.rsrTrader())
        )

        // Set initial governance roles
        govRoles = {
          owner: owner.address,
          guardian: ZERO_ADDRESS,
          pausers: [],
          shortFreezers: [],
          longFreezers: [],
        }
        // Setup owner and unpause
        await facadeWrite.connect(owner).setupGovernance(
          rToken.address,
          false, // do not deploy governance
          true, // unpaused
          govParams, // mock values, not relevant
          govRoles
        )

        // Advance past warmup period
        await advanceToTimestamp(
          (await getLatestBlockTimestamp()) + (await basketHandler.warmupPeriod())
        )

        // Should issue
        await collateralERC20.connect(addr1).approve(rToken.address, MAX_UINT256)
        await pairedERC20.connect(addr1).approve(rToken.address, MAX_UINT256)
        await rToken.connect(addr1).issue(supply)
      })

      it('can be put into an RToken basket', async () => {
        await assetRegistry.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      })

      it('issues', async () => {
        // Issuance in beforeEach
        expect(await rToken.totalSupply()).to.equal(supply)
      })

      it('redeems', async () => {
        await rToken.connect(addr1).redeem(supply)
        expect(await rToken.totalSupply()).to.equal(0)
        const initialCollBal = toBNDecimals(fp('1'), await collateralERC20.decimals())
        expect(await collateralERC20.balanceOf(addr1.address)).to.be.closeTo(
          initialCollBal,
          initialCollBal.div(bn('1e5')) // 1-part-in-100k
        )
      })

      it('rebalances out of the collateral', async () => {
        const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
        await pairedERC20.connect(addr1).approve(router.address, MAX_UINT256)
        // Remove collateral from basket
        await basketHandler.connect(owner).setPrimeBasket([pairedERC20.address], [fp('1e-4')])
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(anyValue, [pairedERC20.address], [fp('1e-4')], false)
        await advanceToTimestamp((await getLatestBlockTimestamp()) + config.warmupPeriod.toNumber())

        // Run rebalancing auction
        await expect(backingManager.rebalance(TradeKind.DUTCH_AUCTION))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(anyValue, collateralERC20.address, pairedERC20.address, anyValue, anyValue)
        const tradeAddr = await backingManager.trades(collateralERC20.address)
        expect(tradeAddr).to.not.equal(ZERO_ADDRESS)
        const trade = await ethers.getContractAt('DutchTrade', tradeAddr)

        expect(await trade.sell()).to.equal(collateralERC20.address)
        expect(await trade.buy()).to.equal(pairedERC20.address)
        const buyAmt = await trade.bidAmount(await trade.endTime())
        await pairedERC20.connect(addr1).approve(trade.address, buyAmt)
        await advanceToTimestamp((await trade.endTime()) - 1)
        const pairedBal = await pairedERC20.balanceOf(backingManager.address)
        await expect(router.connect(addr1).bid(trade.address, addr1.address)).to.emit(
          backingManager,
          'TradeSettled'
        )
        expect(await pairedERC20.balanceOf(backingManager.address)).to.be.gt(pairedBal)
        expect(await backingManager.tradesOpen()).to.equal(0)
      })

      it('forwards revenue and sells in a revenue auction', async () => {
        const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
        await rsr.connect(addr1).approve(router.address, MAX_UINT256)
        // Send excess collateral to the RToken trader via forwardRevenue()
        const mintAmt = toBNDecimals(fp('1e-6'), await collateralERC20.decimals())
        await mintCollateralTo(
          ctx,
          mintAmt.gt('10000') ? mintAmt : bn('10000'),
          addr1,
          backingManager.address
        )
        await backingManager.forwardRevenue([collateralERC20.address])
        expect(await collateralERC20.balanceOf(rsrTrader.address)).to.be.gt(0)

        // Run revenue auction
        await expect(rsrTrader.manageTokens([collateralERC20.address], [TradeKind.DUTCH_AUCTION]))
          .to.emit(rsrTrader, 'TradeStarted')
          .withArgs(anyValue, collateralERC20.address, rsr.address, anyValue, anyValue)
        const tradeAddr = await rsrTrader.trades(collateralERC20.address)
        expect(tradeAddr).to.not.equal(ZERO_ADDRESS)
        const trade = await ethers.getContractAt('DutchTrade', tradeAddr)

        expect(await trade.sell()).to.equal(collateralERC20.address)
        expect(await trade.buy()).to.equal(rsr.address)
        const buyAmt = await trade.bidAmount(await trade.endTime())

        // The base whale below is hyUSDStRSR. This is bad, and generally we don't want to do this. But there
        // are no RSR holders on Base in size that hold their balance consistently across blocks, since
        // everyone is farming. Since the individual tests each have their own block they use,
        // this was the easiest way to make everything work. I'm not worried about this in this case
        // because hyUSDStRSR is _not_ the RToken we are testing here, so it should have no impact.
        const whale = onBase
          ? '0x796d2367AF69deB3319B8E10712b8B65957371c3'
          : onArbitrum
          ? '0xBe81e75C579b090428CC5495540541231FD3c0bD'
          : '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'
        await whileImpersonating(whale, async (signer) => {
          await rsr.connect(signer).transfer(addr1.address, buyAmt)
        })
        await advanceToTimestamp((await trade.endTime()) - 1)

        await expect(router.connect(addr1).bid(trade.address, addr1.address)).to.emit(
          rsrTrader,
          'TradeSettled'
        )
        expect(await rsrTrader.tradesOpen()).to.equal(0)
      })

      // === Integration Test Helpers ===

      const makePairedCollateral = async (target: string): Promise<TestICollateral> => {
        const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
          'MockV3Aggregator'
        )
        const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
          await MockV3AggregatorFactory.deploy(8, bn('1e8'))
        )

        let chainId = await getChainId(hre)
        if (onBase) chainId = 8453
        if (onArbitrum) chainId = 42161

        if (target == ethers.utils.formatBytes32String('USD')) {
          // USD
          const erc20 = await ethers.getContractAt(
            'IERC20Metadata',
            networkConfig[chainId].tokens.USDC!
          )

          const usdcHolder = onArbitrum
            ? '0x47c031236e19d024b42f8ae6780e44a573170703'
            : '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf'
          await whileImpersonating(usdcHolder, async (signer) => {
            await erc20
              .connect(signer)
              .transfer(addr1.address, await erc20.balanceOf(signer.address))
          })
          const FiatCollateralFactory: ContractFactory = await ethers.getContractFactory(
            'FiatCollateral'
          )
          return <TestICollateral>await FiatCollateralFactory.deploy({
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: chainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: erc20.address,
            maxTradeVolume: MAX_UINT192,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold: fp('0.01'), // 1%
            delayUntilDefault: bn('86400'), // 24h,
          })
        } else if (target == ethers.utils.formatBytes32String('ETH')) {
          // ETH
          const erc20 = await ethers.getContractAt(
            'IERC20Metadata',
            networkConfig[chainId].tokens.WETH!
          )
          const wethHolder = onArbitrum
            ? '0x70d95587d40a2caf56bd97485ab3eec10bee6336'
            : '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'
          await whileImpersonating(wethHolder, async (signer) => {
            await erc20
              .connect(signer)
              .transfer(addr1.address, await erc20.balanceOf(signer.address))
          })
          const SelfReferentialFactory: ContractFactory = await ethers.getContractFactory(
            'SelfReferentialCollateral'
          )
          return <TestICollateral>await SelfReferentialFactory.deploy({
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: chainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: erc20.address,
            maxTradeVolume: MAX_UINT192,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('ETH'),
            defaultThreshold: fp('0'), // 0%
            delayUntilDefault: bn('0'), // 0,
          })
        } else if (target == ethers.utils.formatBytes32String('BTC')) {
          // BTC
          const targetUnitOracle: MockV3Aggregator = <MockV3Aggregator>(
            await MockV3AggregatorFactory.deploy(8, bn('1e8'))
          )
          const erc20 = await ethers.getContractAt(
            'IERC20Metadata',
            networkConfig[chainId].tokens.WBTC!
          )
          const wbtcHolder = onArbitrum
            ? '0x47c031236e19d024b42f8ae6780e44a573170703'
            : '0xccf4429db6322d5c611ee964527d42e5d685dd6a'

          await whileImpersonating(wbtcHolder, async (signer) => {
            await erc20
              .connect(signer)
              .transfer(addr1.address, await erc20.balanceOf(signer.address))
          })
          const NonFiatFactory: ContractFactory = await ethers.getContractFactory(
            'NonFiatCollateral'
          )
          return <TestICollateral>await NonFiatFactory.deploy(
            {
              priceTimeout: PRICE_TIMEOUT,
              chainlinkFeed: chainlinkFeed.address,
              oracleError: ORACLE_ERROR,
              erc20: erc20.address,
              maxTradeVolume: MAX_UINT192,
              oracleTimeout: ORACLE_TIMEOUT,
              targetName: ethers.utils.formatBytes32String('BTC'),
              defaultThreshold: fp('0.01'), // 1%
              delayUntilDefault: bn('86400'), // 24h,
            },
            targetUnitOracle.address,
            ORACLE_TIMEOUT
          )
        } else {
          throw new Error(`Unknown target: ${target}`)
        }
      }
    })
  })
}

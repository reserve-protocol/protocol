import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  CurveCollateralTestSuiteFixtures,
} from './pluginTestTypes'
import { CollateralStatus } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { ERC20Mock, InvalidMockV3Aggregator } from '../../../../typechain'

import { bn, fp } from '../../../../common/numbers'
import { MAX_UINT48, ZERO_ADDRESS, ONE_ADDRESS } from '../../../../common/constants'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { useEnv } from '#/utils/env'
import {
  advanceBlocks,
  advanceTime,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '#/test/utils/time'

const describeFork = useEnv('FORK') ? describe : describe.skip

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
  } = fixtures

  describeFork(`Collateral: ${collateralName}`, () => {
    let defaultOpts: CurveCollateralOpts
    let mockERC20: ERC20Mock

    before(async () => {
      ;[, defaultOpts] = await deployCollateral({})
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

      it('does not allow more than 2 price feeds', async () => {
        await expect(
          deployCollateral({
            erc20: mockERC20.address, // can be anything.
            feeds: [[ONE_ADDRESS, ONE_ADDRESS, ONE_ADDRESS], [], []],
          })
        ).to.be.revertedWith('price feeds limited to 2')
      })

      it('requires at least 1 price feed per token', async () => {
        await expect(
          deployCollateral({
            erc20: mockERC20.address, // can be anything.
            feeds: [[ONE_ADDRESS, ONE_ADDRESS], [ONE_ADDRESS], []],
          })
        ).to.be.revertedWith('each token needs at least 1 price feed')
      })

      it('requires non-zero-address feeds', async () => {
        for (let i = 0; i < defaultOpts.feeds!.length; i++) {
          for (let j = 0; j < defaultOpts.feeds![i].length; j++) {
            const feeds = defaultOpts.feeds!.map((f) => f.map(() => ONE_ADDRESS))
            feeds[i][j] = ZERO_ADDRESS
            await expect(
              deployCollateral({
                erc20: mockERC20.address, // can be anything.
                feeds,
              })
            ).to.be.revertedWith(`t${i}feed${j} empty`)
          }
        }
      })

      it('requires non-zero oracleTimeouts', async () => {
        for (let i = 0; i < defaultOpts.feeds!.length; i++) {
          for (let j = 0; j < defaultOpts.feeds![i].length; j++) {
            const oracleTimeouts = defaultOpts.feeds!.map((f) => f.map(() => bn('1')))
            oracleTimeouts[i][j] = bn('0')
            await expect(
              deployCollateral({
                erc20: mockERC20.address, // can be anything.
                oracleTimeouts,
              })
            ).to.be.revertedWith(`t${i}timeout${j} zero`)
          }
        }
      })

      it('requires non-zero oracleErrors', async () => {
        const nonzeroError = fp('0.01') // 1%
        for (let i = 0; i < defaultOpts.feeds!.length; i++) {
          for (let j = 0; j < defaultOpts.feeds![i].length; j++) {
            const oracleErrors = defaultOpts.feeds!.map((f) => f.map(() => nonzeroError))
            oracleErrors[i][j] = fp('1')
            await expect(
              deployCollateral({
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
      before(resetFork)

      let ctx: CurveCollateralFixtureContext

      beforeEach(async () => {
        const [alice] = await ethers.getSigners()
        ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
      })

      describe('functions', () => {
        it('returns the correct bal (18 decimals)', async () => {
          const amount = bn('20000').mul(bn(10).pow(await ctx.wrapper.decimals()))
          await mintCollateralTo(ctx, amount, ctx.alice, ctx.alice.address)

          const aliceBal = await ctx.collateral.bal(ctx.alice.address)
          expect(aliceBal).to.closeTo(
            amount.mul(bn(10).pow(18 - (await ctx.wrapper.decimals()))),
            bn('100').mul(bn(10).pow(18 - (await ctx.wrapper.decimals())))
          )
        })
      })

      describe('rewards', () => {
        it('does not revert', async () => {
          await expect(ctx.collateral.claimRewards()).to.not.be.reverted
        })

        it('claims rewards (plugin)', async () => {
          const amount = bn('20000').mul(bn(10).pow(await ctx.wrapper.decimals()))
          await mintCollateralTo(ctx, amount, ctx.alice, ctx.collateral.address)

          await advanceBlocks(1000)
          await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)

          const before = await Promise.all(
            ctx.rewardTokens.map((t) => t.balanceOf(ctx.wrapper.address))
          )
          await expect(ctx.wrapper.claimRewards()).to.emit(ctx.wrapper, 'RewardsClaimed')
          const after = await Promise.all(
            ctx.rewardTokens.map((t) => t.balanceOf(ctx.wrapper.address))
          )

          // Each reward token should have grew
          for (let i = 0; i < ctx.rewardTokens.length; i++) {
            expect(after[i]).gt(before[i])
          }
        })

        it('claims rewards (wrapper)', async () => {
          const amount = bn('20000').mul(bn(10).pow(await ctx.wrapper.decimals()))
          await mintCollateralTo(ctx, amount, ctx.alice, ctx.alice.address)

          await advanceBlocks(1000)
          await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)

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
        before(resetFork)
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
          await ctx.collateral.refresh()
          expect(await ctx.collateral.refPerTok()).to.equal(curveVirtualPrice)

          await ctx.curvePool.setVirtualPrice(curveVirtualPrice.add(1e4))

          const newBalances = [
            await ctx.curvePool.balances(0).then((e) => e.add(1e4)),
            await ctx.curvePool.balances(1).then((e) => e.add(2e4)),
          ]
          if (!isMetapool) {
            newBalances.push(await ctx.curvePool.balances(2).then((e) => e.add(3e4)))
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

        it('returns a 0 price', async () => {
          for (const feed of ctx.feeds) {
            await feed.updateAnswer(0).then((e) => e.wait())
          }

          // (0, 0) is returned
          const [low, high] = await ctx.collateral.price()
          expect(low).to.equal(0)
          expect(high).to.equal(0)

          // When refreshed, sets status to Unpriced
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        it('does not revert in case of invalid timestamp', async () => {
          await ctx.feeds[0].setInvalidTimestamp()

          // When refreshed, sets status to Unpriced
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        it('decays lotPrice over priceTimeout period', async () => {
          // Prices should start out equal
          const p = await ctx.collateral.price()
          let lotP = await ctx.collateral.lotPrice()
          expect(p.length).to.equal(lotP.length)
          expect(p[0]).to.equal(lotP[0])
          expect(p[1]).to.equal(lotP[1])

          // Should be roughly half, after half of priceTimeout
          const priceTimeout = await ctx.collateral.priceTimeout()
          await advanceTime(priceTimeout / 2)
          lotP = await ctx.collateral.lotPrice()
          expect(lotP[0]).to.be.closeTo(p[0].div(2), p[0].div(2).div(10000)) // 1 part in 10 thousand
          expect(lotP[1]).to.be.closeTo(p[1].div(2), p[1].div(2).div(10000)) // 1 part in 10 thousand

          // Should be 0 after full priceTimeout
          await advanceTime(priceTimeout / 2)
          lotP = await ctx.collateral.lotPrice()
          expect(lotP[0]).to.equal(0)
          expect(lotP[1]).to.equal(0)
        })
      })

      describe('status', () => {
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

        it('enters IFFY state when reference unit depegs below low threshold', async () => {
          const delayUntilDefault = await ctx.collateral.delayUntilDefault()

          // Check initial state
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // Depeg first feed - Reducing price by 20% from 1 to 0.8
          const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('8e7'))
          await updateAnswerTx.wait()

          // Set next block timestamp - for deterministic result
          const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
          await setNextBlockTimestamp(nextBlockTimestamp)
          const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

          await expect(ctx.collateral.refresh())
            .to.emit(ctx.collateral, 'CollateralStatusChanged')
            .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
          expect(await ctx.collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
        })

        it('enters IFFY state when reference unit depegs above high threshold', async () => {
          const delayUntilDefault = await ctx.collateral.delayUntilDefault()

          // Check initial state
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // Depeg first feed - Raising price by 20% from 1 to 1.2
          const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('1.2e8'))
          await updateAnswerTx.wait()

          // Set next block timestamp - for deterministic result
          const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
          await setNextBlockTimestamp(nextBlockTimestamp)
          const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

          await expect(ctx.collateral.refresh())
            .to.emit(ctx.collateral, 'CollateralStatusChanged')
            .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.IFFY)
          expect(await ctx.collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
        })

        it('enters DISABLED state when reference unit depegs for too long', async () => {
          const delayUntilDefault = await ctx.collateral.delayUntilDefault()

          // Check initial state
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // Depeg first feed - Reducing price by 20% from 1 to 0.8
          const updateAnswerTx = await ctx.feeds[0].updateAnswer(bn('8e7'))
          await updateAnswerTx.wait()

          // Set next block timestamp - for deterministic result
          const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
          await setNextBlockTimestamp(nextBlockTimestamp)
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
        })

        it('enters DISABLED state when refPerTok() decreases', async () => {
          // Check initial state
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          await mintCollateralTo(ctx, bn('20000e6'), ctx.alice, ctx.alice.address)

          await expect(ctx.collateral.refresh()).to.not.emit(
            ctx.collateral,
            'CollateralStatusChanged'
          )
          // State remains the same
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          const currentExchangeRate = await ctx.curvePool.get_virtual_price()
          await ctx.curvePool.setVirtualPrice(currentExchangeRate.sub(1e3)).then((e) => e.wait())

          // Collateral defaults due to refPerTok() going down
          await expect(ctx.collateral.refresh()).to.emit(ctx.collateral, 'CollateralStatusChanged')
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)
          expect(await ctx.collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
        })

        it('enters IFFY state when price becomes stale', async () => {
          const oracleTimeout = bn(defaultOpts.oracleTimeouts![0][0])
          await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout.toNumber())
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
          await mintCollateralTo(ctx, bn('20000e6'), ctx.alice, ctx.alice.address)
          await expect(ctx.collateral.refresh()).to.not.emit(
            ctx.collateral,
            'CollateralStatusChanged'
          )

          // State remains the same
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // Decrease refPerTok by 1 part in a million
          const currentExchangeRate = await ctx.curvePool.get_virtual_price()
          const newVirtualPrice = currentExchangeRate.sub(currentExchangeRate.div(bn('1e6')))
          await ctx.curvePool.setVirtualPrice(newVirtualPrice)

          // Collateral remains SOUND
          await expect(ctx.collateral.refresh()).to.not.emit(
            ctx.collateral,
            'CollateralStatusChanged'
          )
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctx.collateral.whenDefault()).to.equal(MAX_UINT48)

          // One quanta more of decrease results in default
          await ctx.curvePool.setVirtualPrice(newVirtualPrice.sub(2)) // sub 2 to compenstate for rounding
          await expect(ctx.collateral.refresh()).to.emit(ctx.collateral, 'CollateralStatusChanged')
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)
          expect(await ctx.collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
        })

        it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
          const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
            'InvalidMockV3Aggregator'
          )
          const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
            await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
          )

          ctx = await loadFixture(makeCollateralFixtureContext(ctx.alice, {}))
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

        describe('collateral-specific tests', collateralSpecificStatusTests)
      })
    })
  })
}
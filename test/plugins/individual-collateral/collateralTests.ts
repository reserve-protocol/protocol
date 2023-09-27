import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'
import { useEnv } from '#/utils/env'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import {
  IERC20Metadata,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  TestICollateral,
} from '../../../typechain'
import {
  advanceTime,
  advanceBlocks,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '../../utils/time'
import { MAX_UINT48, MAX_UINT192 } from '../../../common/constants'
import {
  CollateralFixtureContext,
  CollateralTestSuiteFixtures,
  CollateralStatus,
} from './pluginTestTypes'
import { expectPrice, expectUnpriced } from '../../utils/oracles'
import snapshotGasCost from '../../utils/snapshotGasCost'
import { IMPLEMENTATION, Implementation } from '../../fixtures'

// const describeFork = useEnv('FORK') ? describe : describe.skip
const getDescribeFork = (targetNetwork = 'mainnet') => {
  return useEnv('FORK') && useEnv('FORK_NETWORK') === targetNetwork ? describe : describe.skip
}

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

export default function fn<X extends CollateralFixtureContext>(
  fixtures: CollateralTestSuiteFixtures<X>
) {
  const {
    deployCollateral,
    collateralSpecificConstructorTests,
    collateralSpecificStatusTests,
    beforeEachRewardsTest,
    makeCollateralFixtureContext,
    mintCollateralTo,
    reduceTargetPerRef,
    increaseTargetPerRef,
    reduceRefPerTok,
    increaseRefPerTok,
    getExpectedPrice,
    itClaimsRewards,
    itChecksTargetPerRefDefault,
    itChecksRefPerTokDefault,
    itChecksPriceChanges,
    itHasRevenueHiding,
    itIsPricedByPeg,
    resetFork,
    collateralName,
    chainlinkDefaultAnswer,
    toleranceDivisor,
    targetNetwork,
  } = fixtures

  getDescribeFork(targetNetwork)(`Collateral: ${collateralName}`, () => {
    before(resetFork)

    describe('constructor validation', () => {
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

      describe('collateral-specific tests', collateralSpecificConstructorTests)
    })

    describe('collateral functionality', () => {
      let ctx: X
      let alice: SignerWithAddress

      let chainId: number

      let collateral: TestICollateral
      let chainlinkFeed: MockV3Aggregator

      before(async () => {
        chainId = await getChainId(hre)
        if (!networkConfig[chainId]) {
          throw new Error(`Missing network configuration for ${hre.network.name}`)
        }
      })

      beforeEach(async () => {
        ;[, alice] = await ethers.getSigners()
        ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
        ;({ chainlinkFeed, collateral } = ctx)
      })

      describe('functions', () => {
        it('returns the correct bal (18 decimals)', async () => {
          const decimals = await ctx.tok.decimals()
          const amount = bn('20').mul(bn(10).pow(decimals))
          await mintCollateralTo(ctx, amount, alice, alice.address)

          const aliceBal = await collateral.bal(alice.address)
          const amount18d =
            decimals <= 18
              ? amount.mul(bn(10).pow(18 - decimals))
              : amount.div(bn(10).pow(decimals - 18))
          const dist18d = decimals <= 18 ? bn('100').mul(bn(10).pow(18 - decimals)) : bn('10')
          expect(aliceBal).to.closeTo(amount18d, dist18d)
        })
      })

      describe('rewards', () => {
        // TODO: these tests will be deprecated along with the claimRewards()
        // function on collateral plugins (4/18/23)
        beforeEach(async () => {
          await beforeEachRewardsTest(ctx)
        })

        it('does not revert', async () => {
          await collateral.claimRewards()
        })

        itClaimsRewards('claims rewards (via collateral.claimRewards())', async () => {
          const amount = bn('20').mul(bn(10).pow(await ctx.tok.decimals()))
          await mintCollateralTo(ctx, amount, alice, collateral.address)
          await advanceBlocks(1000)
          await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)

          const balBefore = await (ctx.rewardToken as IERC20Metadata).balanceOf(collateral.address)
          await expect(collateral.claimRewards()).to.emit(ctx.tok, 'RewardsClaimed')
          const balAfter = await (ctx.rewardToken as IERC20Metadata).balanceOf(collateral.address)
          expect(balAfter).gt(balBefore)
        })

        itClaimsRewards('claims rewards (via erc20.claimRewards())', async () => {
          const rewardable = await ethers.getContractAt('IRewardable', ctx.tok.address)

          const amount = bn('20').mul(bn(10).pow(await ctx.tok.decimals()))
          await mintCollateralTo(ctx, amount, alice, alice.address)

          await advanceBlocks(1000)
          await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)

          const balBefore = await (ctx.rewardToken as IERC20Metadata).balanceOf(alice.address)
          await expect(rewardable.connect(alice).claimRewards()).to.emit(ctx.tok, 'RewardsClaimed')
          const balAfter = await (ctx.rewardToken as IERC20Metadata).balanceOf(alice.address)
          expect(balAfter).gt(balBefore)
        })
      })

      describe('prices', () => {
        before(resetFork) // important for getting prices/refPerToks to behave predictably

        itChecksPriceChanges('prices change as USD feed price changes', async () => {
          const oracleError = await collateral.oracleError()
          const expectedPrice = await getExpectedPrice(ctx)
          await expectPrice(collateral.address, expectedPrice, oracleError, true, toleranceDivisor)

          // Update values in Oracles increase by 10-20%
          const newPrice = BigNumber.from(chainlinkDefaultAnswer).mul(11).div(10)
          const updateAnswerTx = await chainlinkFeed.updateAnswer(newPrice)
          await updateAnswerTx.wait()

          // Check new prices
          await collateral.refresh()
          const newExpectedPrice = await getExpectedPrice(ctx)
          expect(newExpectedPrice).to.be.gt(expectedPrice)
          await expectPrice(
            collateral.address,
            newExpectedPrice,
            oracleError,
            true,
            toleranceDivisor
          )
        })

        // all our collateral that have targetPerRef feeds use them only for soft default checks
        itChecksPriceChanges(
          `prices ${itIsPricedByPeg ? '' : 'do not '}change as targetPerRef changes`,
          async () => {
            const oracleError = await collateral.oracleError()
            const expectedPrice = await getExpectedPrice(ctx)
            await expectPrice(
              collateral.address,
              expectedPrice,
              oracleError,
              true,
              toleranceDivisor
            )

            // Get refPerTok initial values
            const initialRefPerTok = await collateral.refPerTok()
            const [oldLow, oldHigh] = await collateral.price()

            // Update values in Oracles increase by 10-20%
            await increaseTargetPerRef(ctx, 20)

            if (itIsPricedByPeg) {
              // Check new prices -- increase expected
              const newPrice = await getExpectedPrice(ctx)
              await expectPrice(collateral.address, newPrice, oracleError, true, toleranceDivisor)
              const [newLow, newHigh] = await collateral.price()
              expect(oldLow).to.be.lt(newLow)
              expect(oldHigh).to.be.lt(newHigh)
            } else {
              // Check new prices -- no increase expected
              await expectPrice(
                collateral.address,
                expectedPrice,
                oracleError,
                true,
                toleranceDivisor
              )
              const [newLow, newHigh] = await collateral.price()
              expect(oldLow).to.equal(newLow)
              expect(oldHigh).to.equal(newHigh)
            }

            // Check refPerTok remains the same (because we have not refreshed)
            const finalRefPerTok = await collateral.refPerTok()
            expect(finalRefPerTok).to.equal(initialRefPerTok)
          }
        )

        itChecksPriceChanges('prices change as refPerTok changes', async () => {
          const initRefPerTok = await collateral.refPerTok()

          const oracleError = await collateral.oracleError()

          const [initLow, initHigh] = await collateral.price()
          const expectedPrice = await getExpectedPrice(ctx)

          await expectPrice(collateral.address, expectedPrice, oracleError, true, toleranceDivisor)

          // need to deposit in order to get an exchange rate
          const amount = bn('200').mul(bn(10).pow(await ctx.tok.decimals()))
          await mintCollateralTo(ctx, amount, alice, alice.address)
          await increaseRefPerTok(ctx, 5)

          await collateral.refresh()
          expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await collateral.refPerTok()).to.be.gt(initRefPerTok)
          const [newLow, newHigh] = await collateral.price()
          expect(newLow).to.be.gt(initLow)
          expect(newHigh).to.be.gt(initHigh)
        })

        it('returns unpriced for 0-valued oracle', async () => {
          // Set price of underlying to 0
          const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
          await updateAnswerTx.wait()

          // (0, FIX_MAX) is returned
          await expectUnpriced(collateral.address)

          // When refreshed, sets status to Unpriced
          await collateral.refresh()
          expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        it('reverts in case of invalid timestamp', async () => {
          await chainlinkFeed.setInvalidTimestamp()

          // Check price of token
          const [low, high] = await collateral.price()
          expect(low).to.equal(0)
          expect(high).to.equal(MAX_UINT192)

          // When refreshed, sets status to Unpriced
          await collateral.refresh()
          expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        itHasRevenueHiding('does revenue hiding correctly', async () => {
          ctx.collateral = await deployCollateral({
            erc20: ctx.tok.address,
            revenueHiding: fp('0.01'),
          })

          // Should remain SOUND after a 1% decrease
          await reduceRefPerTok(ctx, 1) // 1% decrease
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.SOUND)

          // Should become DISABLED if drops more than that
          await reduceRefPerTok(ctx, 1) // another 1% decrease
          await ctx.collateral.refresh()
          expect(await ctx.collateral.status()).to.equal(CollateralStatus.DISABLED)
        })

        it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
          const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
            'InvalidMockV3Aggregator'
          )
          const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
            await InvalidMockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
          )

          const invalidCollateral = await deployCollateral({
            erc20: ctx.tok.address,
            chainlinkFeed: invalidChainlinkFeed.address,
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

        it('enters IFFY state when price becomes stale', async () => {
          const oracleTimeout = await collateral.oracleTimeout()
          await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
          await advanceBlocks(oracleTimeout / 12)
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

          await advanceTime(await collateral.oracleTimeout())

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

        itChecksTargetPerRefDefault(
          'enters IFFY state when target-per-ref depegs below low threshold',
          async () => {
            const delayUntilDefault = await collateral.delayUntilDefault()

            // Check initial state
            expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
            // Depeg - Reducing price by 20%
            await reduceTargetPerRef(ctx, 20)

            // Set next block timestamp - for deterministic result
            const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
            await setNextBlockTimestamp(nextBlockTimestamp)
            const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault
            await expect(collateral.refresh())
              .to.emit(collateral, 'CollateralStatusChanged')
              .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
            expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
          }
        )

        itChecksTargetPerRefDefault(
          'enters IFFY state when target-per-ref depegs above high threshold',
          async () => {
            const delayUntilDefault = await collateral.delayUntilDefault()

            // Check initial state
            expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

            // Depeg - Raising price by 20%
            await increaseTargetPerRef(ctx, 20)

            // Set next block timestamp - for deterministic result
            const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
            await setNextBlockTimestamp(nextBlockTimestamp)
            const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault

            await expect(collateral.refresh())
              .to.emit(collateral, 'CollateralStatusChanged')
              .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
            expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
          }
        )

        itChecksTargetPerRefDefault(
          'enters DISABLED state when target-per-ref depegs for too long',
          async () => {
            const delayUntilDefault = await collateral.delayUntilDefault()

            // Check initial state
            expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

            // Depeg - Reducing price by 20%
            await reduceTargetPerRef(ctx, 20)

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
          }
        )

        itChecksRefPerTokDefault('enters DISABLED state when refPerTok() decreases', async () => {
          // Check initial state
          expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

          await mintCollateralTo(
            ctx,
            bn('200').mul(bn(10).pow(await ctx.tok.decimals())),
            alice,
            alice.address
          )

          await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
          // State remains the same
          expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

          await reduceRefPerTok(ctx, 5)

          // Collateral defaults due to refPerTok() going down
          await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
          expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
          expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
        })
      })

      describe('collateral-specific tests', collateralSpecificStatusTests)

      describeGas('Gas Reporting', () => {
        if (IMPLEMENTATION != Implementation.P1 || !useEnv('REPORT_GAS')) return // hide pending

        context('refresh()', () => {
          beforeEach(async () => {
            await collateral.refresh()
            expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
          })

          afterEach(async () => {
            await snapshotGasCost(collateral.refresh())
            await snapshotGasCost(collateral.refresh()) // 2nd refresh can be different than 1st
          })

          it('during SOUND', async () => {
            // pass
          })

          itChecksTargetPerRefDefault('during soft default', async () => {
            await reduceTargetPerRef(ctx, 20)
          })

          itChecksTargetPerRefDefault('after soft default', async () => {
            await reduceTargetPerRef(ctx, 20)
            await expect(collateral.refresh())
              .to.emit(collateral, 'CollateralStatusChanged')
              .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            await advanceTime(await collateral.delayUntilDefault())
          })

          it('after oracle timeout', async () => {
            const oracleTimeout = await collateral.oracleTimeout()
            await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
            await advanceBlocks(oracleTimeout / 12)
          })

          it('after full price timeout', async () => {
            await advanceTime(
              (await collateral.priceTimeout()) + (await collateral.oracleTimeout())
            )
            const lotP = await collateral.lotPrice()
            expect(lotP[0]).to.equal(0)
            expect(lotP[1]).to.equal(0)
          })

          itChecksRefPerTokDefault('after hard default', async () => {
            await reduceRefPerTok(ctx, 5)
          })
        })
      })
    })
  })
}

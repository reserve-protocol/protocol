import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, ContractFactory } from 'ethers'
import { useEnv } from '#/utils/env'
import { getChainId } from '../../../common/blockchain-utils'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import {
  DefaultFixture,
  Fixture,
  getDefaultFixture,
  ORACLE_TIMEOUT,
  ORACLE_TIMEOUT_BUFFER,
} from './fixtures'
import { expectInIndirectReceipt } from '../../../common/events'
import { whileImpersonating } from '../../utils/impersonation'
import { IGovParams, IGovRoles, IRTokenSetup, networkConfig } from '../../../common/configuration'
import {
  advanceBlocks,
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
} from '../../utils/time'
import {
  MAX_UINT48,
  MAX_UINT192,
  MAX_UINT256,
  TradeKind,
  ZERO_ADDRESS,
} from '../../../common/constants'
import {
  CollateralFixtureContext,
  CollateralTestSuiteFixtures,
  CollateralStatus,
} from './pluginTestTypes'
import {
  expectDecayedPrice,
  expectExactPrice,
  expectPrice,
  expectUnpriced,
} from '../../utils/oracles'
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
} from '../../../typechain'
import snapshotGasCost from '../../utils/snapshotGasCost'
import { IMPLEMENTATION, Implementation, ORACLE_ERROR, PRICE_TIMEOUT } from '../../fixtures'

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
    itChecksTargetPerRefDefaultUp,
    itChecksRefPerTokDefault,
    itChecksPriceChanges,
    itChecksNonZeroDefaultThreshold,
    itHasRevenueHiding,
    itIsPricedByPeg,
    itHasOracleRefPerTok,
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

      itChecksNonZeroDefaultThreshold('does not allow 0 delayUntilDefault', async () => {
        await expect(deployCollateral({ delayUntilDefault: 0 })).to.be.revertedWith(
          'delayUntilDefault zero'
        )
      })

      itChecksNonZeroDefaultThreshold('does not allow 0 defaultThreshold', async () => {
        await expect(deployCollateral({ defaultThreshold: bn('0') })).to.be.revertedWith(
          'defaultThreshold zero'
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
        await resetFork()
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
        beforeEach(async () => {
          await beforeEachRewardsTest(ctx)
        })

        it('does not revert', async () => {
          await collateral.claimRewards()
        })

        itClaimsRewards('claims rewards (via collateral.claimRewards())', async () => {
          const amount = bn('20').mul(bn(10).pow(await ctx.tok.decimals()))
          await mintCollateralTo(ctx, amount, alice, ctx.collateral.address)
          await advanceBlocks(1000)
          await advanceToTimestamp((await getLatestBlockTimestamp()) + 12000)

          const balBefore = await (ctx.rewardToken as IERC20Metadata).balanceOf(
            ctx.collateral.address
          )
          await expect(ctx.collateral.claimRewards()).to.emit(ctx.tok, 'RewardsClaimed')
          const balAfter = await (ctx.rewardToken as IERC20Metadata).balanceOf(
            ctx.collateral.address
          )
          expect(balAfter).gt(balBefore)
        })
      })

      describe('prices', () => {
        it('enters IFFY state when price becomes stale', async () => {
          const decayDelay = (await collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER
          await advanceToTimestamp((await getLatestBlockTimestamp()) + decayDelay)
          await advanceBlocks(decayDelay / 12)
          await collateral.refresh()
          expect(await collateral.status()).to.not.equal(CollateralStatus.SOUND)
          if (!itHasOracleRefPerTok) {
            // if an oracle isn't involved in refPerTok, then it should disable slowly
            expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
          }
        })

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

        it('decays for 0-valued oracle', async () => {
          const initialPrice = await collateral.price()

          // Set price of underlying to 0
          const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
          await updateAnswerTx.wait()

          // Price remains same at first, though IFFY
          await collateral.refresh()
          await expectExactPrice(collateral.address, initialPrice)
          expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

          // After oracle timeout decay begins
          const decayDelay = (await collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER
          await advanceToTimestamp((await getLatestBlockTimestamp()) + decayDelay)
          await advanceBlocks(1 + decayDelay / 12)
          await collateral.refresh()
          await expectDecayedPrice(collateral.address)

          // After price timeout it becomes unpriced
          const priceTimeout = await collateral.priceTimeout()
          await advanceToTimestamp((await getLatestBlockTimestamp()) + priceTimeout)
          await advanceBlocks(1 + priceTimeout / 12)
          await expectUnpriced(collateral.address)

          // When refreshed, sets status to DISABLED
          await collateral.refresh()
          expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        })

        it('does not revert in case of invalid timestamp', async () => {
          await chainlinkFeed.setInvalidTimestamp()

          // When refreshed, sets status to IFFY
          await collateral.refresh()
          expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
        })

        itHasRevenueHiding('does revenue hiding correctly', async () => {
          const tempCtx = await makeCollateralFixtureContext(alice, {
            erc20: ctx.tok.address,
            revenueHiding: fp('0.0101'),
          })()
          // ctx.collateral = await deployCollateral()

          // Should remain SOUND after a 1% decrease
          let refPerTok = await tempCtx.collateral.refPerTok()
          await reduceRefPerTok(tempCtx, 1) // 1% decrease
          await tempCtx.collateral.refresh()
          expect(await tempCtx.collateral.status()).to.equal(CollateralStatus.SOUND)

          // refPerTok should be unchanged
          expect(await tempCtx.collateral.refPerTok()).to.be.closeTo(
            refPerTok,
            refPerTok.div(bn('1e3'))
          ) // within 1-part-in-1-thousand

          // Should become DISABLED if drops more than that
          refPerTok = await tempCtx.collateral.refPerTok()
          await reduceRefPerTok(tempCtx, 1) // another 1% decrease
          await tempCtx.collateral.refresh()
          expect(await tempCtx.collateral.status()).to.equal(CollateralStatus.DISABLED)

          // refPerTok should have fallen 1%
          refPerTok = refPerTok.sub(refPerTok.div(100))
          expect(await tempCtx.collateral.refPerTok()).to.be.closeTo(
            refPerTok,
            refPerTok.div(bn('1e3'))
          ) // within 1-part-in-1-thousand
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

        it('decays price over priceTimeout period', async () => {
          await collateral.refresh()
          const savedLow = await collateral.savedLowPrice()
          const savedHigh = await collateral.savedHighPrice()
          // Price should start out at saved prices
          let p = await collateral.price()
          expect(p[0]).to.equal(savedLow)
          expect(p[1]).to.equal(savedHigh)

          await advanceTime((await collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER)

          // Should be roughly half, after half of priceTimeout
          const priceTimeout = await collateral.priceTimeout()
          await advanceTime(priceTimeout / 2)
          p = await collateral.price()
          expect(p[0]).to.be.closeTo(savedLow.div(2), p[0].div(2).div(10000)) // 1 part in 10 thousand
          expect(p[1]).to.be.closeTo(savedHigh.mul(2), p[1].mul(2).div(10000)) // 1 part in 10 thousand

          // Should be unpriced after full priceTimeout
          await advanceTime(priceTimeout / 2)
          await expectUnpriced(collateral.address)
        })

        it('lotPrice (deprecated) is equal to price()', async () => {
          const lotPrice = await collateral.lotPrice()
          const price = await collateral.price()
          expect(price.length).to.equal(2)
          expect(lotPrice.length).to.equal(price.length)
          expect(lotPrice[0]).to.equal(price[0])
          expect(lotPrice[1]).to.equal(price[1])
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

            // Check status + whenDefault
            const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
            const expectedDefaultTimestamp = nextBlockTimestamp + delayUntilDefault
            await expect(collateral.refresh())
              .to.emit(collateral, 'CollateralStatusChanged')
              .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
            expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)
          }
        )

        itChecksTargetPerRefDefaultUp(
          'enters IFFY state when target-per-ref depegs above high threshold',
          async () => {
            const delayUntilDefault = await collateral.delayUntilDefault()

            // Check initial state
            expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await collateral.whenDefault()).to.equal(MAX_UINT48)

            // Depeg - Raising price by 20%
            await increaseTargetPerRef(ctx, 20)

            // Check status + whenDefault
            const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
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

            // Check status + whenDefault
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
            const oracleTimeout = (await collateral.maxOracleTimeout()) + ORACLE_TIMEOUT_BUFFER
            await advanceToTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
            await advanceBlocks(oracleTimeout / 12)
          })

          it('after full price timeout', async () => {
            await advanceTime(
              ORACLE_TIMEOUT_BUFFER +
                (await collateral.priceTimeout()) +
                (await collateral.maxOracleTimeout())
            )
            const p = await collateral.price()
            expect(p[0]).to.equal(0)
            expect(p[1]).to.equal(MAX_UINT192)
          })

          itChecksRefPerTokDefault('after hard default', async () => {
            await reduceRefPerTok(ctx, 5)
          })
        })

        context('ERC20', () => {
          it('transfer', async () => {
            const decimals = await ctx.tok.decimals()
            const amount = bn('20').mul(bn(10).pow(decimals))
            await mintCollateralTo(ctx, amount, alice, alice.address)
            await snapshotGasCost(ctx.tok.connect(alice).transfer(collateral.address, bn('1e6')))
            await snapshotGasCost(ctx.tok.connect(alice).transfer(collateral.address, bn('1e6')))
          })
        })
      })
    })

    describe('integration tests', () => {
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
        if (useEnv('FORK_NETWORK').toLowerCase() === 'base') chainId = 8453
        if (useEnv('FORK_NETWORK').toLowerCase() === 'arbitrum') chainId = 42161
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
          weights: [fp('0.5e-3'), fp('0.5e-3')],
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
        await basketHandler.connect(owner).setPrimeBasket([pairedERC20.address], [fp('1e-3')])
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(anyValue, [pairedERC20.address], [fp('1e-3')], false)
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
        expect(await collateralERC20.balanceOf(rsrTrader.address)).to.be.eq(0)
        const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
        await rsr.connect(addr1).approve(router.address, MAX_UINT256)
        // Send excess collateral to the RToken trader via forwardRevenue()
        let mintAmt = toBNDecimals(fp('1e-6'), await collateralERC20.decimals())
        mintAmt = mintAmt.gt('100000') ? mintAmt : bn('100000') // fewest tokens distributor will transfer
        await mintCollateralTo(ctx, mintAmt, addr1, backingManager.address)
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

        // Bid
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

        if (target == ethers.utils.formatBytes32String('USD')) {
          // USD
          const erc20 = await ethers.getContractAt(
            'IERC20Metadata',
            onBase ? networkConfig[chainId].tokens.USDbC! : networkConfig[chainId].tokens.USDC!
          )
          const whale = onBase
            ? '0xb4885bc63399bf5518b994c1d0c153334ee579d0'
            : onArbitrum
            ? '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7'
            : '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf'
          await whileImpersonating(whale, async (signer) => {
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
            oracleTimeout: ORACLE_TIMEOUT,
            maxTradeVolume: MAX_UINT192,
            erc20: erc20.address,
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
          const whale = onBase
            ? '0xb4885bc63399bf5518b994c1d0c153334ee579d0'
            : onArbitrum
            ? '0x70d95587d40a2caf56bd97485ab3eec10bee6336'
            : '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'
          await whileImpersonating(whale, async (signer) => {
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
          // No official WBTC on base yet
          if (onBase) throw new Error('no WBTC on base')
          // BTC
          const targetUnitOracle: MockV3Aggregator = <MockV3Aggregator>(
            await MockV3AggregatorFactory.deploy(8, bn('1e8'))
          )
          const erc20 = await ethers.getContractAt(
            'IERC20Metadata',
            networkConfig[chainId].tokens.WBTC!
          )
          const whale = onArbitrum
            ? '0x47c031236e19d024b42f8ae6780e44a573170703'
            : '0xccf4429db6322d5c611ee964527d42e5d685dd6a'
          await whileImpersonating(whale, async (signer) => {
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

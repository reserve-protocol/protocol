import { expect } from 'chai'
import hre, { ethers, waffle } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Wallet } from 'ethers'
import { useEnv } from '#/utils/env'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import {
    InvalidMockV3Aggregator,
    MockV3Aggregator,
    ICollateral,
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
  CollateralStatus
} from './types'

const describeFork = useEnv('FORK') ? describe : describe.skip

const createFixtureLoader = waffle.createFixtureLoader

export default function fn<X extends CollateralFixtureContext>(fixtures: CollateralTestSuiteFixtures<X>) {
    const {
        deployCollateral,
        collateralSpecificConstructorTests,
        collateralSpecificStatusTests,
        makeCollateralFixtureContext,
        mintCollateralTo,
        reduceRefPerTok,
        itClaimsRewards,
        resetFork
    } = fixtures

    before(resetFork)

    describeFork('CTokenV3Collateral', () => {
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
            await expect(deployCollateral({ oracleTimeout: 0 })).to.be.revertedWith(
              'oracleTimeout zero'
            )
          })
      
          it('does not allow missing delayUntilDefault if defaultThreshold > 0', async () => {
            await expect(deployCollateral({ delayUntilDefault: 0 })).to.be.revertedWith(
              'delayUntilDefault zero'
            )
          })
      
          it('does not allow missing rewardERC20', async () => {
            await expect(
              deployCollateral({ rewardERC20: ethers.constants.AddressZero })
            ).to.be.revertedWith('rewardERC20 missing')
          })

          describe('collateral-specific tests', collateralSpecificConstructorTests)
        })

        describe('collateral functionality', () => {
            let ctx: X
            let alice: SignerWithAddress
        
            let wallet: Wallet
            let chainId: number
        
            let collateral: ICollateral
            let chainlinkFeed: MockV3Aggregator
        
            let loadFixture: ReturnType<typeof createFixtureLoader>
        
            before(async () => {
              ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
              loadFixture = createFixtureLoader([wallet])
        
              chainId = await getChainId(hre)
              if (!networkConfig[chainId]) {
                throw new Error(`Missing network configuration for ${hre.network.name}`)
              }
            })
        
            beforeEach(async () => {
              ;[, alice] = await ethers.getSigners()
              ;(ctx = await loadFixture(
                makeCollateralFixtureContext(alice, {})
              ))
              ;({ chainlinkFeed, collateral } = ctx)
            })
        
            describe('functions', () => {
              // unskip once rewards are turned on
              itClaimsRewards('claims rewards', async () => {
                const amount = bn('100e6')
                mintCollateralTo(ctx, amount, alice, collateral.address)
        
                await advanceBlocks(1000)
                await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)

                const balBefore = await ctx.rewardToken.balanceOf(collateral.address)
                await collateral.claimRewards()
                const balAfter = await ctx.rewardToken.balanceOf(collateral.address)
                expect(balAfter).gt(balBefore)
              })
        
              it('returns the correct bal', async () => {
                const amount = bn('100e6')
                mintCollateralTo(ctx, amount, alice, collateral.address)
        
                const aliceBal = await collateral.bal(alice.address)
                expect(aliceBal).to.closeTo(amount.mul(bn(10).pow(18 - ctx.tokDecimals)), bn('50').pow(18 - ctx.tokDecimals))
              })
            })
        
            describe('prices', () => {
              it('prices change as USDC feed price changes', async () => {
                const { answer } = await chainlinkFeed.latestRoundData()
                const decimals = await chainlinkFeed.decimals()
                const oracleError = await collateral.oracleError()
                const expectedPrice = answer.mul(bn(10).pow(18 - decimals))
                const expectedDelta = expectedPrice.mul(oracleError).div(fp(1))
        
                // Check initial prices
                const [initLow, initHigh] = await collateral.price()
                expect(initLow).to.equal(expectedPrice.sub(expectedDelta))
                expect(initHigh).to.equal(expectedPrice.add(expectedDelta))
        
                // Get refPerTok initial values
                const initialRefPerTok = await collateral.refPerTok()
        
                // Update values in Oracles increase by 10-20%
                const newPrice = bn('11e6')
                const updateAnswerTx = await chainlinkFeed.updateAnswer(newPrice)
                await updateAnswerTx.wait()
        
                // Check new prices
                const newExpectedPrice = newPrice.mul(bn(10).pow(18 - decimals))
                const newExpectedDelta = newExpectedPrice.mul(oracleError).div(fp(1))
                const [newLow, newHigh] = await collateral.price()
                expect(newLow).to.equal(newExpectedPrice.sub(newExpectedDelta))
                expect(newHigh).to.equal(newExpectedPrice.add(newExpectedDelta))
        
                // Check refPerTok remains the same
                const finalRefPerTok = await collateral.refPerTok()
                expect(finalRefPerTok).to.equal(initialRefPerTok)
              })
        
              it('prices change as refPerTok changes', async () => {
                const prevRefPerTok = await collateral.refPerTok()
                expect(prevRefPerTok).to.equal(bn('1e18'))
        
                const decimals = await chainlinkFeed.decimals()
                const oracleError = await collateral.oracleError()
        
                const initData = await chainlinkFeed.latestRoundData()
                const expectedPrice = initData.answer.mul(bn(10).pow(18 - decimals))
                const expectedDelta = expectedPrice.mul(oracleError).div(fp(1))
                const [initLow, initHigh] = await collateral.price()
                expect(initLow).to.equal(expectedPrice.sub(expectedDelta))
                expect(initHigh).to.equal(expectedPrice.add(expectedDelta))
        
                // need to deposit in order to get an exchange rate
                const amount = bn('20000e6')
                await mintCollateralTo(ctx, amount, alice, alice.address)

                await advanceBlocks(1000)
                await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12000)
                
                await collateral.refresh()
                expect(await collateral.refPerTok()).to.be.gt(prevRefPerTok)
        
                const [newLow, newHigh] = await collateral.price()
                expect(newLow).to.be.gt(initLow)
                expect(newHigh).to.be.gt(initHigh)
              })
        
              it('returns a 0 price', async () => {
                // Set price of USDC to 0
                const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
                await updateAnswerTx.wait()
        
                // (0, FIX_MAX) is returned
                const [low, high] = await collateral.price()
                expect(low).to.equal(0)
                expect(high).to.equal(0)
        
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
        
              it('soft-defaults when reference unit depegs beyond threshold', async () => {
                const delayUntilDefault = await collateral.delayUntilDefault()
        
                // Check initial state
                expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
                expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
        
                // Depeg USDC:USD - Reducing price by 20% from 1 to 0.8
                const updateAnswerTx = await chainlinkFeed.updateAnswer(bn('8e5'))
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
        
                // Move time forward past delayUntilDefault
                await advanceTime(delayUntilDefault)
                expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
        
                // Nothing changes if attempt to refresh after default for CTokenV3
                const prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
                await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
                expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
                expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
              })
        
              it('hard-defaults when refPerTok() decreases', async () => {
                // Check initial state
                expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
                expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
        
                await mintCollateralTo(ctx, bn('20000e6'), alice, alice.address)
        
                await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
                // State remains the same
                expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
                expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
        
                // Withdraw ~99% of supply so that exchange rate will go down
                await reduceRefPerTok(ctx)
        
                // Collateral defaults due to refPerTok() going down
                await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
                expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
                expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
              })
      
              it('enters IFFY state when price becomes stale', async () => {
                const oracleTimeout = await collateral.oracleTimeout()
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

              describe('collatral-specific tests', collateralSpecificStatusTests)
            })
        })
    })
}

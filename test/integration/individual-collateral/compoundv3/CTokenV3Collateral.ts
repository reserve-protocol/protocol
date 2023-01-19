import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  InvalidMockV3Aggregator,
  CusdcV3Wrapper,
  CusdcV3Wrapper__factory,
} from '../../../../typechain'
import {
  ORACLE_TIMEOUT,
  CollateralStatus,
  allocateUSDC,
  mintWcUSDC,
  REWARDS,
  COMP,
  CUSDC_V3,
} from './helpers'
import { deployCollateral, makeCollateral, makeCollateralCometMock, defaultCollateralOpts } from './fixtures'
import { advanceTime, advanceBlocks } from '../../../utils/time'
import { ContractFactory } from 'ethers'

describe('constructor validation', () => {
  it('validates targetName', async () => {
    const CTokenV3CollateralFactory: ContractFactory = await ethers.getContractFactory(
      'CTokenV3Collateral'
    )
    const opts1 = {
      erc20: CUSDC_V3,
      targetName: ethers.constants.HashZero,
      priceTimeout: defaultCollateralOpts.priceTimeout,
      chainlinkFeed: defaultCollateralOpts.chainlinkFeed,
      oracleError: defaultCollateralOpts.oracleError,
      oracleTimeout: defaultCollateralOpts.oracleTimeout,
      maxTradeVolume: defaultCollateralOpts.maxTradeVolume,
      defaultThreshold: defaultCollateralOpts.defaultThreshold,
      delayUntilDefault: defaultCollateralOpts.delayUntilDefault,
    }
    const opts2 = {
      rewardERC20: defaultCollateralOpts.rewardERC20,
      reservesThresholdIffy: defaultCollateralOpts.reservesThresholdIffy,
      reservesThresholdDisabled: defaultCollateralOpts.reservesThresholdDisabled,
    }
    
    await expect(CTokenV3CollateralFactory.deploy(opts1, opts2)).to.be.revertedWith('targetName missing')
  })

  it('does not allow missing ERC20', async () => {
    await expect(deployCollateral({ erc20: ethers.constants.AddressZero })).to.be.revertedWith(
      'missing erc20'
    )
  })

  it('does not allow missing chainlink feed', async () => {
    await expect(
      deployCollateral({ erc20: CUSDC_V3, chainlinkFeed: ethers.constants.AddressZero })
    ).to.be.revertedWith('missing chainlink feed')
  })

  it('max trade volume must be greater than zero', async () => {
    await expect(deployCollateral({ erc20: CUSDC_V3, maxTradeVolume: 0 })).to.be.revertedWith(
      'invalid max trade volume'
    )
  })

  it('does not allow oracle timeout at 0', async () => {
    await expect(deployCollateral({ erc20: CUSDC_V3, oracleTimeout: 0 })).to.be.revertedWith(
      'oracleTimeout zero'
    )
  })
  
  it('does not allow missing delayUntilDefault if defaultThreshold > 0', async () => {
    await expect(deployCollateral({ erc20: CUSDC_V3, delayUntilDefault: 0 })).to.be.revertedWith(
      'delayUntilDefault zero'
    )
  })

  it('does not allow missing rewardERC20', async () => {
    await expect(
      deployCollateral({ erc20: CUSDC_V3, rewardERC20: ethers.constants.AddressZero })
    ).to.be.revertedWith('rewardERC20 missing')
  })

  it('does not allow 0 reservesThresholdIffy', async () => {
    await expect(
      deployCollateral({ erc20: CUSDC_V3, reservesThresholdIffy: 0 })
    ).to.be.revertedWith('reservesThresholdIffy zero')
  })

  it('does not allow 0 reservesThresholdDisabled', async () => {
    await expect(
      deployCollateral({ erc20: CUSDC_V3, reservesThresholdDisabled: 0 })
    ).to.be.revertedWith('reservesThresholdDisabled zero')
  })
})

// describe('prices', () => {
//   it('prices change as USDC feed price changes', async () => {
//     const { collateral, chainlinkFeed } = await loadFixture(makeCollateral())
//     const { answer } = await chainlinkFeed.latestRoundData()
//     const decimals = await chainlinkFeed.decimals()
//     const expectedPrice = exp(answer.toBigInt(), 18 - decimals)

//     // Check initial prices
//     expect(await collateral.strictPrice()).to.equal(expectedPrice)

//     // Check refPerTok initial values
//     const expectedRefPerTok = exp(1, 18)
//     expect(await collateral.refPerTok()).to.equal(expectedRefPerTok) // should equal 1e18

//     // Update values in Oracles increase by 10-20%
//     const newPrice = exp(11, 7)
//     const updateAnswerTx = await chainlinkFeed.updateAnswer(newPrice)
//     await updateAnswerTx.wait()

//     // Check new prices
//     expect(await collateral.strictPrice()).to.equal(exp(newPrice, 18 - decimals))

//     // Check refPerTok remains the same
//     expect(await collateral.refPerTok()).to.equal(expectedRefPerTok)
//   })

//   it('prices change as refPerTok changes', async () => {
//     const { collateral, usdc, cusdcV3, wcusdcV3 } = await loadFixture(makeCollateral())
//     const prevRefPerTok = await collateral.refPerTok()
//     const prevPrice = await collateral.strictPrice()
//     expect(prevRefPerTok).to.equal(exp(1, 18))
//     expect(prevPrice).to.equal(exp(1, 18))

//     const [_, bob] = await ethers.getSigners()
//     const usdcAsB = usdc.connect(bob)
//     const cusdcV3AsB = cusdcV3.connect(bob)
//     const wcusdcV3AsB = wcusdcV3.connect(bob)

//     const balance = 20000e6
//     await allocateUSDC(bob.address, balance)
//     await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
//     await cusdcV3AsB.supply(usdc.address, balance)
//     expect(await usdc.balanceOf(bob.address)).to.equal(0)

//     await cusdcV3AsB.allow(wcusdcV3.address, true)
//     await wcusdcV3AsB.depositTo(bob.address, ethers.constants.MaxUint256)
//     expect(await collateral.refPerTok()).to.not.equal(prevRefPerTok)
//     expect(await collateral.strictPrice()).to.not.equal(prevPrice)
//   })

//   it('reverts if price is zero', async () => {
//     const { collateral, chainlinkFeed } = await loadFixture(makeCollateral())

//     // Set price of USDC to 0
//     const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
//     await updateAnswerTx.wait()

//     // Check price of token
//     await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
//       collateral,
//       'PriceOutsideRange'
//     )

//     // Fallback price is returned
//     const [isFallback, price] = await collateral.price(true)
//     expect(isFallback).to.equal(true)
//     expect(price).to.equal(await collateral.fallbackPrice())

//     // When refreshed, sets status to Unpriced
//     await collateral.refresh()
//     expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
//   })

//   it('reverts in case of invalid timestamp', async () => {
//     const { collateral, chainlinkFeed } = await loadFixture(makeCollateral())
//     await chainlinkFeed.setInvalidTimestamp()

//     // Check price of token
//     await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')

//     // When refreshed, sets status to Unpriced
//     await collateral.refresh()
//     expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
//   })
// })

// describe('status', () => {
//   it('maintains status in normal situations', async () => {
//     const { collateral } = await loadFixture(makeCollateral())
//     // Check initial state
//     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
//     expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

//     // Force updates (with no changes)
//     await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')

//     // State remains the same
//     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
//     expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)
//   })

//   it('soft-defaults when reference unit depegs beyond threshold', async () => {
//     const { collateral, chainlinkFeed } = await loadFixture(makeCollateralCometMock())
//     const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

//     // Check initial state
//     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
//     expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

//     // Depeg USDC:USD - Reducing price by 20% from 1 to 0.8
//     const updateAnswerTx = await chainlinkFeed.updateAnswer(exp(8, 5))
//     await updateAnswerTx.wait()

//     // Force updates - Should update whenDefault and status
//     let expectedDefaultTimestamp: bigint

//     // Set next block timestamp - for deterministic result
//     const nextBlockTimestamp = (await time.latest()) + 1
//     await time.setNextBlockTimestamp(nextBlockTimestamp)
//     expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

//     await expect(collateral.refresh())
//       .to.emit(collateral, 'DefaultStatusChanged')
//       .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
//     expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
//     expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

//     // Move time forward past delayUntilDefault
//     await advanceTime(delayUntilDefault)
//     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

//     // Nothing changes if attempt to refresh after default for CTokenV3
//     let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
//     await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
//     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
//     expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
//   })

//   it('soft-defaults when compound reserves are below target reserves iffy threshold', async () => {
//     const { collateral, cusdcV3 } = await loadFixture(
//       makeCollateralCometMock({ reservesThresholdIffy: 5000n, reservesThresholdDisabled: 1000n })
//     )
//     const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

//     // Check initial state
//     await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
//     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
//     expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

//     // cUSDC/Comet's reserves gone down below reservesThresholdIffy
//     await cusdcV3.setReserves(4000n)

//     const nextBlockTimestamp = (await time.latest()) + 1
//     await time.setNextBlockTimestamp(nextBlockTimestamp)
//     const expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

//     await expect(collateral.refresh())
//       .to.emit(collateral, 'DefaultStatusChanged')
//       .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
//     expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
//     expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

//     // Move time forward past delayUntilDefault
//     await advanceTime(delayUntilDefault)
//     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

//     // Nothing changes if attempt to refresh after default for CTokenV3
//     let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
//     await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
//     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
//     expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
//   })

//   it('hard-defaults when refPerTok() decreases', async () => {
//     const { collateral, usdc, cusdcV3, wcusdcV3 } = await loadFixture(makeCollateral())
//     const [_, bob] = await ethers.getSigners()

//     // Check initial state
//     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
//     expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

//     await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))

//     await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
//     // State remains the same
//     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
//     expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

//     // Force refresh to get new reference price from exchange rate
//     await advanceTime(1000)
//     const oldExchangeRate = await wcusdcV3.exchangeRate()
//     await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')

//     // Withdraw ~99% of supply so that exchange rate will go down
//     await wcusdcV3.connect(bob).withdraw(exp(19900, 6))
//     expect(oldExchangeRate).to.be.gt(await wcusdcV3.exchangeRate())

//     // Collateral defaults due to refPerTok() going down
//     await expect(collateral.refresh()).to.emit(collateral, 'DefaultStatusChanged')
//     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
//     expect(await collateral.whenDefault()).to.equal(await time.latest())
//   })

//   it('hard-defaults when reserves threshold is at disabled levels', async () => {
//     const { collateral, cusdcV3 } = await loadFixture(
//       makeCollateralCometMock({ reservesThresholdDisabled: 1000n })
//     )
//     const [_, bob] = await ethers.getSigners()

//     // Check initial state
//     expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
//     expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

//     // cUSDC/Comet's reserves gone down to 19% of target reserves
//     await cusdcV3.setReserves(900n)

//     await expect(collateral.refresh()).to.emit(collateral, 'DefaultStatusChanged')
//     // State remains the same
//     expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
//     expect(await collateral.whenDefault()).to.equal(await time.latest())
//   })

//   it('reverts if price is stale', async () => {
//     const { collateral } = await loadFixture(makeCollateral())
//     await advanceTime(ORACLE_TIMEOUT)
//     // Check new prices
//     await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')
//   })

//   it('enters IFFY state when price becomes stale', async () => {
//     const { collateral, wcusdcV3, cusdcV3 } = await loadFixture(makeCollateral())
//     await advanceTime(ORACLE_TIMEOUT)
//     await collateral.refresh()
//     expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
//   })

//   it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
//     const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
//       'InvalidMockV3Aggregator'
//     )
//     const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
//       await InvalidMockV3AggregatorFactory.deploy(6, exp(1, 6))
//     )

//     const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
//       await ethers.getContractFactory('CusdcV3Wrapper')
//     )
//     const wcusdcV3 = <CusdcV3Wrapper>await CusdcV3WrapperFactory.deploy(CUSDC_V3, REWARDS, COMP)

//     const invalidCollateral = await deployCollateral({
//       erc20: wcusdcV3.address,
//       chainlinkFeed: invalidChainlinkFeed.address,
//     })

//     // Reverting with no reason
//     await invalidChainlinkFeed.setSimplyRevert(true)
//     await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
//     expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)

//     // Runnning out of gas (same error)
//     await invalidChainlinkFeed.setSimplyRevert(false)
//     await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
//     expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)
//   })
// })

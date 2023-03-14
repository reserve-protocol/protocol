import { expect } from 'chai'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { MockV3Aggregator, MockV3Aggregator__factory } from '../../../../typechain'
import { deployCollateral, makeReserveProtocol } from './fixtures'
import {
  DAI_USD_FEED,
  THREE_POOL,
  USDC,
  USDC_USD_FEED,
  DAI_HOLDER,
  DAI,
  USDT_USD_FEED,
  USDT,
  THREE_POOL_HOLDER,
  THREE_POOL_TOKEN,
  FIX_ONE,
  COMP,
  MAX_TRADE_VOL,
  RSR,
  ETH_USD_FEED,
  CVX_3CRV_HOLDER,
  CVX_3CRV,
  CVX,
  CRV,
  BBTC_POOL,
  AAVE_POOL,
} from './constants'
import {
  resetFork,
  exp
} from './helpers'
import { CollateralStatus } from '../pluginTestTypes'
import { whileImpersonating } from '#/test/utils/impersonation'

const ERC20 = '@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20'

describe('CvxStableCollateral', () => {
  describe('constructor validation', () => {
    it('validates targetName', async () => {
      await expect(deployCollateral({ targetName: ethers.constants.HashZero })).to.be.revertedWith(
        'targetName missing'
      )
    })

    it('requires wrapped stake token', async () => {
      await expect(
        deployCollateral({ wrappedStakeToken: ethers.constants.AddressZero })
      ).to.be.revertedWith('wrappedStakeToken address is zero')
    })

    it('does not allow lpToken address as zero', async () => {
      await expect(deployCollateral({ lpToken: ethers.constants.AddressZero })).to.be.revertedWith(
        'lp token address is zero'
      )
    })

    it('does not allow curve pool address as zero', async () => {
      await expect(
        deployCollateral({ curvePool: ethers.constants.AddressZero })
      ).to.be.revertedWith('curvePool address is zero')
    })

    it('must have feeds limited to 3', async () => {
      await expect(
        deployCollateral({
          tokensPriceFeeds: [[USDC_USD_FEED, USDC_USD_FEED, USDC_USD_FEED, USDC_USD_FEED]],
        })
      ).to.be.revertedWith('price feeds limited to 3')
    })

    it('needs at least 1 price feed for each token', async () => {
      await expect(deployCollateral({ tokensPriceFeeds: [[USDC_USD_FEED]] })).to.be.revertedWith(
        'each token needs at least 1 price feed'
      )
    })

    it('max trade volume must be greater than zero', async () => {
      await expect(deployCollateral({ maxTradeVolume: 0n })).to.be.revertedWith(
        'invalid max trade volume'
      )
    })

    it('does not allow oracle timeout at 0', async () => {
      await expect(deployCollateral({ oracleTimeout: 0n })).to.be.revertedWith('oracleTimeout zero')
    })

    it('does not allow missing defaultThreshold', async () => {
      await expect(deployCollateral({ defaultThreshold: 0n })).to.be.revertedWith(
        'defaultThreshold zero'
      )
    })

    it('does not allow missing delayUntilDefault', async () => {
      await expect(deployCollateral({ delayUntilDefault: 0n })).to.be.revertedWith(
        'delayUntilDefault zero'
      )
    })

    it('does not allow zero fallbackPrice', async () => {
      await expect(deployCollateral({ fallbackPrice: 0n })).to.be.revertedWith(
        'fallback price zero'
      )
    })
  })

  describe('sets correct tokens according to Pool Type', () => {
    it('sets coins for Plain Pools', async () => {
      const collateral = await deployCollateral({ poolType: 0, curvePool: THREE_POOL })
      const curvePool = await ethers.getContractAt('ICurvePool', THREE_POOL)

      expect(await curvePool.coins(0)).to.eq(await collateral.getToken(0))
      expect(await curvePool.coins(1)).to.eq(await collateral.getToken(1))
      expect(await curvePool.coins(2)).to.eq(await collateral.getToken(2))
    })

    it('sets underlying coins for Lending Pools', async () => {
      const collateral = await deployCollateral({ poolType: 1, curvePool: AAVE_POOL })
      const curvePool = await ethers.getContractAt('ICurvePool', AAVE_POOL)

      expect(await curvePool.underlying_coins(0)).to.eq(await collateral.getToken(0))
      expect(await curvePool.underlying_coins(1)).to.eq(await collateral.getToken(1))
      expect(await curvePool.underlying_coins(2)).to.eq(await collateral.getToken(2))
    })

    it('sets base coins for Metapools', async () => {
      const collateral = await deployCollateral({ poolType: 2, curvePool: BBTC_POOL })
      const curvePool = await ethers.getContractAt('ICurvePool', BBTC_POOL)

      expect(await curvePool.base_coins(0)).to.eq(await collateral.getToken(0))
      expect(await curvePool.base_coins(1)).to.eq(await collateral.getToken(1))
      expect(await curvePool.base_coins(2)).to.eq(await collateral.getToken(2))
    })
  })

  describe('getPeg', () => {
    it('supports non-fiat pegs', async () => {
      const collateral = await deployCollateral({ targetPegFeed: ETH_USD_FEED })

      expect(await collateral.getPeg()).to.eq(1209809600000000000000n)
    })

    it('supports fiat pegs', async () => {
      const collateral = await deployCollateral({ targetPegFeed: ethers.constants.AddressZero })

      expect(await collateral.getPeg()).to.eq(FIX_ONE)
    })
  })

  describe('prices', () => {
    it('returns price per lp token', async () => {
      const collateral = await deployCollateral()

      expect(await collateral.strictPrice()).to.eq(1022619554689953605n)
    })

    it('price changes as USDC and USDT prices change in Curve 3Pool', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const mockUSDCfeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const mockUSDTfeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))

      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [mockUSDCfeed.address], [mockUSDTfeed.address]],
      })
      let prevPrice = await collateral.strictPrice()

      await mockUSDCfeed.updateAnswer(exp(2, 6))
      let newPrice = await collateral.strictPrice()
      expect(newPrice).to.be.gt(prevPrice)
      prevPrice = newPrice

      await mockUSDTfeed.updateAnswer(exp(2, 6))
      newPrice = await collateral.strictPrice()
      expect(newPrice).to.be.gt(prevPrice)
    })

    it('price changes as swaps occur', async () => {
      const collateral = await deployCollateral()
      const [swapper] = await ethers.getSigners()
      let prevPrice = await collateral.strictPrice()

      const dai = await ethers.getContractAt(ERC20, DAI)
      const threePool = await ethers.getContractAt('ICurvePool', THREE_POOL)
      await dai.approve(threePool.address, ethers.constants.MaxUint256)

      await whileImpersonating(DAI_HOLDER, async (signer) => {
        const balance = await dai.balanceOf(signer.address)
        await dai.connect(signer).transfer(swapper.address, balance)
      })

      await expect(
        threePool.exchange(0, 1, exp(100_000, 18), exp(98_000, 6))
      ).to.changeTokenBalance(dai, swapper.address, `-${exp(100_000, 18)}`)

      let newPrice = await collateral.strictPrice()
      expect(prevPrice).to.not.eq(newPrice)
      prevPrice = newPrice

      const usdc = await ethers.getContractAt(ERC20, USDC)
      await usdc.approve(threePool.address, ethers.constants.MaxUint256)
      await expect(threePool.exchange(1, 2, exp(90_000, 6), exp(89_000, 6))).to.changeTokenBalance(
        usdc,
        swapper.address,
        `-${exp(90_000, 6)}`
      )

      newPrice = await collateral.strictPrice()
      expect(prevPrice).to.be.lt(newPrice)
    })

    it('reverts if USDC price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [chainlinkFeed.address], [USDT_USD_FEED]],
      })

      // Set price of USDC to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts if DAI price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[chainlinkFeed.address], [USDC_USD_FEED], [USDT_USD_FEED]],
      })

      // Set price of DAI to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts if USDT price is zero', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [USDC_USD_FEED], [chainlinkFeed.address]],
      })

      // Set price of USDT to 0
      const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
      await updateAnswerTx.wait()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
        collateral,
        'PriceOutsideRange'
      )
      // Fallback price is returned
      const [isFallback, price] = await collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(await collateral.fallbackPrice())
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('reverts in case of invalid timestamp', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const chainlinkFeed = await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[DAI_USD_FEED], [USDC_USD_FEED], [chainlinkFeed.address]],
      })
      await chainlinkFeed.setInvalidTimestamp()
      // Check price of token
      await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')
      // When refreshed, sets status to Unpriced
      await collateral.refresh()
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  describe('status', () => {
    it('maintains status in normal situations', async () => {
      const collateral = await deployCollateral()
      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Force updates (with no changes)
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')

      // State remains the same
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)
    })

    it('recovers from soft-default', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const daiMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[daiMockFeed.address], [USDC_USD_FEED], [USDT_USD_FEED]],
      })

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await daiMockFeed.updateAnswer(exp(8, 17))

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

      // DAI:USD peg recovers back to 1:1
      await daiMockFeed.updateAnswer(exp(1, 18))

      // Collateral becomes sound again because peg has recovered
      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('soft-defaults when DAI depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const daiMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, exp(1, 18))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[daiMockFeed.address], [USDC_USD_FEED], [USDT_USD_FEED]],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await daiMockFeed.updateAnswer(exp(8, 17))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when USDC depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const usdcMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[USDC_USD_FEED], [usdcMockFeed.address], [USDT_USD_FEED]],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await usdcMockFeed.updateAnswer(exp(8, 5))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when USDT depegs from fiat target beyond threshold', async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )
      const usdtMockFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, exp(1, 6))
      const collateral = await deployCollateral({
        tokensPriceFeeds: [[USDC_USD_FEED], [usdtMockFeed.address], [USDT_USD_FEED]],
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USD - Reducing price by 20% from 1 to 0.8
      await usdtMockFeed.updateAnswer(exp(8, 5))

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('soft-defaults when liquidity pool is unbalanced beyond threshold', async () => {
      const CurvePoolMockFactory = await ethers.getContractFactory('CurvePoolMock')
      const poolMock = await CurvePoolMockFactory.deploy(
        [exp(10_000, 18), exp(10_000, 6), exp(10_000, 18)],
        [DAI, USDC, USDT]
      )
      const collateral = await deployCollateral({
        curvePool: poolMock.address,
      })
      const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

      // Check initial state
      expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await collateral.whenDefault()).to.equal(ethers.constants.MaxUint256)

      // Depeg DAI:USDC - Set ratio of DAI reserves to USDC reserves 1:0.5
      await poolMock.setBalances([exp(20_000, 18), exp(10_000, 6), exp(16_000, 6)])

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: bigint

      // Set next block timestamp - for deterministic result
      const nextBlockTimestamp = (await time.latest()) + 1
      await time.setNextBlockTimestamp(nextBlockTimestamp)
      expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

      await expect(collateral.refresh())
        .to.emit(collateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await time.increase(delayUntilDefault)
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
      await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')
      expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
    })
  })

  describe('refPerTok', () => {
    // Swaps and huge swings in liquidity should not decrease refPerTok
    it('is mostly increasing', async () => {
      const collateral = await deployCollateral()
      let prevRefPerTok = await collateral.refPerTok()
      const [swapper] = await ethers.getSigners()
      const threePool = await ethers.getContractAt('StableSwap3Pool', THREE_POOL)

      const dai = await ethers.getContractAt(ERC20, DAI)
      await dai.approve(threePool.address, ethers.constants.MaxUint256)
      await whileImpersonating(DAI_HOLDER, async (signer) => {
        const balance = await dai.balanceOf(signer.address)
        await dai.connect(signer).transfer(swapper.address, balance)
      })

      await expect(
        threePool.exchange(0, 1, exp(100_000, 18), exp(99_000, 6))
      ).to.changeTokenBalance(dai, swapper.address, `-${exp(100_000, 18)}`)

      let newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      // Remove 30% of Liquidity. THREE_POOL_HOLDER ~30% of the supply of WBTC-ETH LP token
      const lpToken = await ethers.getContractAt(ERC20, THREE_POOL_TOKEN)
      await whileImpersonating(THREE_POOL_HOLDER, async (signer) => {
        const balance = await lpToken.balanceOf(signer.address)
        await lpToken.connect(signer).transfer(swapper.address, balance)
      })
      const balance = await lpToken.balanceOf(swapper.address)
      await lpToken.approve(threePool.address, ethers.constants.MaxUint256)
      await expect(threePool.remove_liquidity(balance, [0, 0, 0])).to.changeTokenBalance(
        lpToken,
        swapper,
        `-${balance}`
      )

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
      prevRefPerTok = newRefPerTok

      const usdc = await ethers.getContractAt(ERC20, USDC)
      const usdt = await ethers.getContractAt(ERC20, USDT)

      const daiBal = await dai.balanceOf(swapper.address)
      const usdcBal = await usdc.balanceOf(swapper.address)
      const usdtBal = await usdt.balanceOf(swapper.address)
      await usdc.approve(threePool.address, ethers.constants.MaxUint256)
      await usdt.approve(threePool.address, ethers.constants.MaxUint256)

      await expect(
        threePool.add_liquidity([daiBal, usdcBal, usdtBal], [0, 0, 0])
      ).to.changeTokenBalance(dai, swapper.address, `-${daiBal}`)

      newRefPerTok = await collateral.refPerTok()
      expect(prevRefPerTok).to.be.lt(newRefPerTok)
    })
  })
})

describe('CvxStableCollateral integration with reserve protocol', () => {
  beforeEach(resetFork)

  it('sets up assets', async () => {
    const { compAsset, compToken, rsrAsset, rsr } = await makeReserveProtocol()
    // COMP Token
    expect(await compAsset.isCollateral()).to.equal(false)
    expect(await compAsset.erc20()).to.equal(COMP)
    expect(compToken.address).to.equal(COMP)
    expect(await compToken.decimals()).to.equal(18)
    expect(await compAsset.strictPrice()).to.be.closeTo(exp(38, 18), exp(1, 18)) // Close to $38 USD
    expect(await compAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOL)

    // RSR Token
    expect(await rsrAsset.isCollateral()).to.equal(false)
    expect(await rsrAsset.erc20()).to.equal(ethers.utils.getAddress(RSR))
    expect(rsr.address).to.equal(RSR)
    expect(await rsr.decimals()).to.equal(18)
    expect(await rsrAsset.strictPrice()).to.be.closeTo(exp(418, 13), exp(1, 13)) // Close to $0.00418
    expect(await rsrAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOL)
  })

  it('sets up collateral', async () => {
    const { collateral } = await makeReserveProtocol()
    expect(await collateral.isCollateral()).to.equal(true)
    expect(await collateral.erc20()).to.not.equal(ethers.constants.AddressZero) // This address is dynamic and should be the deployed CvxStakingWrapper contract
    expect(await collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
    expect(await collateral.targetPerRef()).to.eq(FIX_ONE)
    expect(await collateral.strictPrice()).to.eq(1022619554689953605n)
    expect(await collateral.maxTradeVolume()).to.eq(MAX_TRADE_VOL)
  })

  it('registers ERC20s and Assets/Collateral', async () => {
    const { collateral, assetRegistry, rTokenAsset, rsrAsset, compAsset } =
      await makeReserveProtocol()
    // Check assets/collateral
    const ERC20s = await assetRegistry.erc20s()

    expect(ERC20s[0]).to.equal(await rTokenAsset.erc20())
    expect(ERC20s[1]).to.equal(await rsrAsset.erc20())
    expect(ERC20s[2]).to.equal(await compAsset.erc20())
    expect(ERC20s[3]).to.equal(await collateral.erc20())

    // Assets
    expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(collateral.address)
    // Collaterals
    expect(await assetRegistry.toColl(ERC20s[3])).to.equal(collateral.address)
  })

  it('registers simple basket', async () => {
    const { rToken, rTokenAsset, basketHandler, facade, facadeTest, collateral } =
      await makeReserveProtocol()
    // Basket
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    const backing = await facade.basketTokens(rToken.address)
    expect(backing[0]).to.equal(ethers.utils.getAddress(await collateral.erc20()))
    expect(backing.length).to.equal(1)

    // Check other values
    expect(await basketHandler.nonce()).to.be.gt(0n)
    expect(await basketHandler.timestamp()).to.be.gt(0n)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    const [isFallback, price] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    expect(price).to.eq(999762969975941599n)
    expect(await rTokenAsset.strictPrice()).eq(price)
  })

  it('issues and reedems with simple basket', async () => {
    const { rToken, collateral, facadeTest, backingManager, basketHandler } =
      await makeReserveProtocol()
    const [bob] = await ethers.getSigners()

    const cvxWrapper = await ethers.getContractAt('ConvexStakingWrapper', await collateral.erc20())
    const cvx3crv = await ethers.getContractAt(ERC20, CVX_3CRV)

    await whileImpersonating(CVX_3CRV_HOLDER, async (signer) => {
      const balance = await cvx3crv.balanceOf(signer.address)
      await cvx3crv.connect(signer).transfer(bob.address, balance)
    })
    await cvx3crv.approve(cvxWrapper.address, ethers.constants.MaxUint256)
    const amount = await cvx3crv.balanceOf(bob.address)
    await cvxWrapper.stake(amount, bob.address)

    await cvxWrapper.approve(rToken.address, ethers.constants.MaxUint256)

    const cvxWrapperTransferred = (await basketHandler.quantity(cvxWrapper.address)).toBigInt() * 2n // Issued 2 units of RToken
    const oldWrapperBalance = (await cvxWrapper.balanceOf(bob.address)).toBigInt()

    // Check rToken is issued
    const issueAmount = exp(2, 18)
    await expect(await rToken.issue(issueAmount)).to.changeTokenBalance(rToken, bob, issueAmount)
    // Check LP tokens transferred for RToken issuance
    expect(await cvxWrapper.balanceOf(bob.address)).to.eq(oldWrapperBalance - cvxWrapperTransferred)

    // Check asset value
    // Approx $3.99 in value. The backing manager only has collateral tokens.
    const expectedValue = (await collateral.bal(backingManager.address))
      .mul(await collateral.strictPrice())
      .div(FIX_ONE)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      expectedValue,
      1
    )

    // Redeem Rtokens
    // We are within the limits of redemption battery (500 RTokens)
    await expect(rToken.connect(bob).redeem(issueAmount)).changeTokenBalance(
      rToken,
      bob,
      `-${issueAmount}`
    )

    // Check balances after - Backing Manager is empty
    expect(await cvxWrapper.balanceOf(backingManager.address)).to.eq(0)

    // Check funds returned to user
    expect(await cvxWrapper.balanceOf(bob.address)).to.eq(oldWrapperBalance)

    // Check asset value left
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.eq(0)
  })

  it('claims rewards ', async () => {
    const { rToken, backingManager, collateral } = await makeReserveProtocol()
    const [bob] = await ethers.getSigners()

    const cvx = await ethers.getContractAt(ERC20, CVX)
    const crv = await ethers.getContractAt(ERC20, CRV)

    // No rewards so far
    expect(await crv.balanceOf(backingManager.address)).to.equal(0)
    expect(await cvx.balanceOf(backingManager.address)).to.equal(0)

    const cvxWrapper = await ethers.getContractAt('ConvexStakingWrapper', await collateral.erc20())
    const cvx3crv = await ethers.getContractAt(ERC20, CVX_3CRV)
    await whileImpersonating(CVX_3CRV_HOLDER, async (signer) => {
      const balance = await cvx3crv.balanceOf(signer.address)
      await cvx3crv.connect(signer).transfer(bob.address, balance)
    })
    await cvx3crv.approve(cvxWrapper.address, ethers.constants.MaxUint256)
    const amount = await cvx3crv.balanceOf(bob.address)
    await cvxWrapper.stake(amount, bob.address)

    // Issue RTokens
    await cvxWrapper.approve(rToken.address, ethers.constants.MaxUint256)
    const issueAmount = exp(1_000, 18)
    await expect(rToken.issue(issueAmount)).to.emit(rToken, 'Issuance')
    expect(await cvxWrapper.balanceOf(backingManager.address)).to.be.gt(0)

    // Check RTokens issued to user
    expect(await rToken.balanceOf(bob.address)).to.equal(issueAmount)

    // Now we can claim rewards
    await time.increase(1000)
    // Claim rewards
    await expect(await backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

    // Check rewards in CVX and CRV
    const cvxRewards = await cvx.balanceOf(backingManager.address)
    expect(cvxRewards).to.be.gt(0)
    const crvRewards = await crv.balanceOf(backingManager.address)
    expect(crvRewards).to.be.gt(0)

    await time.increase(86400)
    // Get additional rewards
    await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

    const newCvxRewards = await cvx.balanceOf(backingManager.address)
    expect(newCvxRewards).to.be.gt(cvxRewards)

    const newCrvRewards = await crv.balanceOf(backingManager.address)
    expect(newCrvRewards).to.be.gt(crvRewards)
  })
})

import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { Wallet, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import {
  advanceBlocks,
  advanceTime,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '../utils/time'
import { ZERO_ADDRESS, ONE_ADDRESS, MAX_UINT192 } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  expectPrice,
  expectRTokenPrice,
  expectUnpriced,
  setInvalidOracleAnsweredRound,
  setInvalidOracleTimestamp,
  setOraclePrice,
} from '../utils/oracles'
import {
  Asset,
  ATokenFiatCollateral,
  CTokenFiatCollateral,
  CTokenWrapperMock,
  ERC20Mock,
  FiatCollateral,
  IAssetRegistry,
  InvalidFiatCollateral,
  InvalidMockV3Aggregator,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIRToken,
  USDCMock,
  UnpricedAssetMock,
} from '../../typechain'
import {
  Collateral,
  defaultFixture,
  IMPLEMENTATION,
  Implementation,
  ORACLE_TIMEOUT,
  ORACLE_ERROR,
  PRICE_TIMEOUT,
  VERSION,
} from '../fixtures'
import { useEnv } from '#/utils/env'
import snapshotGasCost from '../utils/snapshotGasCost'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

describe('Assets contracts #fast', () => {
  // Tokens
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let rToken: TestIRToken
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenWrapperMock

  // Assets
  let collateral0: FiatCollateral
  let collateral1: FiatCollateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral

  // Assets
  let rsrAsset: Asset
  let compAsset: Asset
  let aaveAsset: Asset
  let rTokenAsset: RTokenAsset
  let basket: Collateral[]

  // Config
  let config: IConfig

  // Main
  let wallet: Wallet
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager

  // Factory
  let AssetFactory: ContractFactory
  let RTokenAssetFactory: ContractFactory

  const amt = fp('1e4')

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
  })

  beforeEach(async () => {
    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      compAsset,
      aaveToken,
      aaveAsset,
      basket,
      assetRegistry,
      backingManager,
      config,
      rToken,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    // Get collateral tokens
    collateral0 = <FiatCollateral>basket[0]
    collateral1 = <FiatCollateral>basket[1]
    collateral2 = <ATokenFiatCollateral>basket[2]
    collateral3 = <CTokenFiatCollateral>basket[3]
    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    cToken = <CTokenWrapperMock>(
      await ethers.getContractAt('CTokenWrapperMock', await collateral3.erc20())
    )

    await rsr.connect(wallet).mint(wallet.address, amt)
    await compToken.connect(wallet).mint(wallet.address, amt)
    await aaveToken.connect(wallet).mint(wallet.address, amt)
    // Issue RToken to enable RToken.price
    for (let i = 0; i < basket.length; i++) {
      const tok = await ethers.getContractAt('ERC20Mock', await basket[i].erc20())
      await tok.connect(wallet).mint(wallet.address, amt)
      await tok.connect(wallet).approve(rToken.address, amt)
    }

    await rToken.connect(wallet).issue(amt)

    AssetFactory = await ethers.getContractFactory('Asset')
    RTokenAssetFactory = await ethers.getContractFactory('RTokenAsset')
  })

  describe('Deployment', () => {
    it('Deployment should setup assets correctly', async () => {
      // RSR Asset
      expect(await rsrAsset.isCollateral()).to.equal(false)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await rsr.decimals()).to.equal(18)
      expect(await rsrAsset.version()).to.equal(VERSION)
      expect(await rsrAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await rsrAsset.bal(wallet.address)).to.equal(amt)
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, true)
      await expect(rsrAsset.claimRewards()).to.not.emit(rsrAsset, 'RewardsClaimed')

      // COMP Asset
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.version()).to.equal(VERSION)
      expect(await compAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await compAsset.bal(wallet.address)).to.equal(amt)
      await expectPrice(compAsset.address, fp('1'), ORACLE_ERROR, true)
      await expect(compAsset.claimRewards()).to.not.emit(compAsset, 'RewardsClaimed')

      // AAVE Asset
      expect(await aaveAsset.isCollateral()).to.equal(false)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveAsset.version()).to.equal(VERSION)
      expect(await aaveAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await aaveAsset.bal(wallet.address)).to.equal(amt)
      await expectPrice(aaveAsset.address, fp('1'), ORACLE_ERROR, true)
      await expect(aaveAsset.claimRewards()).to.not.emit(aaveAsset, 'RewardsClaimed')

      // RToken Asset
      expect(await rTokenAsset.isCollateral()).to.equal(false)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await rToken.decimals()).to.equal(18)
      expect(await rTokenAsset.version()).to.equal(VERSION)
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await rTokenAsset.bal(wallet.address)).to.equal(amt)
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
      await expect(rTokenAsset.claimRewards()).to.not.emit(rTokenAsset, 'RewardsClaimed')
    })
  })

  describe('Prices', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, true)
      await expectPrice(compAsset.address, fp('1'), ORACLE_ERROR, true)
      await expectPrice(aaveAsset.address, fp('1'), ORACLE_ERROR, true)
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )

      // Update values in Oracles increase by 10-20%
      await setOraclePrice(compAsset.address, bn('1.1e8')) // 10%
      await setOraclePrice(aaveAsset.address, bn('1.2e8')) // 20%
      await setOraclePrice(rsrAsset.address, bn('1.2e8')) // 20%

      // Check new prices
      await expectPrice(rsrAsset.address, fp('1.2'), ORACLE_ERROR, true)
      await expectPrice(compAsset.address, fp('1.1'), ORACLE_ERROR, true)
      await expectPrice(aaveAsset.address, fp('1.2'), ORACLE_ERROR, true)
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      ) // no change
    })

    it('Should calculate RToken price correctly', async () => {
      // Check initial price
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )

      // Update values of underlying tokens - increase all by 10%
      await setOraclePrice(collateral0.address, bn('1.1e8')) // 10%
      await setOraclePrice(collateral1.address, bn('1.1e8')) // 10%

      // Price of RToken should increase by 10%
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1.1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
    })

    it('Should become unpriced if price is zero', async () => {
      const compInitPrice = await compAsset.price()
      const aaveInitPrice = await aaveAsset.price()
      const rsrInitPrice = await rsrAsset.price()
      const rTokenInitPrice = await rTokenAsset.price()

      // Update values in Oracles to 0
      await setOraclePrice(compAsset.address, bn('0'))
      await setOraclePrice(aaveAsset.address, bn('0'))
      await setOraclePrice(rsrAsset.address, bn('0'))
      await setOraclePrice(collateral0.address, bn(0))
      await setOraclePrice(collateral1.address, bn(0))

      // Fallback prices should be initial prices
      let [lotLow, lotHigh] = await compAsset.price()
      expect(lotLow).to.eq(compInitPrice[0])
      expect(lotHigh).to.eq(compInitPrice[1])
      ;[lotLow, lotHigh] = await rsrAsset.price()
      expect(lotLow).to.eq(rsrInitPrice[0])
      expect(lotHigh).to.eq(rsrInitPrice[1])
      ;[lotLow, lotHigh] = await aaveAsset.price()
      expect(lotLow).to.eq(aaveInitPrice[0])
      expect(lotHigh).to.eq(aaveInitPrice[1])
      ;[lotLow, lotHigh] = await rTokenAsset.price()
      expect(lotLow).to.eq(rTokenInitPrice[0])
      expect(lotHigh).to.eq(rTokenInitPrice[1])

      // Advance past timeouts
      await advanceTime(PRICE_TIMEOUT.add(ORACLE_TIMEOUT).toString())

      // Should be unpriced now
      await expectUnpriced(rsrAsset.address)
      await expectUnpriced(compAsset.address)
      await expectUnpriced(aaveAsset.address)
      await expectUnpriced(rTokenAsset.address)
    })

    it('Should return 0 price for RTokenAsset in full haircut scenario', async () => {
      await token.burn(backingManager.address, await token.balanceOf(backingManager.address))
      await usdc.burn(backingManager.address, await usdc.balanceOf(backingManager.address))
      await aToken.burn(backingManager.address, await aToken.balanceOf(backingManager.address))
      await cToken.burn(backingManager.address, await cToken.balanceOf(backingManager.address))

      await expectRTokenPrice(
        rTokenAsset.address,
        bn('0'),
        bn('0'),
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
    })

    it('Should not revert during RToken price() if supply is zero', async () => {
      // Redeem RToken to make price function revert
      // Note: To get RToken price to 0, a full basket refresh needs to occur (covered in RToken tests)
      await rToken.connect(wallet).redeem(amt)
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
    })

    it('Should calculate trade min correctly', async () => {
      // Check initial values
      expect(await rsrAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await aaveAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await compAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      //  Reduce price in half - doubles min size, maintains max size
      await setOraclePrice(rsrAsset.address, bn('0.5e8')) // half
      expect(await rsrAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await aaveAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await compAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
    })

    it('Should calculate trade min correctly - RToken', async () => {
      // Check initial values
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Reduce price in half - doubles min size, maintains max size
      await setOraclePrice(collateral0.address, bn('0.5e8')) // half
      await setOraclePrice(collateral1.address, bn('0.5e8')) // half

      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
    })

    it('Should remain at saved price if oracle is stale', async () => {
      await advanceTime(ORACLE_TIMEOUT.sub(12).toString())

      // lastSave should not be block timestamp after refresh
      await rsrAsset.refresh()
      await compAsset.refresh()
      await aaveAsset.refresh()
      expect(await rsrAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      expect(await compAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      expect(await aaveAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())

      // Check price
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, false)
      await expectPrice(compAsset.address, fp('1'), ORACLE_ERROR, false)
      await expectPrice(aaveAsset.address, fp('1'), ORACLE_ERROR, false)
    })

    it('Should remain at saved price in case of invalid timestamp', async () => {
      await setInvalidOracleTimestamp(rsrAsset.address)
      await setInvalidOracleTimestamp(compAsset.address)
      await setInvalidOracleTimestamp(aaveAsset.address)

      // lastSave should not be block timestamp after refresh
      await rsrAsset.refresh()
      await compAsset.refresh()
      await aaveAsset.refresh()
      expect(await rsrAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      expect(await compAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      expect(await aaveAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())

      // Check price is still at saved price
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, false)
      await expectPrice(compAsset.address, fp('1'), ORACLE_ERROR, false)
      await expectPrice(aaveAsset.address, fp('1'), ORACLE_ERROR, false)
    })

    it('Should remain at saved price in case of invalid answered round', async () => {
      await setInvalidOracleAnsweredRound(rsrAsset.address)
      await setInvalidOracleAnsweredRound(compAsset.address)
      await setInvalidOracleAnsweredRound(aaveAsset.address)

      // lastSave should not be block timestamp after refresh
      await rsrAsset.refresh()
      await compAsset.refresh()
      await aaveAsset.refresh()
      expect(await rsrAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      expect(await compAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())
      expect(await aaveAsset.lastSave()).to.not.equal(await getLatestBlockTimestamp())

      // Check price is still at saved price
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, false)
      await expectPrice(compAsset.address, fp('1'), ORACLE_ERROR, false)
      await expectPrice(aaveAsset.address, fp('1'), ORACLE_ERROR, false)
    })

    it('Should handle reverting edge cases for RToken', async () => {
      // Swap one of the collaterals for an invalid one
      const InvalidFiatCollateralFactory = await ethers.getContractFactory('InvalidFiatCollateral')
      const invalidFiatCollateral: InvalidFiatCollateral = <InvalidFiatCollateral>(
        await InvalidFiatCollateralFactory.deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral0.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: await collateral0.erc20(),
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        })
      )

      // Swap asset
      await assetRegistry.swapRegistered(invalidFiatCollateral.address)

      // Reverting with a specific error
      await invalidFiatCollateral.setSimplyRevert(true)
      await expect(invalidFiatCollateral.price()).to.be.revertedWith('errormsg')

      // Check RToken unpriced
      await expectUnpriced(rTokenAsset.address)

      // Runnning out of gas
      await invalidFiatCollateral.setSimplyRevert(false)
      await expect(invalidFiatCollateral.price()).to.be.reverted

      //  Check RToken price reverts
      await expect(rTokenAsset.price()).to.be.reverted
    })

    it('Regression test -- Should handle unpriced collateral for RToken', async () => {
      // https://github.com/code-423n4/2023-07-reserve-findings/issues/20

      // Swap one of the collaterals for an invalid one
      const InvalidFiatCollateralFactory = await ethers.getContractFactory('InvalidFiatCollateral')
      const invalidFiatCollateral: InvalidFiatCollateral = <InvalidFiatCollateral>(
        await InvalidFiatCollateralFactory.deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral0.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: await collateral0.erc20(),
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        })
      )

      // Swap asset
      await assetRegistry.swapRegistered(invalidFiatCollateral.address)

      // Set unpriced collateral
      await invalidFiatCollateral.setUnpriced(true)

      // Check RToken is unpriced
      await expectUnpriced(rTokenAsset.address)
    })

    it('Should be able to refresh saved prices', async () => {
      // Check initial prices - use RSR as example
      let currBlockTimestamp: number = await getLatestBlockTimestamp()
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, true)
      let [lowPrice, highPrice] = await rsrAsset.price()
      expect(await rsrAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(highPrice)
      expect(await rsrAsset.lastSave()).to.equal(currBlockTimestamp)

      // Refresh saved prices
      await rsrAsset.refresh()

      // Check values remain but timestamp was updated
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, true)
      ;[lowPrice, highPrice] = await rsrAsset.price()
      expect(await rsrAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(highPrice)
      currBlockTimestamp = await getLatestBlockTimestamp()
      expect(await rsrAsset.lastSave()).to.equal(currBlockTimestamp)

      // Update values in Oracles increase by 20%
      await setOraclePrice(rsrAsset.address, bn('1.2e8')) // 20%

      // Before calling refresh we still have the old values
      await expectPrice(rsrAsset.address, fp('1.2'), ORACLE_ERROR, true)
      ;[lowPrice, highPrice] = await rsrAsset.price()
      expect(await rsrAsset.savedLowPrice()).to.be.lt(lowPrice)
      expect(await rsrAsset.savedHighPrice()).to.be.lt(highPrice)

      // Refresh prices - Should save new values
      await rsrAsset.refresh()

      // Check new prices were stored
      await expectPrice(rsrAsset.address, fp('1.2'), ORACLE_ERROR, true)
      ;[lowPrice, highPrice] = await rsrAsset.price()
      expect(await rsrAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(highPrice)
      currBlockTimestamp = await getLatestBlockTimestamp()
      expect(await rsrAsset.lastSave()).to.equal(currBlockTimestamp)
    })

    it('Should not save prices if try/price returns unpriced', async () => {
      const UnpricedAssetFactory = await ethers.getContractFactory('UnpricedAssetMock')
      const unpricedRSRAsset: UnpricedAssetMock = <UnpricedAssetMock>(
        await UnpricedAssetFactory.deploy(
          PRICE_TIMEOUT,
          await rsrAsset.chainlinkFeed(),
          ORACLE_ERROR,
          rsr.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT
        )
      )

      // Save prices
      await unpricedRSRAsset.refresh()

      // Check initial prices - use RSR as example
      let currBlockTimestamp: number = await getLatestBlockTimestamp()
      await expectPrice(unpricedRSRAsset.address, fp('1'), ORACLE_ERROR, true)
      let [lowPrice, highPrice] = await unpricedRSRAsset.price()
      expect(await unpricedRSRAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await unpricedRSRAsset.savedHighPrice()).to.equal(highPrice)
      expect(await unpricedRSRAsset.lastSave()).to.be.equal(currBlockTimestamp)

      // Refresh saved prices
      await unpricedRSRAsset.refresh()

      // Check values remain but timestamp was updated
      await expectPrice(unpricedRSRAsset.address, fp('1'), ORACLE_ERROR, true)
      ;[lowPrice, highPrice] = await unpricedRSRAsset.price()
      expect(await unpricedRSRAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await unpricedRSRAsset.savedHighPrice()).to.equal(highPrice)
      currBlockTimestamp = await getLatestBlockTimestamp()
      expect(await unpricedRSRAsset.lastSave()).to.equal(currBlockTimestamp)

      // Set as unpriced so it returns 0,FIX MAX in try/price
      await unpricedRSRAsset.setUnpriced(true)

      // Check that now is unpriced
      await expectUnpriced(unpricedRSRAsset.address)

      // Refreshing would not save the new rates
      await unpricedRSRAsset.refresh()
      expect(await unpricedRSRAsset.savedLowPrice()).to.equal(lowPrice)
      expect(await unpricedRSRAsset.savedHighPrice()).to.equal(highPrice)
      expect(await unpricedRSRAsset.lastSave()).to.equal(currBlockTimestamp)
    })

    it('Should not revert on refresh if stale', async () => {
      // Check initial prices - use RSR as example
      const startBlockTimestamp: number = await getLatestBlockTimestamp()
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, false)
      const [prevLowPrice, prevHighPrice] = await rsrAsset.price()
      expect(await rsrAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await rsrAsset.lastSave()).to.equal(startBlockTimestamp)

      // Set invalid oracle
      await setInvalidOracleTimestamp(rsrAsset.address)

      // Check price - uses still previous prices
      await rsrAsset.refresh()
      let [lowPrice, highPrice] = await rsrAsset.price()
      expect(lowPrice).to.equal(prevLowPrice)
      expect(highPrice).to.equal(prevHighPrice)
      expect(await rsrAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await rsrAsset.lastSave()).to.equal(startBlockTimestamp)

      // Check price - no update on prices/timestamp
      await rsrAsset.refresh()
      ;[lowPrice, highPrice] = await rsrAsset.price()
      expect(lowPrice).to.equal(prevLowPrice)
      expect(highPrice).to.equal(prevHighPrice)
      expect(await rsrAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await rsrAsset.lastSave()).to.equal(startBlockTimestamp)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidRSRAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          invalidChainlinkFeed.address,
          ORACLE_ERROR,
          rsr.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidRSRAsset.price()).to.be.reverted
      await expect(invalidRSRAsset.refresh()).to.be.reverted

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidRSRAsset.price()).to.be.reverted
      await expect(invalidRSRAsset.refresh()).to.be.reverted
    })

    it('Should handle price decay correctly', async () => {
      await rsrAsset.refresh()

      // Check prices - use RSR as example
      const startBlockTimestamp: number = await getLatestBlockTimestamp()
      await expectPrice(rsrAsset.address, fp('1'), ORACLE_ERROR, false)
      const [prevLowPrice, prevHighPrice] = await rsrAsset.price()
      expect(await rsrAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await rsrAsset.lastSave()).to.equal(startBlockTimestamp)

      // Set invalid oracle
      await setInvalidOracleTimestamp(rsrAsset.address)

      // Check unpriced - uses still previous prices
      const [lowPrice, highPrice] = await rsrAsset.price()
      expect(lowPrice).to.equal(prevLowPrice)
      expect(highPrice).to.equal(prevHighPrice)
      expect(await rsrAsset.savedLowPrice()).to.equal(prevLowPrice)
      expect(await rsrAsset.savedHighPrice()).to.equal(prevHighPrice)
      expect(await rsrAsset.lastSave()).to.equal(startBlockTimestamp)

      // At first price doesn't decrease
      const [lowPrice2, highPrice2] = await rsrAsset.price()
      expect(lowPrice2).to.eq(lowPrice)
      expect(highPrice2).to.eq(highPrice)

      // Advance past oracleTimeout
      await advanceTime(await rsrAsset.oracleTimeout())

      // Now price widens
      const [lowPrice3, highPrice3] = await rsrAsset.price()
      expect(lowPrice3).to.be.lt(lowPrice2)
      expect(highPrice3).to.be.gt(highPrice2)

      // Advance block, price keeps widening
      await advanceBlocks(1)
      const [lowPrice4, highPrice4] = await rsrAsset.price()
      expect(lowPrice4).to.be.lt(lowPrice3)
      expect(highPrice4).to.be.gt(highPrice3)

      // Advance blocks beyond PRICE_TIMEOUT; price should be [O, FIX_MAX]
      await advanceTime(PRICE_TIMEOUT.toNumber())

      // Lot price returns 0 once time elapses
      const [lowPrice5, highPrice5] = await rsrAsset.price()
      expect(lowPrice5).to.be.lt(lowPrice4)
      expect(highPrice5).to.be.gt(highPrice4)
      expect(lowPrice5).to.be.equal(bn(0))
      expect(highPrice5).to.be.equal(MAX_UINT192)
    })
  })

  describe('Constructor validation', () => {
    it('Should not allow price timeout to be zero', async () => {
      await expect(
        AssetFactory.deploy(0, ONE_ADDRESS, 0, ONE_ADDRESS, config.rTokenMaxTradeVolume, 0)
      ).to.be.revertedWith('price timeout zero')
    })
    it('Should not allow missing chainlink feed', async () => {
      await expect(
        AssetFactory.deploy(1, ZERO_ADDRESS, 0, ONE_ADDRESS, config.rTokenMaxTradeVolume, 1)
      ).to.be.revertedWith('missing chainlink feed')
    })
    it('Should not allow missing erc20', async () => {
      await expect(
        AssetFactory.deploy(1, ONE_ADDRESS, 1, ZERO_ADDRESS, config.rTokenMaxTradeVolume, 1)
      ).to.be.revertedWith('missing erc20')
    })
    it('Should not allow 0 oracleError', async () => {
      await expect(
        AssetFactory.deploy(1, ONE_ADDRESS, 0, ONE_ADDRESS, config.rTokenMaxTradeVolume, 1)
      ).to.be.revertedWith('oracle error out of range')
    })
    it('Should not allow FIX_ONE oracleError', async () => {
      await expect(
        AssetFactory.deploy(1, ONE_ADDRESS, fp('1'), ONE_ADDRESS, config.rTokenMaxTradeVolume, 1)
      ).to.be.revertedWith('oracle error out of range')
    })
    it('Should not allow 0 oracleTimeout', async () => {
      await expect(
        AssetFactory.deploy(1, ONE_ADDRESS, 1, ONE_ADDRESS, config.rTokenMaxTradeVolume, 0)
      ).to.be.revertedWith('oracleTimeout zero')
    })
    it('Should not allow maxTradeVolume to be zero', async () => {
      await expect(AssetFactory.deploy(1, ONE_ADDRESS, 1, ONE_ADDRESS, 0, 1)).to.be.revertedWith(
        'invalid max trade volume'
      )
    })

    it('Should validate constructor in RTokenAsset', async () => {
      await expect(
        RTokenAssetFactory.deploy(ZERO_ADDRESS, config.rTokenMaxTradeVolume)
      ).to.be.revertedWith('missing erc20')

      await expect(RTokenAssetFactory.deploy(rToken.address, 0)).to.be.revertedWith(
        'invalid max trade volume'
      )
    })
  })

  describeGas('Gas Reporting', () => {
    context('refresh()', () => {
      afterEach(async () => {
        await snapshotGasCost(rsrAsset.refresh())
        await snapshotGasCost(rsrAsset.refresh()) // 2nd refresh can be different than 1st
      })

      it('refresh() during SOUND', async () => {
        // pass
      })

      it('refresh() after oracle timeout', async () => {
        const oracleTimeout = await rsrAsset.oracleTimeout()
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + oracleTimeout)
        await advanceBlocks(bn(oracleTimeout).div(12))
      })

      it('refresh() after full price timeout', async () => {
        await advanceTime((await rsrAsset.priceTimeout()) + (await rsrAsset.oracleTimeout()))
        const p = await rsrAsset.price()
        expect(p[0]).to.equal(0)
        expect(p[1]).to.equal(MAX_UINT192)
      })
    })
  })
})

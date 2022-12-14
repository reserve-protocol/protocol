import { expect } from 'chai'
import { Wallet, ContractFactory } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { advanceTime } from '../utils/time'
import { ZERO_ADDRESS, ONE_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { setInvalidOracleTimestamp, setOraclePrice } from '../utils/oracles'
import {
  Asset,
  ATokenFiatCollateral,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FiatCollateral,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIRToken,
  USDCMock,
} from '../../typechain'
import { Collateral, defaultFixture, ORACLE_TIMEOUT } from '../fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('Assets contracts #fast', () => {
  // Tokens
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let rToken: TestIRToken
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock

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
  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let backingManager: TestIBackingManager

  // Factory
  let AssetFactory: ContractFactory
  let RTokenAssetFactory: ContractFactory

  const amt = fp('1e4')

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
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
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())

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
      expect(await rsrAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await rsrAsset.bal(wallet.address)).to.equal(amt)
      expect(await rsrAsset.strictPrice()).to.equal(fp('1'))
      await expect(rsrAsset.claimRewards()).to.not.emit(rsrAsset, 'RewardsClaimed')

      // COMP Asset
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await compAsset.bal(wallet.address)).to.equal(amt)
      expect(await compAsset.strictPrice()).to.equal(fp('1'))
      await expect(compAsset.claimRewards()).to.not.emit(compAsset, 'RewardsClaimed')

      // AAVE Asset
      expect(await aaveAsset.isCollateral()).to.equal(false)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await aaveAsset.bal(wallet.address)).to.equal(amt)
      expect(await aaveAsset.strictPrice()).to.equal(fp('1'))
      await expect(aaveAsset.claimRewards()).to.not.emit(aaveAsset, 'RewardsClaimed')

      // RToken Asset
      expect(await rTokenAsset.isCollateral()).to.equal(false)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await rToken.decimals()).to.equal(18)
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await rTokenAsset.bal(wallet.address)).to.equal(amt)
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
      await expect(rTokenAsset.claimRewards()).to.not.emit(rTokenAsset, 'RewardsClaimed')
    })
  })

  describe('Prices', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      expect(await rsrAsset.strictPrice()).to.equal(fp('1'))
      expect(await compAsset.strictPrice()).to.equal(fp('1'))
      expect(await aaveAsset.strictPrice()).to.equal(fp('1'))
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))

      // Update values in Oracles increase by 10-20%
      await setOraclePrice(compAsset.address, bn('1.1e8')) // 10%
      await setOraclePrice(aaveAsset.address, bn('1.2e8')) // 20%
      await setOraclePrice(rsrAsset.address, bn('1.2e8')) // 20%

      // Check new prices
      expect(await rsrAsset.strictPrice()).to.equal(fp('1.2'))
      expect(await compAsset.strictPrice()).to.equal(fp('1.1'))
      expect(await aaveAsset.strictPrice()).to.equal(fp('1.2'))
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1')) // No changes
    })

    it('Should calculate RToken price correctly', async () => {
      // Check initial price
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))

      // Update values of underlying tokens - increase all by 10%
      await setOraclePrice(collateral0.address, bn('1.1e8')) // 10%
      await setOraclePrice(collateral1.address, bn('1.1e8')) // 10%

      // Price of RToken should increase by 10%
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1.1'))
    })

    it('Should revert price if price is zero', async () => {
      // Update values in Oracles to 0
      await setOraclePrice(compAsset.address, bn('0'))
      await setOraclePrice(aaveAsset.address, bn('0'))
      await setOraclePrice(rsrAsset.address, bn('0'))

      // Check new prices
      await expect(rsrAsset.strictPrice()).to.be.revertedWith('PriceOutsideRange()')
      await expect(compAsset.strictPrice()).to.be.revertedWith('PriceOutsideRange()')
      await expect(aaveAsset.strictPrice()).to.be.revertedWith('PriceOutsideRange()')

      // Fallback price is returned - use RSR as example
      let [isFallback, price] = await rsrAsset.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Update values of underlying tokens to 0
      await setOraclePrice(collateral0.address, bn(0))
      await setOraclePrice(collateral1.address, bn(0))

      await expect(rTokenAsset.strictPrice()).to.be.revertedWith(
        'price reverted without failover enabled'
      )

      // Fallback price is returned
      ;[isFallback, price] = await rTokenAsset.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))
    })

    it('Should return 0 price for RTokenAsset in full haircut scenario', async () => {
      await token.burn(backingManager.address, await token.balanceOf(backingManager.address))
      await usdc.burn(backingManager.address, await usdc.balanceOf(backingManager.address))
      await aToken.burn(backingManager.address, await aToken.balanceOf(backingManager.address))
      await cToken.burn(backingManager.address, await cToken.balanceOf(backingManager.address))

      expect(await rTokenAsset.strictPrice()).to.equal(0)
    })

    it('Should not revert RToken price if supply is zero', async () => {
      // Redeem RToken to make price function revert
      // Note: To get RToken price to 0, a full basket refresh needs to occur (covered in RToken tests)
      await rToken.connect(wallet).redeem(amt)
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
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

    it('Should revert if price is stale', async () => {
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Check new prices
      await expect(rsrAsset.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(compAsset.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(aaveAsset.strictPrice()).to.be.revertedWith('StalePrice()')
    })

    it('Should revert in case of invalid timestamp', async () => {
      await setInvalidOracleTimestamp(rsrAsset.address)
      await setInvalidOracleTimestamp(compAsset.address)
      await setInvalidOracleTimestamp(aaveAsset.address)

      // Check price of token
      await expect(rsrAsset.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(compAsset.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(aaveAsset.strictPrice()).to.be.revertedWith('StalePrice()')
    })
  })

  describe('Constructor validation', () => {
    it('Should not allow fallback price to be zero', async () => {
      await expect(
        AssetFactory.deploy(0, ONE_ADDRESS, ONE_ADDRESS, config.rTokenMaxTradeVolume, 0)
      ).to.be.revertedWith('fallback price zero')
    })
    it('Should not allow missing chainlink feed', async () => {
      await expect(
        AssetFactory.deploy(1, ZERO_ADDRESS, ONE_ADDRESS, config.rTokenMaxTradeVolume, 1)
      ).to.be.revertedWith('missing chainlink feed')
    })
    it('Should not allow missing erc20', async () => {
      await expect(
        AssetFactory.deploy(1, ONE_ADDRESS, ZERO_ADDRESS, config.rTokenMaxTradeVolume, 1)
      ).to.be.revertedWith('missing erc20')
    })
    it('Should not allow 0 oracleTimeout', async () => {
      await expect(
        AssetFactory.deploy(1, ONE_ADDRESS, ONE_ADDRESS, config.rTokenMaxTradeVolume, 0)
      ).to.be.revertedWith('oracleTimeout zero')
    })
    it('Should not allow maxTradeVolume to be zero', async () => {
      await expect(AssetFactory.deploy(1, ONE_ADDRESS, ONE_ADDRESS, 0, 1)).to.be.revertedWith(
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
})

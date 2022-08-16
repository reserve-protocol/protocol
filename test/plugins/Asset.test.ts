import { expect } from 'chai'
import { Wallet, ContractFactory } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { advanceTime } from '../utils/time'
import { ZERO_ADDRESS, ONE_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { setInvalidOracleTimestamp, setOraclePrice } from '../utils/oracles'
import { Asset, ERC20Mock, RTokenAsset, TestIRToken } from '../../typechain'
import { Collateral, defaultFixture, ORACLE_TIMEOUT } from '../fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('Assets contracts #fast', () => {
  // Tokens
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let rToken: TestIRToken

  // Tokens/Assets
  let collateral0: Collateral
  let collateral1: Collateral

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

  const amt = fp('1e4')

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    // Deploy fixture
    let collateral: Collateral[]
    ;({
      rsr,
      rsrAsset,
      compToken,
      compAsset,
      aaveToken,
      aaveAsset,
      basket,
      collateral,
      config,
      rToken,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    collateral0 = <Collateral>await ethers.getContractAt('Asset', collateral[0].address)
    collateral1 = <Collateral>await ethers.getContractAt('Asset', collateral[1].address)

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
  })

  describe('Deployment', () => {
    it('Deployment should setup assets correctly', async () => {
      // RSR Asset
      expect(await rsrAsset.isCollateral()).to.equal(false)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await rsr.decimals()).to.equal(18)
      expect(await rsrAsset.minTradeSize()).to.equal(config.tradingRange.min)
      expect(await rsrAsset.maxTradeSize()).to.equal(config.tradingRange.max)
      expect(await rsrAsset.bal(wallet.address)).to.equal(amt)
      expect(await rsrAsset.price()).to.equal(fp('1'))
      expect(await rsrAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await rsrAsset.rewardERC20()).to.equal(ZERO_ADDRESS)

      // COMP Token
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.minTradeSize()).to.equal(config.tradingRange.min)
      expect(await compAsset.maxTradeSize()).to.equal(config.tradingRange.max)
      expect(await compAsset.bal(wallet.address)).to.equal(amt)
      expect(await compAsset.price()).to.equal(fp('1'))
      expect(await compAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await compAsset.rewardERC20()).to.equal(ZERO_ADDRESS)

      // AAVE Token
      expect(await aaveAsset.isCollateral()).to.equal(false)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveAsset.minTradeSize()).to.equal(config.tradingRange.min)
      expect(await aaveAsset.maxTradeSize()).to.equal(config.tradingRange.max)
      expect(await aaveAsset.bal(wallet.address)).to.equal(amt)
      expect(await aaveAsset.price()).to.equal(fp('1'))
      expect(await aaveAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await aaveAsset.rewardERC20()).to.equal(ZERO_ADDRESS)

      // RToken
      expect(await rTokenAsset.isCollateral()).to.equal(false)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await rToken.decimals()).to.equal(18)
      expect(await rTokenAsset.minTradeSize()).to.equal(config.tradingRange.min)
      expect(await rTokenAsset.maxTradeSize()).to.equal(config.tradingRange.max)
      expect(await rTokenAsset.bal(wallet.address)).to.equal(amt)
      expect(await rTokenAsset.price()).to.equal(fp('1'))
      expect(await rTokenAsset.price()).to.equal(await rTokenAsset.price())
      expect(await rTokenAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await rTokenAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    })
  })

  describe('Prices', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      expect(await rsrAsset.price()).to.equal(fp('1'))
      expect(await compAsset.price()).to.equal(fp('1'))
      expect(await aaveAsset.price()).to.equal(fp('1'))
      expect(await rTokenAsset.price()).to.equal(fp('1'))

      // Update values in Oracles increase by 10-20%
      await setOraclePrice(compAsset.address, bn('1.1e8')) // 10%
      await setOraclePrice(aaveAsset.address, bn('1.2e8')) // 20%
      await setOraclePrice(rsrAsset.address, bn('1.2e8')) // 20%

      // Check new prices
      expect(await rsrAsset.price()).to.equal(fp('1.2'))
      expect(await compAsset.price()).to.equal(fp('1.1'))
      expect(await aaveAsset.price()).to.equal(fp('1.2'))
      expect(await rTokenAsset.price()).to.equal(fp('1')) // No changes
      expect(await rTokenAsset.price()).to.equal(await rTokenAsset.price())
    })

    it('Should calculate RToken price correctly', async () => {
      // Check initial price
      expect(await rTokenAsset.price()).to.equal(fp('1'))

      // Update values of underlying tokens - increase all by 10%
      await setOraclePrice(collateral0.address, bn('1.1e8')) // 10%
      await setOraclePrice(collateral1.address, bn('1.1e8')) // 10%

      // Price of RToken should increase by 10%
      expect(await rTokenAsset.price()).to.equal(fp('1.1'))
      expect(await rTokenAsset.price()).to.equal(await rTokenAsset.price())
    })

    it('Should revert if price is zero', async () => {
      // Update values in Oracles to 0
      await setOraclePrice(compAsset.address, bn('0'))
      await setOraclePrice(aaveAsset.address, bn('0'))
      await setOraclePrice(rsrAsset.address, bn('0'))

      // Check new prices
      await expect(rsrAsset.price()).to.be.revertedWith('PriceOutsideRange()')
      await expect(compAsset.price()).to.be.revertedWith('PriceOutsideRange()')
      await expect(aaveAsset.price()).to.be.revertedWith('PriceOutsideRange()')
    })

    it('Should revert if price is stale', async () => {
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Check new prices
      await expect(rsrAsset.price()).to.be.revertedWith('StalePrice()')
      await expect(compAsset.price()).to.be.revertedWith('StalePrice()')
      await expect(aaveAsset.price()).to.be.revertedWith('StalePrice()')
    })

    it('Should revert in case of invalid timestamp', async () => {
      await setInvalidOracleTimestamp(rsrAsset.address)
      await setInvalidOracleTimestamp(compAsset.address)
      await setInvalidOracleTimestamp(aaveAsset.address)

      // Check price of token
      await expect(rsrAsset.price()).to.be.revertedWith('StalePrice()')
      await expect(compAsset.price()).to.be.revertedWith('StalePrice()')
      await expect(aaveAsset.price()).to.be.revertedWith('StalePrice()')
    })
  })
  describe('Constructor validation', () => {
    it('Should not allow missing chainlink feed', async () => {
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      await expect(
        AssetFactory.deploy(ZERO_ADDRESS, ONE_ADDRESS, ONE_ADDRESS, config.tradingRange, 1)
      ).to.be.revertedWith('missing chainlink feed')
    })
    it('Should not allow missing erc20', async () => {
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      await expect(
        AssetFactory.deploy(ONE_ADDRESS, ZERO_ADDRESS, ONE_ADDRESS, config.tradingRange, 1)
      ).to.be.revertedWith('missing erc20')
    })
    it('Should not allow 0 maxTradeVolume', async () => {
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const emptyTradingRange = { min: 0, max: 0 }
      await expect(
        AssetFactory.deploy(ONE_ADDRESS, ONE_ADDRESS, ONE_ADDRESS, emptyTradingRange, 1)
      ).to.be.revertedWith('invalid maxTradeSize')
    })
    it('Should not allow 0 oracleTimeout', async () => {
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      await expect(
        AssetFactory.deploy(ONE_ADDRESS, ONE_ADDRESS, ONE_ADDRESS, config.tradingRange, 0)
      ).to.be.revertedWith('oracleTimeout zero')
    })
  })
})

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { CollateralStatus, MAX_UINT256 } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { AaveOracle } from '../../typechain/AaveOracle'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { CompoundOracle } from '../../typechain/CompoundOracle'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { USDCMock } from '../../typechain/USDCMock'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('CollateralP0 contracts', () => {
  let owner: SignerWithAddress

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral

  // Oracles
  let compoundOracle: CompoundOracle
  let compoundOracleInternal: CompoundOracleMockP0
  let aaveOracle: AaveOracle
  let aaveOracleInternal: AaveOracleMockP0

  // Main
  let main: MainP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    let basket: Collateral[]

      // Deploy fixture
    ;({ compoundOracleInternal, compoundOracle, aaveOracleInternal, aaveOracle, basket, main } =
      await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenAsset = basket[0]
    usdcAsset = basket[1]
    aTokenAsset = basket[2]
    cTokenAsset = basket[3]
    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())
  })

  describe('Deployment', () => {
    it('Deployment should setup collateral correctly', async () => {
      // Fiat Token Asset
      expect(await tokenAsset.main()).to.equal(main.address)
      expect(await tokenAsset.oracle()).to.equal(aaveOracle.address)
      expect(await tokenAsset.isCollateral()).to.equal(true)
      expect(await tokenAsset.erc20()).to.equal(token.address)
      expect(await token.decimals()).to.equal(18)
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await tokenAsset.refPerTok()).to.equal(fp('1'))
      expect(await tokenAsset.price()).to.equal(fp('1'))

      // USDC Fiat Token
      expect(await usdcAsset.main()).to.equal(main.address)
      expect(await usdcAsset.oracle()).to.equal(aaveOracle.address)
      expect(await usdcAsset.isCollateral()).to.equal(true)
      expect(await usdcAsset.erc20()).to.equal(usdc.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcAsset.refPerTok()).to.equal(fp('1'))
      expect(await usdcAsset.price()).to.equal(fp('1'))

      // AToken
      expect(await aTokenAsset.main()).to.equal(main.address)
      expect(await aTokenAsset.oracle()).to.equal(aaveOracle.address)
      expect(await aTokenAsset.isCollateral()).to.equal(true)
      expect(await aTokenAsset.erc20()).to.equal(aToken.address)
      expect(await aToken.decimals()).to.equal(18)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenAsset.refPerTok()).to.equal(fp('1'))
      expect(await aTokenAsset.price()).to.equal(fp('1'))

      // CToken
      expect(await cTokenAsset.main()).to.equal(main.address)
      expect(await cTokenAsset.oracle()).to.equal(compoundOracle.address)
      expect(await cTokenAsset.isCollateral()).to.equal(true)
      expect(await cTokenAsset.erc20()).to.equal(cToken.address)
      expect(await cToken.decimals()).to.equal(8)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenAsset.refPerTok()).to.equal(fp('1'))
      expect(await cTokenAsset.price()).to.equal(fp('1'))
    })
  })

  describe('Prices', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      expect(await tokenAsset.price()).to.equal(fp('1'))
      expect(await usdcAsset.price()).to.equal(fp('1'))
      expect(await aTokenAsset.price()).to.equal(fp('1'))
      expect(await cTokenAsset.price()).to.equal(fp('1'))

      // Update values in Oracles increase by 10-20%
      await aaveOracleInternal.setPrice(token.address, bn('2.75e14')) // 10%
      await aaveOracleInternal.setPrice(usdc.address, bn('2.75e14')) // 10%
      await compoundOracleInternal.setPrice(await token.symbol(), bn('1.1e6')) // 10%

      // Check new prices
      expect(await tokenAsset.price()).to.equal(fp('1.1'))
      expect(await usdcAsset.price()).to.equal(fp('1.1'))
      expect(await aTokenAsset.price()).to.equal(fp('1.1'))
      expect(await cTokenAsset.price()).to.equal(fp('1.1'))
    })

    it('Should calculate price correctly when ATokens and CTokens appreciate', async () => {
      // Check initial prices
      expect(await aTokenAsset.price()).to.equal(fp('1'))
      expect(await cTokenAsset.price()).to.equal(fp('1'))

      // Increase rate for Ctoken and AToken to double
      await aToken.setExchangeRate(fp(2))
      await cToken.setExchangeRate(fp(2))

      // Check prices doubled
      expect(await aTokenAsset.price()).to.equal(fp('2'))
      expect(await cTokenAsset.price()).to.equal(fp('2'))
    })
  })

  describe('Status', () => {
    it('Should maintain status in normal situations', async () => {
      // Check initial state
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenAsset.whenDefault()).to.equal(MAX_UINT256)

      // Force updates (with no changes)
      await tokenAsset.forceUpdates()
      await usdcAsset.forceUpdates()
      await aTokenAsset.forceUpdates()
      await cTokenAsset.forceUpdates()

      // State remains the same
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenAsset.whenDefault()).to.equal(MAX_UINT256)
    })

    it('Updates status in case of Default', async () => {
      const defaultDelay: BigNumber = await main.defaultDelay()

      // Check initial state
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenAsset.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      // Should also impact on the aToken and cToken
      await aaveOracleInternal.setPrice(token.address, bn('2e14')) // -20%
      await compoundOracleInternal.setPrice(await token.symbol(), bn('0.8e6')) // -20%

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: BigNumber

      await tokenAsset.forceUpdates()
      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp()).add(defaultDelay)
      expect(await tokenAsset.status()).to.equal(CollateralStatus.IFFY)
      expect(await tokenAsset.whenDefault()).to.equal(expectedDefaultTimestamp)

      await usdcAsset.forceUpdates()
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)

      await aTokenAsset.forceUpdates()
      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp()).add(defaultDelay)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.IFFY)
      expect(await aTokenAsset.whenDefault()).to.equal(expectedDefaultTimestamp)

      await cTokenAsset.forceUpdates()
      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp()).add(defaultDelay)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.IFFY)
      expect(await cTokenAsset.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past defaultDelay
      await advanceTime(Number(defaultDelay))
      expect(await tokenAsset.status()).to.equal(CollateralStatus.DISABLED)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.DISABLED)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.DISABLED)
    })

    it('Disables collateral correcly', async () => {
      // Check initial status
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)

      // Force update
      await tokenAsset.forceUpdates()

      //  Check status remains the same
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)

      // Disable collateral directly with Main.owner
      await tokenAsset.connect(owner).disable()

      // Check Collateral is disabled
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await tokenAsset.status()).to.equal(CollateralStatus.DISABLED)
      expect(await tokenAsset.whenDefault()).to.equal(expectedDefaultTimestamp)
    })
  })
})

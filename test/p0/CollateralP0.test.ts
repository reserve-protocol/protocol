import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256 } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { AaveOracle } from '../../typechain/AaveOracle'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { ATokenCollateralP0 } from '../../typechain/ATokenCollateralP0'
import { CompoundOracle } from '../../typechain/CompoundOracle'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenCollateralP0 } from '../../typechain/CTokenCollateralP0'
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
  let other: SignerWithAddress

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let aaveToken: ERC20Mock
  let compToken: ERC20Mock

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: ATokenCollateralP0
  let cTokenAsset: CTokenCollateralP0

  // Oracles
  let compoundMock: ComptrollerMockP0
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
    ;[owner, other] = await ethers.getSigners()

    let basket: Collateral[]

      // Deploy fixture
    ;({
      compToken,
      compoundMock,
      compoundOracleInternal,
      compoundOracle,
      aaveToken,
      aaveOracleInternal,
      aaveOracle,
      basket,
      main,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenAsset = basket[0]
    usdcAsset = basket[1]
    aTokenAsset = basket[2] as ATokenCollateralP0
    cTokenAsset = basket[3] as CTokenCollateralP0
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
      expect(await aTokenAsset.prevReferencePrice()).to.equal(await aTokenAsset.refPerTok())
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
      expect(await cTokenAsset.prevReferencePrice()).to.equal(await cTokenAsset.refPerTok())
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

    it('Updates status in case of soft default', async () => {
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

      // Nothing changes if attempt to forceUpdates after default for ATokens/CTokens
      // AToken
      let prevWhenDefault: BigNumber = await aTokenAsset.whenDefault()
      await aTokenAsset.forceUpdates()
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.DISABLED)
      expect(await aTokenAsset.whenDefault()).to.equal(prevWhenDefault)

      // CToken
      prevWhenDefault = await cTokenAsset.whenDefault()
      await cTokenAsset.forceUpdates()
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.DISABLED)
      expect(await cTokenAsset.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Updates status in case of hard default', async () => {
      // Check initial state
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenAsset.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for AToken and CToken, will disable collateral immediately
      await aToken.setExchangeRate(fp('0.99'))
      await cToken.setExchangeRate(fp('0.95'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await tokenAsset.forceUpdates()
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)

      await usdcAsset.forceUpdates()
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)

      await aTokenAsset.forceUpdates()
      expect(await aTokenAsset.status()).to.equal(CollateralStatus.DISABLED)
      expect(await aTokenAsset.whenDefault()).to.equal(bn(await getLatestBlockTimestamp()))

      await cTokenAsset.forceUpdates()
      expect(await cTokenAsset.status()).to.equal(CollateralStatus.DISABLED)
      expect(await cTokenAsset.whenDefault()).to.equal(bn(await getLatestBlockTimestamp()))
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

      // Cannot disable collateral if not main or owner
      await expect(usdcAsset.connect(other).disable()).to.be.revertedWith('main or its owner')
    })
  })

  describe('Rewards', () => {
    it('Should claim and sweep rewards for ATokens/CTokens', async function () {
      // Set COMP and AAVE rewards for Main
      const rewardAmountCOMP: BigNumber = bn('100e18')
      const rewardAmountAAVE: BigNumber = bn('20e18')
      await compoundMock.setRewards(main.address, rewardAmountCOMP)
      await aToken.setRewards(main.address, rewardAmountAAVE)

      // Check funds not yet swept
      expect(await compToken.balanceOf(main.address)).to.equal(0)
      expect(await aaveToken.balanceOf(main.address)).to.equal(0)

      // Claim and Sweep rewards - Directly
      await aTokenAsset.claimAndSweepRewards(aTokenAsset.address, main.address)
      await cTokenAsset.claimAndSweepRewards(cTokenAsset.address, main.address)

      // Check funds not yet swept because they dont reside in the Collateral
      // This has to be called via Delegate call (through Main)
      expect(await compToken.balanceOf(main.address)).to.equal(0)
      expect(await aaveToken.balanceOf(main.address)).to.equal(0)

      // Claim and Sweep rewards - From Main, delegate call
      await main.poke()

      // Check rewards were transfered to Main
      expect(await compToken.balanceOf(await main.address)).to.equal(rewardAmountCOMP)
      expect(await aaveToken.balanceOf(await main.address)).to.equal(rewardAmountAAVE)
    })

    it('Should handle failure in the Rewards delegate call', async function () {
      // Set AAVE rewards for Main
      const rewardAmountAAVE: BigNumber = bn('20e18')
      await aToken.setRewards(main.address, rewardAmountAAVE)

      // Check funds not yet swept
      expect(await aaveToken.balanceOf(main.address)).to.equal(0)

      // Force delegate call to fail, set an invalid AAVE asset
      await main.connect(owner).setAAVEAsset(tokenAsset.address)

      // Attempt to claim and Sweep rewards - From Main, delegate call
      await expect(main.poke()).to.be.revertedWith('delegatecall rewards claim failed')

      // Check funds not yet swept
      expect(await aaveToken.balanceOf(main.address)).to.equal(0)
    })
  })
})

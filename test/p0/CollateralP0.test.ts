import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256 } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveOracleMockP0,
  ATokenFiatCollateralP0,
  CompoundOracleMockP0,
  CompoundPricedFiatCollateralP0,
  ComptrollerMockP0,
  CTokenFiatCollateralP0,
  CTokenMock,
  AssetRegistryP0,
  ExplorerFacadeP0,
  BackingManagerP0,
  BasketHandlerP0,
  RTokenIssuerP0,
  RevenueDistributorP0,
  SettingsP0,
  ERC20Mock,
  MainP0,
  StaticATokenMock,
  USDCMock,
} from '../../typechain'
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
  let aTokenAsset: ATokenFiatCollateralP0
  let cTokenAsset: CTokenFiatCollateralP0

  // Oracles
  let compoundMock: ComptrollerMockP0
  let compoundOracleInternal: CompoundOracleMockP0
  let aaveOracleInternal: AaveOracleMockP0

  // Main
  let main: MainP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let rTokenIssuer: RTokenIssuerP0
  let revenueDistributor: RevenueDistributorP0
  let settings: SettingsP0
  let facade: ExplorerFacadeP0

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
      aaveToken,
      aaveOracleInternal,
      basket,
      main,
      assetRegistry,
      backingManager,
      basketHandler,
      rTokenIssuer,
      revenueDistributor,
      settings,
      facade,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenAsset = basket[0]
    usdcAsset = basket[1]
    aTokenAsset = basket[2] as ATokenFiatCollateralP0
    cTokenAsset = basket[3] as CTokenFiatCollateralP0
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
      expect(await tokenAsset.isCollateral()).to.equal(true)
      expect(await tokenAsset.erc20()).to.equal(token.address)
      expect(await token.decimals()).to.equal(18)
      expect(await tokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await tokenAsset.refPerTok()).to.equal(fp('1'))
      expect(await tokenAsset.price()).to.equal(fp('1'))

      // USDC Fiat Token
      expect(await usdcAsset.main()).to.equal(main.address)
      expect(await usdcAsset.isCollateral()).to.equal(true)
      expect(await usdcAsset.erc20()).to.equal(usdc.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await usdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcAsset.refPerTok()).to.equal(fp('1'))
      expect(await usdcAsset.price()).to.equal(fp('1'))

      // AToken
      expect(await aTokenAsset.main()).to.equal(main.address)
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

      // Check RToken price
      expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1.1'))
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

      // Check RToken price - Remains the same until Revenues are processed
      expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))
    })

    it('Should revert if price is zero', async () => {
      const symbol: string = await token.symbol()

      // Set price of token to 0 in Aave
      await aaveOracleInternal.setPrice(token.address, bn('0'))

      // Check price of token
      await expect(tokenAsset.price()).to.be.revertedWith(`PriceIsZero("${symbol}")`)
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
      const defaultDelay: BigNumber = await settings.defaultDelay()

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
  })

  describe('Rewards', () => {
    it('Should claim and sweep rewards for ATokens/CTokens', async function () {
      // Set COMP and AAVE rewards for Main
      const rewardAmountCOMP: BigNumber = bn('100e18')
      const rewardAmountAAVE: BigNumber = bn('20e18')
      await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)
      await aToken.setRewards(backingManager.address, rewardAmountAAVE)

      // Check funds not yet swept
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)

      // Claim and Sweep rewards - From Main
      await facade.claimRewards()

      // Check rewards were transfered to BackingManager
      expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmountCOMP)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)
    })

    it('Should handle failure in the Rewards call', async function () {
      // Set COMP reward for Main
      const rewardAmountCOMP: BigNumber = bn('100e18')
      await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

      // Check funds not yet swept
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

      // Force call to fail, set an invalid COMP token in Comptroller
      await compoundMock.connect(owner).setCompToken(cTokenAsset.address)
      await expect(facade.claimRewards()).to.be.revertedWith('rewards claim failed')

      // Check funds not yet swept
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
    })
  })

  // Tests specific to the CompoundFiatCollateral.sol contract, not used by default in fixture
  describe('Compound Fiat Collateral', () => {
    let compoundTokenAsset: CompoundPricedFiatCollateralP0
    let compoundUsdcAsset: CompoundPricedFiatCollateralP0

    beforeEach(async () => {
      const CompoundFiatCollFactory: ContractFactory = await ethers.getContractFactory(
        'CompoundPricedFiatCollateralP0'
      )
      compoundTokenAsset = <CompoundPricedFiatCollateralP0>(
        await CompoundFiatCollFactory.deploy(
          token.address,
          await tokenAsset.maxAuctionSize(),
          main.address,
          compoundMock.address
        )
      )
      compoundUsdcAsset = <CompoundPricedFiatCollateralP0>(
        await CompoundFiatCollFactory.deploy(
          usdc.address,
          await usdcAsset.maxAuctionSize(),
          main.address,
          compoundMock.address
        )
      )
    })

    it('Should setup collateral correctly', async function () {
      // Compound - Fiat Token Asset
      expect(await compoundTokenAsset.main()).to.equal(main.address)
      expect(await compoundTokenAsset.isCollateral()).to.equal(true)
      expect(await compoundTokenAsset.erc20()).to.equal(token.address)
      expect(await compoundTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await compoundTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await compoundTokenAsset.refPerTok()).to.equal(fp('1'))
      expect(await compoundTokenAsset.price()).to.equal(fp('1'))

      // Compound - USDC Fiat Token
      expect(await compoundUsdcAsset.main()).to.equal(main.address)
      expect(await compoundUsdcAsset.isCollateral()).to.equal(true)
      expect(await compoundUsdcAsset.erc20()).to.equal(usdc.address)
      expect(await compoundUsdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await compoundUsdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await compoundUsdcAsset.refPerTok()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.price()).to.equal(fp('1'))
    })

    it('Should calculate prices correctly', async function () {
      // Check initial prices
      expect(await compoundTokenAsset.price()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.price()).to.equal(fp('1'))

      // Update values in Oracle increase by 10%
      let symbol: string = await token.symbol()
      await compoundOracleInternal.setPrice(symbol, bn('1.1e6')) // 10%
      symbol = await usdc.symbol()
      await compoundOracleInternal.setPrice(symbol, bn('1.1e6')) // 10%

      // Check new prices
      expect(await compoundTokenAsset.price()).to.equal(fp('1.1'))
      expect(await compoundUsdcAsset.price()).to.equal(fp('1.1'))

      // Revert if price is zero - Update Oracles and check prices
      // Fiat token
      symbol = await token.symbol()
      await compoundOracleInternal.setPrice(symbol, bn(0))
      await expect(compoundTokenAsset.price()).to.be.revertedWith(`PriceIsZero("${symbol}")`)

      // Usdc (6 decimals)
      symbol = await usdc.symbol()
      await compoundOracleInternal.setPrice(symbol, bn(0))
      await expect(compoundUsdcAsset.price()).to.be.revertedWith(`PriceIsZero("${symbol}")`)
    })
  })
})

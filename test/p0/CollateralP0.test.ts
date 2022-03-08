import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveClaimAdapterP0,
  AaveOracleMockP0,
  ATokenFiatCollateralP0,
  BackingManagerP0,
  CompoundClaimAdapterP0,
  CompoundOracleMockP0,
  CompoundPricedFiatCollateralP0,
  ComptrollerMockP0,
  CTokenFiatCollateralP0,
  CTokenMock,
  ERC20Mock,
  FacadeP0,
  IssuerP0,
  StaticATokenMock,
  USDCMock,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

describe('CollateralP0 contracts', () => {
  let owner: SignerWithAddress

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let aaveToken: ERC20Mock
  let compToken: ERC20Mock

  // Assets
  let tokenCollateral: Collateral
  let usdcCollateral: Collateral
  let aTokenCollateral: ATokenFiatCollateralP0
  let cTokenCollateral: CTokenFiatCollateralP0

  // Aave / Compound
  let compoundMock: ComptrollerMockP0
  let compoundOracleInternal: CompoundOracleMockP0
  let compoundClaimer: CompoundClaimAdapterP0
  let aaveOracleInternal: AaveOracleMockP0
  let aaveClaimer: AaveClaimAdapterP0

  // Config
  let config: IConfig

  // Main
  let backingManager: BackingManagerP0
  let issuer: IssuerP0

  // Facade
  let facade: FacadeP0

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
    ;({
      compToken,
      compoundMock,
      compoundOracleInternal,
      aaveToken,
      aaveOracleInternal,
      basket,
      config,
      backingManager,
      issuer,
      facade,
      compoundClaimer,
      aaveClaimer,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenCollateral = basket[0]
    usdcCollateral = basket[1]
    aTokenCollateral = basket[2] as ATokenFiatCollateralP0
    cTokenCollateral = basket[3] as CTokenFiatCollateralP0
    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenCollateral.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcCollateral.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenCollateral.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenCollateral.erc20())
  })

  describe('Deployment', () => {
    it('Deployment should setup collateral correctly', async () => {
      // Fiat Token Asset
      expect(await tokenCollateral.isCollateral()).to.equal(true)
      expect(await tokenCollateral.referenceERC20()).to.equal(token.address)
      expect(await tokenCollateral.erc20()).to.equal(token.address)
      expect(await token.decimals()).to.equal(18)
      expect(await tokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await tokenCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await tokenCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await tokenCollateral.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await tokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await tokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await tokenCollateral.toQ(bn('1'))).to.equal(fp('1'))
      expect(await tokenCollateral.fromQ(fp('1'))).to.equal(bn('1'))
      expect(await tokenCollateral.claimAdapter()).to.equal(ZERO_ADDRESS)
      expect(await tokenCollateral.price()).to.equal(fp('1'))

      // USDC Fiat Token
      expect(await usdcCollateral.isCollateral()).to.equal(true)
      expect(await usdcCollateral.referenceERC20()).to.equal(usdc.address)
      expect(await usdcCollateral.erc20()).to.equal(usdc.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await usdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await usdcCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await usdcCollateral.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await usdcCollateral.toQ(bn('1'))).to.equal(bn('1e6'))
      expect(await usdcCollateral.fromQ(bn('1e6'))).to.equal(bn('1'))
      expect(await usdcCollateral.claimAdapter()).to.equal(ZERO_ADDRESS)
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await usdcCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await usdcCollateral.price()).to.equal(fp('1'))

      // AToken
      expect(await aTokenCollateral.isCollateral()).to.equal(true)
      expect(await aTokenCollateral.referenceERC20()).to.equal(token.address)
      expect(await aTokenCollateral.erc20()).to.equal(aToken.address)
      expect(await aToken.decimals()).to.equal(18)
      expect(await aTokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await aTokenCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await aTokenCollateral.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await aTokenCollateral.toQ(bn('1'))).to.equal(fp('1'))
      expect(await aTokenCollateral.fromQ(fp('1'))).to.equal(bn('1'))
      expect(await aTokenCollateral.claimAdapter()).to.equal(aaveClaimer.address)
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await aTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await aTokenCollateral.prevReferencePrice()).to.equal(
        await aTokenCollateral.refPerTok()
      )
      expect(await aTokenCollateral.price()).to.equal(fp('1'))

      // CToken
      expect(await cTokenCollateral.isCollateral()).to.equal(true)
      expect(await cTokenCollateral.referenceERC20()).to.equal(token.address)
      expect(await cTokenCollateral.erc20()).to.equal(cToken.address)
      expect(await cToken.decimals()).to.equal(8)
      expect(await cTokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await cTokenCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await cTokenCollateral.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await cTokenCollateral.toQ(bn('1'))).to.equal(bn('1e8'))
      expect(await cTokenCollateral.fromQ(bn('1e8'))).to.equal(bn('1'))
      expect(await cTokenCollateral.claimAdapter()).to.equal(compoundClaimer.address)
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await cTokenCollateral.prevReferencePrice()).to.equal(
        await cTokenCollateral.refPerTok()
      )
      expect(await cTokenCollateral.price()).to.equal(fp('1'))
    })
  })

  describe('Prices', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      expect(await tokenCollateral.price()).to.equal(fp('1'))
      expect(await usdcCollateral.price()).to.equal(fp('1'))
      expect(await aTokenCollateral.price()).to.equal(fp('1'))
      expect(await cTokenCollateral.price()).to.equal(fp('1'))

      // Check refPerTok initial values
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('1'))

      // Update values in Oracles increase by 10-20%
      await aaveOracleInternal.setPrice(token.address, bn('2.75e14')) // 10%
      await aaveOracleInternal.setPrice(usdc.address, bn('2.75e14')) // 10%
      await compoundOracleInternal.setPrice(await token.symbol(), bn('1.1e6')) // 10%

      // Check new prices
      expect(await tokenCollateral.price()).to.equal(fp('1.1'))
      expect(await usdcCollateral.price()).to.equal(fp('1.1'))
      expect(await aTokenCollateral.price()).to.equal(fp('1.1'))
      expect(await cTokenCollateral.price()).to.equal(fp('1.1'))

      // Check refPerTok remains the same
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('1'))

      // Check RToken price
      expect(await issuer.rTokenPrice()).to.equal(fp('1.1'))
    })

    it('Should calculate price correctly when ATokens and CTokens appreciate', async () => {
      // Check initial prices
      expect(await aTokenCollateral.price()).to.equal(fp('1'))
      expect(await cTokenCollateral.price()).to.equal(fp('1'))

      // Check refPerTok initial values
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('1'))

      // Increase rate for Ctoken and AToken to double
      await aToken.setExchangeRate(fp(2))
      await cToken.setExchangeRate(fp(2))

      // Check prices doubled
      expect(await aTokenCollateral.price()).to.equal(fp('2'))
      expect(await cTokenCollateral.price()).to.equal(fp('2'))

      // RefPerTok also doubles in this case
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('2'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('2'))

      // Check RToken price - Remains the same until Revenues are processed
      expect(await issuer.rTokenPrice()).to.equal(fp('1'))
    })

    it('Should revert if price is zero', async () => {
      const symbol: string = await token.symbol()

      // Set price of token to 0 in Aave
      await aaveOracleInternal.setPrice(token.address, bn('0'))

      // Check price of token
      await expect(tokenCollateral.price()).to.be.revertedWith(`PriceIsZero("${symbol}")`)
    })
  })

  describe('Status', () => {
    it('Should maintain status in normal situations', async () => {
      // Check initial state
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Force updates (with no changes)
      await expect(tokenCollateral.forceUpdates()).to.not.emit(
        tokenCollateral,
        'DefaultStatusChanged'
      )
      await expect(usdcCollateral.forceUpdates()).to.not.emit(
        usdcCollateral,
        'DefaultStatusChanged'
      )
      await expect(aTokenCollateral.forceUpdates()).to.not.emit(
        aTokenCollateral,
        'DefaultStatusChanged'
      )
      await expect(cTokenCollateral.forceUpdates()).to.not.emit(
        cTokenCollateral,
        'DefaultStatusChanged'
      )

      // State remains the same
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
    })

    it('Updates status in case of soft default', async () => {
      const delayUntilDefault: BigNumber = await tokenCollateral.delayUntilDefault()

      // Check initial state
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      // Should also impact on the aToken and cToken
      await aaveOracleInternal.setPrice(token.address, bn('2e14')) // -20%
      await compoundOracleInternal.setPrice(await token.symbol(), bn('0.8e6')) // -20%

      // Force updates - Should update whenDefault and status
      let expectedDefaultTimestamp: BigNumber

      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp())
        .add(1)
        .add(delayUntilDefault)
      await expect(tokenCollateral.forceUpdates())
        .to.emit(tokenCollateral, 'DefaultStatusChanged')
        .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.IFFY)
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await tokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      await expect(usdcCollateral.forceUpdates()).to.not.emit(
        usdcCollateral,
        'DefaultStatusChanged'
      )
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp())
        .add(1)
        .add(delayUntilDefault)
      await expect(aTokenCollateral.forceUpdates())
        .to.emit(aTokenCollateral, 'DefaultStatusChanged')
        .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.IFFY)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await aTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp())
        .add(1)
        .add(delayUntilDefault)
      await expect(cTokenCollateral.forceUpdates())
        .to.emit(cTokenCollateral, 'DefaultStatusChanged')
        .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.IFFY)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await cTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to forceUpdates after default for ATokens/CTokens
      // AToken
      let prevWhenDefault: BigNumber = await aTokenCollateral.whenDefault()
      await expect(aTokenCollateral.forceUpdates()).to.not.emit(
        aTokenCollateral,
        'DefaultStatusChanged'
      )
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await aTokenCollateral.whenDefault()).to.equal(prevWhenDefault)

      // CToken
      prevWhenDefault = await cTokenCollateral.whenDefault()
      await expect(cTokenCollateral.forceUpdates()).to.not.emit(
        cTokenCollateral,
        'DefaultStatusChanged'
      )
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await cTokenCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Updates status in case of hard default', async () => {
      // Check initial state
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for AToken and CToken, will disable collateral immediately
      await aToken.setExchangeRate(fp('0.99'))
      await cToken.setExchangeRate(fp('0.95'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(tokenCollateral.forceUpdates()).to.not.emit(
        tokenCollateral,
        'DefaultStatusChanged'
      )
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      await expect(usdcCollateral.forceUpdates()).to.not.emit(
        usdcCollateral,
        'DefaultStatusChanged'
      )
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      let expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(1)
      await expect(aTokenCollateral.forceUpdates())
        .to.emit(aTokenCollateral, 'DefaultStatusChanged')
        .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.DISABLED)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await aTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp()).add(1)
      await expect(cTokenCollateral.forceUpdates())
        .to.emit(cTokenCollateral, 'DefaultStatusChanged')
        .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.DISABLED)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await cTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
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
      await compoundMock.connect(owner).setCompToken(cTokenCollateral.address)
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
          await tokenCollateral.maxAuctionSize(),
          await tokenCollateral.defaultThreshold(),
          await tokenCollateral.delayUntilDefault(),
          await compoundMock.address
        )
      )
      compoundUsdcAsset = <CompoundPricedFiatCollateralP0>(
        await CompoundFiatCollFactory.deploy(
          usdc.address,
          await usdcCollateral.maxAuctionSize(),
          await usdcCollateral.defaultThreshold(),
          await usdcCollateral.delayUntilDefault(),
          compoundMock.address
        )
      )
    })

    it('Should setup collateral correctly', async function () {
      // Compound - Fiat Token Asset
      expect(await compoundTokenAsset.isCollateral()).to.equal(true)
      expect(await compoundTokenAsset.referenceERC20()).to.equal(token.address)
      expect(await compoundTokenAsset.erc20()).to.equal(token.address)
      expect(await token.decimals()).to.equal(18)
      expect(await compoundTokenAsset.targetName()).to.equal(
        ethers.utils.formatBytes32String('USD')
      )
      expect(await compoundTokenAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await compoundTokenAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await compoundTokenAsset.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await compoundTokenAsset.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await compoundTokenAsset.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await compoundTokenAsset.refPerTok()).to.equal(fp('1'))
      expect(await compoundTokenAsset.targetPerRef()).to.equal(fp('1'))
      expect(await compoundTokenAsset.pricePerTarget()).to.equal(fp('1'))
      expect(await compoundTokenAsset.toQ(bn('1'))).to.equal(fp('1'))
      expect(await compoundTokenAsset.fromQ(fp('1'))).to.equal(bn('1'))
      expect(await compoundTokenAsset.claimAdapter()).to.equal(ZERO_ADDRESS)
      expect(await compoundTokenAsset.price()).to.equal(fp('1'))

      // Compound - USDC Fiat Token
      expect(await compoundUsdcAsset.isCollateral()).to.equal(true)
      expect(await compoundUsdcAsset.referenceERC20()).to.equal(usdc.address)
      expect(await compoundUsdcAsset.erc20()).to.equal(usdc.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await compoundUsdcAsset.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await compoundUsdcAsset.status()).to.equal(CollateralStatus.SOUND)
      expect(await compoundUsdcAsset.whenDefault()).to.equal(MAX_UINT256)
      expect(await compoundUsdcAsset.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await compoundUsdcAsset.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await compoundUsdcAsset.maxAuctionSize()).to.equal(config.maxAuctionSize)
      expect(await compoundUsdcAsset.refPerTok()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.targetPerRef()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.pricePerTarget()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.toQ(bn('1'))).to.equal(bn('1e6'))
      expect(await compoundUsdcAsset.fromQ(bn('1e6'))).to.equal(bn('1'))
      expect(await compoundUsdcAsset.claimAdapter()).to.equal(ZERO_ADDRESS)
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

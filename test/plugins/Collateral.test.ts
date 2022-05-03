import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveLendingPoolMock,
  AaveOracleMock,
  AavePricedFiatCollateral,
  ATokenFiatCollateral,
  BackingManagerP0,
  CompoundOracleMock,
  CompoundPricedFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeP0,
  TestIRToken,
  StaticATokenMock,
  USDCMock,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp, setNextBlockTimestamp } from '../utils/time'
import snapshotGasCost from '../utils/snapshotGasCost'
import { Collateral, defaultFixture, IConfig } from '../fixtures'

const createFixtureLoader = waffle.createFixtureLoader

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const describeGas = process.env.REPORT_GAS ? describe : describe.skip

describe('Collateral contracts', () => {
  let owner: SignerWithAddress

  let rToken: TestIRToken

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let aaveToken: ERC20Mock
  let compToken: ERC20Mock

  // Assets
  let tokenCollateral: AavePricedFiatCollateral
  let usdcCollateral: AavePricedFiatCollateral
  let aTokenCollateral: ATokenFiatCollateral
  let cTokenCollateral: CTokenFiatCollateral

  // Aave / Compound
  let compoundMock: ComptrollerMock
  let compoundOracleInternal: CompoundOracleMock
  let aaveMock: AaveLendingPoolMock
  let aaveOracleInternal: AaveOracleMock

  // Config
  let config: IConfig

  // Main
  let backingManager: BackingManagerP0

  // Facade
  let facade: FacadeP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const amt = fp('1e18')

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
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
      aaveMock,
      aaveToken,
      aaveOracleInternal,
      basket,
      config,
      backingManager,
      rToken,
      facade,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenCollateral = <AavePricedFiatCollateral>basket[0]
    usdcCollateral = <AavePricedFiatCollateral>basket[1]
    aTokenCollateral = <ATokenFiatCollateral>basket[2]
    cTokenCollateral = <CTokenFiatCollateral>basket[3]
    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenCollateral.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcCollateral.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenCollateral.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenCollateral.erc20())

    await token.connect(owner).mint(owner.address, amt)
    await usdc.connect(owner).mint(owner.address, amt.div(bn('1e12')))
    await aToken.connect(owner).mint(owner.address, amt)
    await cToken.connect(owner).mint(owner.address, amt.div(bn('1e10')))
  })

  describe('Deployment', () => {
    it('Deployment should setup collateral correctly #fast', async () => {
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
      expect(await tokenCollateral.maxTradeVolume()).to.equal(config.maxTradeVolume)
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await tokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await tokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await tokenCollateral.bal(owner.address)).to.equal(amt)
      expect(await tokenCollateral.price()).to.equal(fp('1'))
      expect(await tokenCollateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await tokenCollateral.rewardERC20()).to.equal(ZERO_ADDRESS)

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
      expect(await usdcCollateral.maxTradeVolume()).to.equal(config.maxTradeVolume)
      expect(await usdcCollateral.bal(owner.address)).to.equal(amt)
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await usdcCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await usdcCollateral.price()).to.equal(fp('1'))
      expect(await usdcCollateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await usdcCollateral.rewardERC20()).to.equal(ZERO_ADDRESS)

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
      expect(await aTokenCollateral.maxTradeVolume()).to.equal(config.maxTradeVolume)
      expect(await aTokenCollateral.bal(owner.address)).to.equal(amt)
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await aTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await aTokenCollateral.prevReferencePrice()).to.equal(
        await aTokenCollateral.refPerTok()
      )
      expect(await aTokenCollateral.price()).to.equal(fp('1'))
      let calldata = aToken.interface.encodeFunctionData('claimRewardsToSelf', [true])
      expect(await aTokenCollateral.getClaimCalldata()).to.eql([aToken.address, calldata])
      expect(await aTokenCollateral.rewardERC20()).to.equal(aaveToken.address)

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
      expect(await cTokenCollateral.maxTradeVolume()).to.equal(config.maxTradeVolume)
      expect(await cTokenCollateral.bal(owner.address)).to.equal(amt)
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await cTokenCollateral.prevReferencePrice()).to.equal(
        await cTokenCollateral.refPerTok()
      )
      expect(await cTokenCollateral.price()).to.equal(fp('1'))
      calldata = compoundMock.interface.encodeFunctionData('claimComp', [owner.address])
      expect(await cTokenCollateral.connect(owner).getClaimCalldata()).to.eql([
        compoundMock.address,
        calldata,
      ])
      expect(await cTokenCollateral.rewardERC20()).to.equal(compToken.address)
    })

    it('Should not allow to initialize Collareral twice', async () => {
      await expect(
        tokenCollateral.init(
          token.address,
          config.maxTradeVolume,
          fp('0.05'),
          bn('86400'),
          compoundMock.address,
          aaveMock.address
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')

      await expect(
        usdcCollateral.init(
          usdc.address,
          config.maxTradeVolume,
          fp('0.05'),
          bn('86400'),
          compoundMock.address,
          aaveMock.address
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')

      await expect(
        aTokenCollateral.init(
          aToken.address,
          config.maxTradeVolume,
          fp('0.05'),
          bn('86400'),
          token.address,
          compoundMock.address,
          aaveMock.address,
          aaveToken.address
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')

      await expect(
        cTokenCollateral.init(
          cToken.address,
          config.maxTradeVolume,
          fp('0.05'),
          bn('86400'),
          token.address,
          compoundMock.address,
          compToken.address
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')
    })
  })

  describe('Prices #fast', () => {
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
      expect(await rToken.price()).to.equal(fp('1.1'))
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
      expect(await rToken.price()).to.equal(fp('1'))
    })

    it('Should revert if price is zero', async () => {
      // Set price of token to 0 in Aave
      await aaveOracleInternal.setPrice(token.address, bn('0'))

      // Check price of token
      await expect(tokenCollateral.price()).to.be.revertedWith('PriceIsZero()')
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

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

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

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      expectedDefaultTimestamp = bn(await getLatestBlockTimestamp())
        .add(1)
        .add(delayUntilDefault)
      await expect(aTokenCollateral.forceUpdates())
        .to.emit(aTokenCollateral, 'DefaultStatusChanged')
        .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.IFFY)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await aTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

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

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      let expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(1)
      await expect(aTokenCollateral.forceUpdates())
        .to.emit(aTokenCollateral, 'DefaultStatusChanged')
        .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.DISABLED)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await aTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

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
  describe('Compound Fiat Collateral #fast', () => {
    let compoundTokenAsset: CompoundPricedFiatCollateral
    let compoundUsdcAsset: CompoundPricedFiatCollateral

    beforeEach(async () => {
      const CompoundFiatCollFactory: ContractFactory = await ethers.getContractFactory(
        'CompoundPricedFiatCollateral'
      )
      compoundTokenAsset = <CompoundPricedFiatCollateral>(
        await CompoundFiatCollFactory.deploy(
          token.address,
          await tokenCollateral.maxTradeVolume(),
          await tokenCollateral.defaultThreshold(),
          await tokenCollateral.delayUntilDefault(),
          await compoundMock.address
        )
      )
      compoundUsdcAsset = <CompoundPricedFiatCollateral>(
        await CompoundFiatCollFactory.deploy(
          usdc.address,
          await usdcCollateral.maxTradeVolume(),
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
      expect(await compoundTokenAsset.maxTradeVolume()).to.equal(config.maxTradeVolume)
      expect(await compoundTokenAsset.refPerTok()).to.equal(fp('1'))
      expect(await compoundTokenAsset.targetPerRef()).to.equal(fp('1'))
      expect(await compoundTokenAsset.pricePerTarget()).to.equal(fp('1'))
      expect(await compoundTokenAsset.bal(owner.address)).to.equal(amt)
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
      expect(await compoundUsdcAsset.maxTradeVolume()).to.equal(config.maxTradeVolume)
      expect(await compoundUsdcAsset.refPerTok()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.targetPerRef()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.pricePerTarget()).to.equal(fp('1'))
      expect(await compoundUsdcAsset.bal(owner.address)).to.equal(amt)
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
      await expect(compoundTokenAsset.price()).to.be.revertedWith('PriceIsZero()')

      // Usdc (6 decimals)
      symbol = await usdc.symbol()
      await compoundOracleInternal.setPrice(symbol, bn(0))
      await expect(compoundUsdcAsset.price()).to.be.revertedWith('PriceIsZero()')
    })
  })

  describeGas('Gas Reporting', () => {
    it('Force Updates - Soft Default', async function () {
      const delayUntilDefault: BigNumber = await tokenCollateral.delayUntilDefault()

      // Depeg one of the underlying tokens - Reducing price 20%
      // Should also impact on the aToken and cToken
      await aaveOracleInternal.setPrice(token.address, bn('2e14')) // -20%
      await compoundOracleInternal.setPrice(await token.symbol(), bn('0.8e6')) // -20%

      // Force updates - Should update whenDefault and status
      await snapshotGasCost(tokenCollateral.forceUpdates())
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Force updates - Nothing occurs
      await snapshotGasCost(usdcCollateral.forceUpdates())
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('Force Updates - Hard Default - ATokens/CTokens', async function () {
      // Decrease rate for AToken and CToken, will disable collateral immediately
      await aToken.setExchangeRate(fp('0.99'))
      await cToken.setExchangeRate(fp('0.95'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await snapshotGasCost(aTokenCollateral.forceUpdates())
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)

      await snapshotGasCost(cTokenCollateral.forceUpdates())
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  })
})

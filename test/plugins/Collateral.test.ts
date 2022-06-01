import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveLendingAddrProviderMock,
  AaveLendingPoolMock,
  AaveOracleMock,
  AavePricedFiatCollateral,
  ATokenFiatCollateral,
  CompoundOracleMock,
  CompoundPricedFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  Facade,
  InvalidAaveOracleMock,
  InvalidCompoundOracleMock,
  StaticATokenMock,
  TestIBackingManager,
  TestIMain,
  TestIRToken,
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
  let aaveOracleInternal: AaveOracleMock

  // Config
  let config: IConfig

  // Main
  let backingManager: TestIBackingManager

  // Facade
  let facade: Facade
  let main: TestIMain

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
      aaveToken,
      aaveOracleInternal,
      basket,
      config,
      backingManager,
      rToken,
      facade,
      main,
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
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))
      expect(await cTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await cTokenCollateral.prevReferencePrice()).to.equal(
        await cTokenCollateral.refPerTok()
      )
      expect(await cTokenCollateral.price()).to.equal(fp('0.02'))
      calldata = compoundMock.interface.encodeFunctionData('claimComp', [owner.address])
      expect(await cTokenCollateral.connect(owner).getClaimCalldata()).to.eql([
        compoundMock.address,
        calldata,
      ])
      expect(await cTokenCollateral.rewardERC20()).to.equal(compToken.address)
    })
  })

  describe('Prices #fast', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      expect(await tokenCollateral.price()).to.equal(fp('1'))
      expect(await usdcCollateral.price()).to.equal(fp('1'))
      expect(await aTokenCollateral.price()).to.equal(fp('1'))
      expect(await cTokenCollateral.price()).to.equal(fp('0.02'))

      // Check refPerTok initial values
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))

      // Update values in Oracles increase by 10-20%
      await aaveOracleInternal.setPrice(token.address, bn('2.75e14')) // 10%
      await aaveOracleInternal.setPrice(usdc.address, bn('2.75e14')) // 10%
      await compoundOracleInternal.setPrice(await token.symbol(), bn('1.1e6')) // 10%

      // Check new prices
      expect(await tokenCollateral.price()).to.equal(fp('1.1'))
      expect(await usdcCollateral.price()).to.equal(fp('1.1'))
      expect(await aTokenCollateral.price()).to.equal(fp('1.1'))
      expect(await cTokenCollateral.price()).to.equal(fp('0.022'))

      // Check refPerTok remains the same
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))

      // Check RToken price
      expect(await rToken.price()).to.equal(fp('1.1'))
    })

    it('Should calculate price correctly when ATokens and CTokens appreciate', async () => {
      // Check initial prices
      expect(await aTokenCollateral.price()).to.equal(fp('1'))
      expect(await cTokenCollateral.price()).to.equal(fp('0.02'))

      // Check refPerTok initial values
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))

      // Increase rate for Ctoken and AToken to double
      await aToken.setExchangeRate(fp(2))
      await cToken.setExchangeRate(fp(2))

      // Check prices doubled
      expect(await aTokenCollateral.price()).to.equal(fp('2'))
      expect(await cTokenCollateral.price()).to.equal(fp('0.04'))

      // RefPerTok also doubles in this case
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('2'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.04'))

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
      await expect(tokenCollateral.refresh()).to.not.emit(tokenCollateral, 'DefaultStatusChanged')
      await expect(usdcCollateral.refresh()).to.not.emit(usdcCollateral, 'DefaultStatusChanged')
      await expect(aTokenCollateral.refresh()).to.not.emit(aTokenCollateral, 'DefaultStatusChanged')
      await expect(cTokenCollateral.refresh()).to.not.emit(cTokenCollateral, 'DefaultStatusChanged')

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

      await expect(usdcCollateral.refresh()).to.not.emit(usdcCollateral, 'DefaultStatusChanged')
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      const softDefaultCollaterals = [tokenCollateral, aTokenCollateral, cTokenCollateral]
      for (const coll of softDefaultCollaterals) {
        // Set next block timestamp - for deterministic result
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

        expectedDefaultTimestamp = bn(await getLatestBlockTimestamp())
          .add(1)
          .add(delayUntilDefault)

        await expect(coll.refresh())
          .to.emit(coll, 'DefaultStatusChanged')
          .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.IFFY)
        expect(await coll.status()).to.equal(CollateralStatus.IFFY)
        expect(await coll.whenDefault()).to.equal(expectedDefaultTimestamp)
      }

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default for ATokens/CTokens
      // AToken
      let prevWhenDefault: BigNumber = await aTokenCollateral.whenDefault()
      await expect(aTokenCollateral.refresh()).to.not.emit(aTokenCollateral, 'DefaultStatusChanged')
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await aTokenCollateral.whenDefault()).to.equal(prevWhenDefault)

      // CToken
      prevWhenDefault = await cTokenCollateral.whenDefault()
      await expect(cTokenCollateral.refresh()).to.not.emit(cTokenCollateral, 'DefaultStatusChanged')
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
      await expect(tokenCollateral.refresh()).to.not.emit(tokenCollateral, 'DefaultStatusChanged')
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      await expect(usdcCollateral.refresh()).to.not.emit(usdcCollateral, 'DefaultStatusChanged')
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      const hardDefaultCollaterals = [aTokenCollateral, cTokenCollateral]
      for (const coll of hardDefaultCollaterals) {
        // Set next block timestamp - for deterministic result
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(1)
        await expect(coll.refresh())
          .to.emit(coll, 'DefaultStatusChanged')
          .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.DISABLED)
        expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
        expect(await coll.whenDefault()).to.equal(expectedDefaultTimestamp)
      }
    })

    it('Updates status when price is zero', async () => {
      // Check initial state
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Set price of tokens to 0
      await aaveOracleInternal.setPrice(token.address, bn('0'))
      await compoundOracleInternal.setPrice(await token.symbol(), bn(0))

      const priceZeroCollaterals = [tokenCollateral, aTokenCollateral, cTokenCollateral]
      for (const coll of priceZeroCollaterals) {
        // Set next block timestamp - for deterministic result
        await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)
        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(1)

        await expect(coll.refresh())
          .to.emit(coll, 'DefaultStatusChanged')
          .withArgs(MAX_UINT256, expectedDefaultTimestamp, CollateralStatus.DISABLED)

        expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
        expect(await coll.whenDefault()).to.equal(expectedDefaultTimestamp)
      }
    })

    it('Reverts on update status when price function fails', async () => {
      // Deploy invalid Compound Oracle
      const InvalidCompoundOracleFactory: ContractFactory = await ethers.getContractFactory(
        'InvalidCompoundOracleMock'
      )
      const invalidCompoundOracle: InvalidCompoundOracleMock = <InvalidCompoundOracleMock>(
        await InvalidCompoundOracleFactory.deploy()
      )

      const ComptrollerMockFactory: ContractFactory = await ethers.getContractFactory(
        'ComptrollerMock'
      )
      const invalidCompoundMock: ComptrollerMock = <ComptrollerMock>(
        await ComptrollerMockFactory.deploy(invalidCompoundOracle.address)
      )

      // Deply invalid  AaveOracle
      const InvalidAaveOracleFactory: ContractFactory = await ethers.getContractFactory(
        'InvalidAaveOracleMock'
      )
      const invalidAaveOracle: InvalidAaveOracleMock = <InvalidAaveOracleMock>(
        await InvalidAaveOracleFactory.deploy(ZERO_ADDRESS)
      )

      const AaveAddrProviderFactory: ContractFactory = await ethers.getContractFactory(
        'AaveLendingAddrProviderMock'
      )
      const invalidAaveAddrProvider: AaveLendingAddrProviderMock = <AaveLendingAddrProviderMock>(
        await AaveAddrProviderFactory.deploy(invalidAaveOracle.address)
      )

      const AaveLendingPoolMockFactory: ContractFactory = await ethers.getContractFactory(
        'AaveLendingPoolMock'
      )
      const invalidAaveMock: AaveLendingPoolMock = <AaveLendingPoolMock>(
        await AaveLendingPoolMockFactory.deploy(invalidAaveAddrProvider.address)
      )

      // Deploy invalid collaterals to revert/fail
      const AaveFiatCollFactory: ContractFactory = await ethers.getContractFactory(
        'AavePricedFiatCollateral'
      )
      const invalidTokenAsset: AavePricedFiatCollateral = <AavePricedFiatCollateral>(
        await AaveFiatCollFactory.deploy(
          token.address,
          await tokenCollateral.maxTradeVolume(),
          await tokenCollateral.defaultThreshold(),
          await tokenCollateral.delayUntilDefault(),
          compoundMock.address,
          invalidAaveMock.address
        )
      )

      const ATokenFiatCollFactory: ContractFactory = await ethers.getContractFactory(
        'ATokenFiatCollateral'
      )
      const invalidATokenAsset: ATokenFiatCollateral = <ATokenFiatCollateral>(
        await ATokenFiatCollFactory.deploy(
          aToken.address,
          await aTokenCollateral.maxTradeVolume(),
          await aTokenCollateral.defaultThreshold(),
          await aTokenCollateral.delayUntilDefault(),
          await aTokenCollateral.referenceERC20(),
          compoundMock.address,
          invalidAaveMock.address,
          await aTokenCollateral.rewardERC20()
        )
      )

      const CTokenFiatCollFactory: ContractFactory = await ethers.getContractFactory(
        'CTokenFiatCollateral'
      )
      const invalidCTokenAsset: CTokenFiatCollateral = <CTokenFiatCollateral>(
        await CTokenFiatCollFactory.deploy(
          cToken.address,
          await cTokenCollateral.maxTradeVolume(),
          await cTokenCollateral.defaultThreshold(),
          await cTokenCollateral.delayUntilDefault(),
          await cTokenCollateral.referenceERC20(),
          invalidCompoundMock.address,
          await cTokenCollateral.rewardERC20()
        )
      )

      const invalidCollaterals = [invalidTokenAsset, invalidATokenAsset, invalidCTokenAsset]
      for (const coll of invalidCollaterals) {
        // Check initial state
        expect(await coll.status()).to.equal(CollateralStatus.SOUND)
        expect(await coll.whenDefault()).to.equal(MAX_UINT256)

        // Attempt to update status - assertion failed (Panic)
        await invalidAaveOracle.setShouldFailAssert(true)
        await invalidCompoundOracle.setShouldFailAssert(true)
        await expect(coll.refresh()).to.be.reverted

        // No changes
        expect(await coll.status()).to.equal(CollateralStatus.SOUND)
        expect(await coll.whenDefault()).to.equal(MAX_UINT256)

        // Attempt to update status - Revert
        await invalidAaveOracle.setShouldFailAssert(false)
        await invalidCompoundOracle.setShouldFailAssert(false)
        await expect(coll.refresh()).to.be.reverted

        // No changes
        expect(await coll.status()).to.equal(CollateralStatus.SOUND)
        expect(await coll.whenDefault()).to.equal(MAX_UINT256)
      }
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
      await facade.claimRewards(main.address)

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
      await expect(facade.claimRewards(main.address)).to.be.revertedWith('rewards claim failed')

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
          compoundMock.address
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
      await snapshotGasCost(tokenCollateral.refresh())
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Adance half the delay
      await advanceTime(Number(delayUntilDefault.div(2)) + 1)

      // Force updates - Nothing occurs
      await snapshotGasCost(tokenCollateral.refresh())
      await snapshotGasCost(usdcCollateral.refresh())
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Adance the other half
      await advanceTime(Number(delayUntilDefault.div(2)) + 1)

      // Move time forward past delayUntilDefault
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('Force Updates - Hard Default - ATokens/CTokens', async function () {
      // Decrease rate for AToken and CToken, will disable collateral immediately
      await aToken.setExchangeRate(fp('0.99'))
      await cToken.setExchangeRate(fp('0.95'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await snapshotGasCost(aTokenCollateral.refresh())
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)

      await snapshotGasCost(cTokenCollateral.refresh())
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  })
})

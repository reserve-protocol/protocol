import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenNonFiatCollateral,
  CTokenMock,
  CTokenSelfReferentialCollateral,
  ERC20Mock,
  EURFiatCollateral,
  FacadeTest,
  FiatCollateral,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  NonFiatCollateral,
  OracleLib,
  RTokenAsset,
  SelfReferentialCollateral,
  StaticATokenMock,
  TestIBackingManager,
  TestIRToken,
  USDCMock,
  WETH9,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp, setNextBlockTimestamp } from '../utils/time'
import snapshotGasCost from '../utils/snapshotGasCost'
import { setInvalidOracleTimestamp, setOraclePrice } from '../utils/oracles'
import { Collateral, defaultFixture, ORACLE_TIMEOUT } from '../fixtures'

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
  let tokenCollateral: FiatCollateral
  let usdcCollateral: FiatCollateral
  let aTokenCollateral: ATokenFiatCollateral
  let cTokenCollateral: CTokenFiatCollateral
  let rTokenAsset: RTokenAsset

  // Aave / Compound / Chainlink
  let compoundMock: ComptrollerMock

  // Config
  let config: IConfig

  // Main
  let backingManager: TestIBackingManager

  // Oracle
  let oracleLib: OracleLib

  // Facade
  let facadeTest: FacadeTest

  // Factories
  let FiatCollateralFactory: ContractFactory
  let ATokenFiatCollateralFactory: ContractFactory
  let CTokenFiatCollateralFactory: ContractFactory
  let InvalidMockV3AggregatorFactory: ContractFactory

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const amt = bn('100e18')

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
      aaveToken,
      basket,
      config,
      backingManager,
      rToken,
      facadeTest,
      oracleLib,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenCollateral = <FiatCollateral>basket[0]
    usdcCollateral = <FiatCollateral>basket[1]
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
    await cToken.connect(owner).mint(owner.address, amt.div(bn('1e10')).mul(50))

    // Issue RToken to enable RToken.price
    await token.connect(owner).approve(rToken.address, amt)
    await usdc.connect(owner).approve(rToken.address, amt.div(bn('1e12')))
    await aToken.connect(owner).approve(rToken.address, amt)
    await cToken.connect(owner).approve(rToken.address, amt.div(bn('1e10')).mul(50))
    await rToken.connect(owner).issue(amt)

    // Factories
    FiatCollateralFactory = await ethers.getContractFactory('FiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    ATokenFiatCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    CTokenFiatCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    InvalidMockV3AggregatorFactory = await ethers.getContractFactory('InvalidMockV3Aggregator')
  })

  describe('Deployment', () => {
    it('Deployment should setup collateral correctly #fast', async () => {
      // Fiat Token Asset
      expect(await tokenCollateral.isCollateral()).to.equal(true)
      expect(await tokenCollateral.erc20()).to.equal(token.address)
      expect(await token.decimals()).to.equal(18)
      expect(await tokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await tokenCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await tokenCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await tokenCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await tokenCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await tokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await tokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await tokenCollateral.bal(owner.address)).to.equal(amt.mul(3).div(4))
      expect(await tokenCollateral.strictPrice()).to.equal(fp('1'))
      await expect(tokenCollateral.claimRewards()).to.not.emit(tokenCollateral, 'RewardsClaimed')

      // USDC Fiat Token
      expect(await usdcCollateral.isCollateral()).to.equal(true)
      expect(await usdcCollateral.erc20()).to.equal(usdc.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await usdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await usdcCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await usdcCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await usdcCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await usdcCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await usdcCollateral.bal(owner.address)).to.equal(amt.mul(3).div(4))
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await usdcCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await usdcCollateral.strictPrice()).to.equal(fp('1'))
      await expect(usdcCollateral.claimRewards()).to.not.emit(usdcCollateral, 'RewardsClaimed')

      // AToken
      expect(await aTokenCollateral.isCollateral()).to.equal(true)
      expect(await aTokenCollateral.erc20()).to.equal(aToken.address)
      expect(await aToken.decimals()).to.equal(18)
      expect(await aTokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await aTokenCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await aTokenCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await aTokenCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await aTokenCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await aTokenCollateral.bal(owner.address)).to.equal(amt.mul(3).div(4))
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await aTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await aTokenCollateral.prevReferencePrice()).to.equal(
        await aTokenCollateral.refPerTok()
      )
      expect(await aTokenCollateral.strictPrice()).to.equal(fp('1'))
      await expect(aTokenCollateral.claimRewards())
        .to.emit(aTokenCollateral, 'RewardsClaimed')
        .withArgs(aaveToken.address, 0)

      // CToken
      expect(await cTokenCollateral.isCollateral()).to.equal(true)
      expect(await cTokenCollateral.referenceERC20Decimals()).to.equal(18)
      expect(await cTokenCollateral.erc20()).to.equal(cToken.address)
      expect(await cToken.decimals()).to.equal(8)
      expect(await cTokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await cTokenCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await cTokenCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await cTokenCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await cTokenCollateral.bal(owner.address)).to.equal(amt.mul(3).div(4).mul(50))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))
      expect(await cTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cTokenCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await cTokenCollateral.prevReferencePrice()).to.equal(
        await cTokenCollateral.refPerTok()
      )
      expect(await cTokenCollateral.strictPrice()).to.equal(fp('0.02'))
      await expect(cTokenCollateral.claimRewards())
        .to.emit(cTokenCollateral, 'RewardsClaimed')
        .withArgs(compToken.address, 0)
    })
  })

  describe('Constructor validation', () => {
    it('Should validate targetName correctly', async () => {
      await expect(
        FiatCollateralFactory.deploy(
          1,
          await tokenCollateral.chainlinkFeed(),
          token.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.constants.HashZero,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('targetName missing')
    })

    it('Should not allow missing defaultThreshold', async () => {
      // FiatCollateral
      await expect(
        FiatCollateralFactory.deploy(
          1,
          await tokenCollateral.chainlinkFeed(),
          token.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ATokenFiatCollateral
      await expect(
        ATokenFiatCollateralFactory.deploy(
          1,
          await aTokenCollateral.chainlinkFeed(),
          aToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // CTokenFiatCollateral
      await expect(
        CTokenFiatCollateralFactory.deploy(
          1,
          await cTokenCollateral.chainlinkFeed(),
          cToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          DELAY_UNTIL_DEFAULT,
          18,
          compoundMock.address
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })

    it('Should not allow missing delayUntilDefault', async () => {
      await expect(
        FiatCollateralFactory.deploy(
          1,
          await tokenCollateral.chainlinkFeed(),
          token.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          bn(0)
        )
      ).to.be.revertedWith('delayUntilDefault zero')

      // ATokenFiatCollateral
      await expect(
        ATokenFiatCollateralFactory.deploy(
          1,
          await aTokenCollateral.chainlinkFeed(),
          aToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          bn(0)
        )
      ).to.be.revertedWith('delayUntilDefault zero')

      // CTokenFiatCollateral
      await expect(
        CTokenFiatCollateralFactory.deploy(
          1,
          await cTokenCollateral.chainlinkFeed(),
          cToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          bn(0),
          18,
          compoundMock.address
        )
      ).to.be.revertedWith('delayUntilDefault zero')
    })

    it('Should not allow missing comptroller - CTokens', async () => {
      // CTokenFiatCollateral
      await expect(
        CTokenFiatCollateralFactory.deploy(
          1,
          await cTokenCollateral.chainlinkFeed(),
          cToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          18,
          ZERO_ADDRESS
        )
      ).to.be.revertedWith('comptroller missing')
    })
  })

  describe('Prices #fast', () => {
    it('Should calculate prices correctly', async () => {
      // Check initial prices
      expect(await tokenCollateral.strictPrice()).to.equal(fp('1'))
      expect(await usdcCollateral.strictPrice()).to.equal(fp('1'))
      expect(await aTokenCollateral.strictPrice()).to.equal(fp('1'))
      expect(await cTokenCollateral.strictPrice()).to.equal(fp('0.02'))

      // Check refPerTok initial values
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))

      // Update values in Oracles increase by 10-20%
      await setOraclePrice(tokenCollateral.address, bn('1.1e8')) // 10%
      await setOraclePrice(usdcCollateral.address, bn('1.1e8')) // 10%

      // Check new prices
      expect(await tokenCollateral.strictPrice()).to.equal(fp('1.1'))
      expect(await usdcCollateral.strictPrice()).to.equal(fp('1.1'))
      expect(await aTokenCollateral.strictPrice()).to.equal(fp('1.1'))
      expect(await cTokenCollateral.strictPrice()).to.equal(fp('0.022'))

      // Check refPerTok remains the same
      expect(await tokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await usdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))

      // Check RToken price
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1.1'))
    })

    it('Should calculate price correctly when ATokens and CTokens appreciate', async () => {
      // Check initial prices
      expect(await aTokenCollateral.strictPrice()).to.equal(fp('1'))
      expect(await cTokenCollateral.strictPrice()).to.equal(fp('0.02'))

      // Check refPerTok initial values
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('1'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.02'))

      // Increase rate for Ctoken and AToken to double
      await aToken.setExchangeRate(fp(2))
      await cToken.setExchangeRate(fp(2))

      // Check prices doubled
      expect(await aTokenCollateral.strictPrice()).to.equal(fp('2'))
      expect(await cTokenCollateral.strictPrice()).to.equal(fp('0.04'))

      // RefPerTok also doubles in this case
      expect(await aTokenCollateral.refPerTok()).to.equal(fp('2'))
      expect(await cTokenCollateral.refPerTok()).to.equal(fp('0.04'))

      // Check RToken price - Remains the same until Revenues are processed
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
    })

    it('Should revert if price is zero', async () => {
      // Set price of token to 0 in Aave
      await setOraclePrice(tokenCollateral.address, bn('0'))

      // Check price of token
      await expect(tokenCollateral.strictPrice()).to.be.revertedWith('PriceOutsideRange()')

      // Fallback price is returned
      const [isFallback, price] = await tokenCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // When refreshed, sets status to Unpriced
      await tokenCollateral.refresh()
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Should revert in case of invalid timestamp', async () => {
      await setInvalidOracleTimestamp(tokenCollateral.address)

      // Check price of token
      await expect(tokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // When refreshed, sets status to Unpriced
      await tokenCollateral.refresh()
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)
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
      await setOraclePrice(tokenCollateral.address, bn('8e7')) // -20%

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
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
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
          .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)
        expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
        expect(await coll.whenDefault()).to.equal(expectedDefaultTimestamp)
      }
    })

    it('Reverts if price is stale', async () => {
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Check new prices
      await expect(usdcCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(tokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(cTokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(aTokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
    })

    it('Enters IFFY state when price becomes stale', async () => {
      await advanceTime(ORACLE_TIMEOUT.toString())
      await usdcCollateral.refresh()
      await tokenCollateral.refresh()
      await cTokenCollateral.refresh()
      await aTokenCollateral.refresh()
      expect(await usdcCollateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await cTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      expect(await aTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status - Fiat', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidTokenCollateral: FiatCollateral = <FiatCollateral>(
        await FiatCollateralFactory.deploy(
          1,
          invalidChainlinkFeed.address,
          await tokenCollateral.erc20(),
          await tokenCollateral.maxTradeVolume(),
          await tokenCollateral.oracleTimeout(),
          await tokenCollateral.targetName(),
          await tokenCollateral.defaultThreshold(),
          await tokenCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status - ATokens Fiat', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
        await ATokenFiatCollateralFactory.deploy(
          1,
          invalidChainlinkFeed.address,
          await aTokenCollateral.erc20(),
          await aTokenCollateral.maxTradeVolume(),
          await aTokenCollateral.oracleTimeout(),
          await aTokenCollateral.targetName(),
          await aTokenCollateral.defaultThreshold(),
          await aTokenCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidATokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidATokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidATokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidATokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status - CTokens Fiat', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>(
        await CTokenFiatCollateralFactory.deploy(
          1,
          invalidChainlinkFeed.address,
          await cTokenCollateral.erc20(),
          await cTokenCollateral.maxTradeVolume(),
          await cTokenCollateral.oracleTimeout(),
          await cTokenCollateral.targetName(),
          await cTokenCollateral.defaultThreshold(),
          await cTokenCollateral.delayUntilDefault(),
          18,
          compoundMock.address
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
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
      await facadeTest.claimAndSweepRewards(rToken.address)

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
      await expect(facadeTest.claimAndSweepRewards(rToken.address)).to.be.revertedWith(
        'rewards claim failed'
      )

      // Check funds not yet swept
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
    })
  })

  // Tests specific to NonFiatCollateral.sol contract, not used by default in fixture
  describe('Non-fiat Collateral #fast', () => {
    let NonFiatCollFactory: ContractFactory
    let nonFiatCollateral: NonFiatCollateral
    let nonFiatToken: ERC20Mock
    let targetUnitOracle: MockV3Aggregator
    let referenceUnitOracle: MockV3Aggregator

    beforeEach(async () => {
      nonFiatToken = await (
        await ethers.getContractFactory('ERC20Mock')
      ).deploy('WBTC Token', 'WBTC')
      targetUnitOracle = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('20000e8')) // $20k
      )
      referenceUnitOracle = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8')) // 1 WBTC/BTC
      )

      NonFiatCollFactory = await ethers.getContractFactory('NonFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })

      nonFiatCollateral = <NonFiatCollateral>(
        await NonFiatCollFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          nonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      )

      // Mint some tokens
      await nonFiatToken.connect(owner).mint(owner.address, amt)
    })

    it('Should not allow missing defaultThreshold', async () => {
      await expect(
        NonFiatCollFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          nonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          bn(0),
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })

    it('Should not allow missing delayUntilDefault', async () => {
      await expect(
        NonFiatCollFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          nonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          bn(0)
        )
      ).to.be.revertedWith('delayUntilDefault zero')
    })

    it('Should not allow missing uoaPerTargetFeed', async () => {
      await expect(
        NonFiatCollFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          ZERO_ADDRESS,
          nonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('missing uoaPerTarget feed')
    })

    it('Should not allow missing targetPerRefFeed', async () => {
      await expect(
        NonFiatCollFactory.deploy(
          fp('20000'),
          ZERO_ADDRESS,
          targetUnitOracle.address,
          nonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('missing chainlink feed')
    })

    it('Should setup collateral correctly', async function () {
      // Non-Fiat Token
      expect(await nonFiatCollateral.isCollateral()).to.equal(true)
      expect(await nonFiatCollateral.uoaPerTargetFeed()).to.equal(targetUnitOracle.address)
      expect(await nonFiatCollateral.chainlinkFeed()).to.equal(referenceUnitOracle.address)
      expect(await nonFiatCollateral.erc20()).to.equal(nonFiatToken.address)
      expect(await nonFiatToken.decimals()).to.equal(18) // Due to Mock, wbtc has 8 decimals (covered in integration test)
      expect(await nonFiatCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('BTC'))
      // Get priceable info
      await nonFiatCollateral.refresh()
      expect(await nonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await nonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await nonFiatCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await nonFiatCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await nonFiatCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await nonFiatCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await nonFiatCollateral.bal(owner.address)).to.equal(amt)
      expect(await nonFiatCollateral.refPerTok()).to.equal(fp('1'))
      expect(await nonFiatCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await nonFiatCollateral.pricePerTarget()).to.equal(fp('20000'))
      expect(await nonFiatCollateral.strictPrice()).to.equal(fp('20000'))
      await expect(nonFiatCollateral.claimRewards()).to.not.emit(
        nonFiatCollateral,
        'RewardsClaimed'
      )
    })

    it('Should calculate prices correctly', async function () {
      // Check initial prices
      expect(await nonFiatCollateral.strictPrice()).to.equal(fp('20000'))

      // Update values in Oracle increase by 10%
      await targetUnitOracle.updateAnswer(bn('22000e8')) // $22k

      // Check new prices
      expect(await nonFiatCollateral.strictPrice()).to.equal(fp('22000'))

      // Revert if price is zero - Update Oracles and check prices
      await targetUnitOracle.updateAnswer(bn('0'))
      await expect(nonFiatCollateral.strictPrice()).to.be.revertedWith('PriceOutsideRange()')

      // When refreshed, sets status to Unpriced
      await nonFiatCollateral.refresh()
      expect(await nonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Restore price
      await targetUnitOracle.updateAnswer(bn('20000e8'))
      await nonFiatCollateral.refresh()
      expect(await nonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check the other oracle
      await referenceUnitOracle.updateAnswer(bn('0'))
      await expect(nonFiatCollateral.strictPrice()).to.be.revertedWith('PriceOutsideRange()')

      // When refreshed, sets status to Unpriced
      await nonFiatCollateral.refresh()
      expect(await nonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      let invalidNonFiatCollateral: NonFiatCollateral = <NonFiatCollateral>(
        await NonFiatCollFactory.deploy(
          fp('20000'),
          invalidChainlinkFeed.address,
          targetUnitOracle.address,
          nonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check with the other feed
      invalidNonFiatCollateral = <NonFiatCollateral>(
        await NonFiatCollFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          invalidChainlinkFeed.address,
          nonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Tests specific to CTokenNonFiatCollateral.sol contract, not used by default in fixture
  describe('CToken Non-fiat Collateral #fast', () => {
    let CTokenNonFiatFactory: ContractFactory
    let cTokenNonFiatCollateral: CTokenNonFiatCollateral
    let nonFiatToken: ERC20Mock
    let cNonFiatToken: CTokenMock
    let targetUnitOracle: MockV3Aggregator
    let referenceUnitOracle: MockV3Aggregator

    beforeEach(async () => {
      nonFiatToken = await (
        await ethers.getContractFactory('ERC20Mock')
      ).deploy('WBTC Token', 'WBTC')

      targetUnitOracle = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('20000e8')) // $20k
      )
      referenceUnitOracle = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8')) // 1 WBTC/BTC
      )
      // cToken
      cNonFiatToken = await (
        await ethers.getContractFactory('CTokenMock')
      ).deploy('cWBTC Token', 'cWBTC', nonFiatToken.address)

      CTokenNonFiatFactory = await ethers.getContractFactory('CTokenNonFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })

      cTokenNonFiatCollateral = <CTokenNonFiatCollateral>(
        await CTokenNonFiatFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          await nonFiatToken.decimals(),
          compoundMock.address
        )
      )

      // Mint some tokens
      await cNonFiatToken.connect(owner).mint(owner.address, amt.div(bn('1e10')))
    })

    it('Should not allow missing defaultThreshold', async () => {
      await expect(
        CTokenNonFiatFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          bn(0),
          DELAY_UNTIL_DEFAULT,
          18,
          compoundMock.address
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })

    it('Should not allow missing delayUntilDefault', async () => {
      await expect(
        CTokenNonFiatFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          bn(0),
          18,
          compoundMock.address
        )
      ).to.be.revertedWith('delayUntilDefault zero')
    })

    it('Should not allow missing refUnitChainlinkFeed', async () => {
      await expect(
        CTokenNonFiatFactory.deploy(
          fp('20000'),
          ZERO_ADDRESS,
          targetUnitOracle.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          18,
          compoundMock.address
        )
      ).to.be.revertedWith('missing chainlink feed')
    })

    it('Should not allow missing targetUnitChainlinkFeed', async () => {
      await expect(
        CTokenNonFiatFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          ZERO_ADDRESS,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          18,
          compoundMock.address
        )
      ).to.be.revertedWith('missing target unit chainlink feed')
    })

    it('Should not allow missing referenceERC20Decimals', async () => {
      await expect(
        CTokenNonFiatFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          0,
          compoundMock.address
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })

    it('Should not allow missing comptroller', async () => {
      await expect(
        CTokenNonFiatFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          targetUnitOracle.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          18,
          ZERO_ADDRESS
        )
      ).to.be.revertedWith('comptroller missing')
    })

    it('Should setup collateral correctly', async function () {
      // Non-Fiat Token
      expect(await cTokenNonFiatCollateral.isCollateral()).to.equal(true)
      expect(await cTokenNonFiatCollateral.targetUnitChainlinkFeed()).to.equal(
        targetUnitOracle.address
      )
      expect(await cTokenNonFiatCollateral.chainlinkFeed()).to.equal(referenceUnitOracle.address)
      expect(await cTokenNonFiatCollateral.referenceERC20Decimals()).to.equal(18)
      expect(await cTokenNonFiatCollateral.erc20()).to.equal(cNonFiatToken.address)
      expect(await cNonFiatToken.decimals()).to.equal(8)
      expect(await cTokenNonFiatCollateral.targetName()).to.equal(
        ethers.utils.formatBytes32String('BTC')
      )

      // Get priceable info
      await cTokenNonFiatCollateral.refresh()

      expect(await cTokenNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenNonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenNonFiatCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await cTokenNonFiatCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await cTokenNonFiatCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await cTokenNonFiatCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await cTokenNonFiatCollateral.bal(owner.address)).to.equal(amt)
      expect(await cTokenNonFiatCollateral.refPerTok()).to.equal(fp('0.02'))
      expect(await cTokenNonFiatCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cTokenNonFiatCollateral.pricePerTarget()).to.equal(fp('20000'))
      expect(await cTokenNonFiatCollateral.prevReferencePrice()).to.equal(
        await cTokenNonFiatCollateral.refPerTok()
      )

      expect(await cTokenNonFiatCollateral.strictPrice()).to.equal(fp('400')) // 0.02 of 20K
      await expect(cTokenNonFiatCollateral.claimRewards())
        .to.emit(cTokenNonFiatCollateral, 'RewardsClaimed')
        .withArgs(compToken.address, 0)
    })

    it('Should calculate prices correctly', async function () {
      expect(await cTokenNonFiatCollateral.strictPrice()).to.equal(fp('400'))

      // Check refPerTok initial values
      expect(await cTokenNonFiatCollateral.refPerTok()).to.equal(fp('0.02'))

      // Increase rate to double
      await cNonFiatToken.setExchangeRate(fp(2))

      // Check price doubled
      expect(await cTokenNonFiatCollateral.strictPrice()).to.equal(fp('800'))

      // RefPerTok also doubles in this case
      expect(await cTokenNonFiatCollateral.refPerTok()).to.equal(fp('0.04'))

      // Update values in Oracle increase by 10%
      await targetUnitOracle.updateAnswer(bn('22000e8')) // $22k

      // Check new price
      expect(await cTokenNonFiatCollateral.strictPrice()).to.equal(fp('880'))

      // Revert if price is zero - Update Oracles and check prices
      await targetUnitOracle.updateAnswer(bn('0'))
      await expect(cTokenNonFiatCollateral.strictPrice()).to.be.revertedWith('PriceOutsideRange()')

      // When refreshed, sets status to Unpriced
      await cTokenNonFiatCollateral.refresh()
      expect(await cTokenNonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)
      // Restore
      await targetUnitOracle.updateAnswer(bn('22000e8'))
      await cTokenNonFiatCollateral.refresh()
      expect(await cTokenNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Revert if price is zero - Update the other Oracle
      await referenceUnitOracle.updateAnswer(bn('0'))
      await expect(cTokenNonFiatCollateral.strictPrice()).to.be.revertedWith('PriceOutsideRange()')

      // When refreshed, sets status to Unpriced
      await cTokenNonFiatCollateral.refresh()
      expect(await cTokenNonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      let invalidCTokenNonFiatCollateral: CTokenNonFiatCollateral = <CTokenNonFiatCollateral>(
        await CTokenNonFiatFactory.deploy(
          fp('20000'),
          invalidChainlinkFeed.address,
          targetUnitOracle.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          18,
          compoundMock.address
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCTokenNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCTokenNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // With the second oracle
      invalidCTokenNonFiatCollateral = <CTokenNonFiatCollateral>(
        await CTokenNonFiatFactory.deploy(
          fp('20000'),
          referenceUnitOracle.address,
          invalidChainlinkFeed.address,
          cNonFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('BTC'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          18,
          compoundMock.address
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCTokenNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCTokenNonFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Tests specific to SelfReferentialCollateral.sol contract, not used by default in fixture
  describe('Self-Referential Collateral #fast', () => {
    let SelfRefCollateralFactory: ContractFactory
    let selfReferentialCollateral: SelfReferentialCollateral
    let selfRefToken: WETH9
    let chainlinkFeed: MockV3Aggregator
    beforeEach(async () => {
      selfRefToken = await (await ethers.getContractFactory('WETH9')).deploy()
      chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )

      SelfRefCollateralFactory = await ethers.getContractFactory('SelfReferentialCollateral')

      selfReferentialCollateral = <SelfReferentialCollateral>(
        await SelfRefCollateralFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          selfRefToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          DELAY_UNTIL_DEFAULT
        )
      )
    })

    it('Should setup collateral correctly', async function () {
      // Self-referential Collateral
      expect(await selfReferentialCollateral.isCollateral()).to.equal(true)
      expect(await selfReferentialCollateral.chainlinkFeed()).to.equal(chainlinkFeed.address)
      expect(await selfReferentialCollateral.erc20()).to.equal(selfRefToken.address)
      expect(await selfRefToken.decimals()).to.equal(18)
      expect(await selfReferentialCollateral.targetName()).to.equal(
        ethers.utils.formatBytes32String('ETH')
      )
      // Get priceable info
      await selfReferentialCollateral.refresh()
      expect(await selfReferentialCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await selfReferentialCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await selfReferentialCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await selfReferentialCollateral.bal(owner.address)).to.equal(0)
      expect(await selfReferentialCollateral.refPerTok()).to.equal(fp('1'))
      expect(await selfReferentialCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await selfReferentialCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await selfReferentialCollateral.strictPrice()).to.equal(fp('1'))
      await expect(selfReferentialCollateral.claimRewards()).to.not.emit(
        selfReferentialCollateral,
        'RewardsClaimed'
      )
    })

    it('Should calculate prices correctly', async function () {
      // Check initial prices
      expect(await selfReferentialCollateral.strictPrice()).to.equal(fp('1'))

      // Update values in Oracle increase by 10%
      await setOraclePrice(selfReferentialCollateral.address, bn('1.1e8'))

      // Check new prices
      expect(await selfReferentialCollateral.strictPrice()).to.equal(fp('1.1'))

      // Revert if price is zero - Update Oracles and check prices
      await setOraclePrice(selfReferentialCollateral.address, bn(0))
      await expect(selfReferentialCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // When refreshed, sets status to Unpriced
      await selfReferentialCollateral.refresh()
      expect(await selfReferentialCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Advance time
      const delayUntilDefault: BigNumber = await selfReferentialCollateral.delayUntilDefault()
      await advanceTime(Number(delayUntilDefault) + 1)

      // Refresh
      await selfReferentialCollateral.refresh()
      expect(await selfReferentialCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Another call would not change the state
      await selfReferentialCollateral.refresh()
      expect(await selfReferentialCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidSelfRefCollateral: SelfReferentialCollateral = <SelfReferentialCollateral>(
        await SelfRefCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          selfRefToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          DELAY_UNTIL_DEFAULT
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidSelfRefCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidSelfRefCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidSelfRefCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidSelfRefCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Tests specific to CTokenSelfReferentialCollateral.sol contract, not used by default in fixture
  describe('CToken Self-Referential Collateral #fast', () => {
    let CTokenSelfReferentialFactory: ContractFactory
    let cTokenSelfReferentialCollateral: CTokenSelfReferentialCollateral
    let selfRefToken: WETH9
    let cSelfRefToken: CTokenMock
    let chainlinkFeed: MockV3Aggregator

    beforeEach(async () => {
      selfRefToken = await (await ethers.getContractFactory('WETH9')).deploy()
      chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )

      // cToken Self Ref
      cSelfRefToken = await (
        await ethers.getContractFactory('CTokenMock')
      ).deploy('cETH Token', 'cETH', selfRefToken.address)

      CTokenSelfReferentialFactory = await ethers.getContractFactory(
        'CTokenSelfReferentialCollateral',
        {
          libraries: { OracleLib: oracleLib.address },
        }
      )

      cTokenSelfReferentialCollateral = <CTokenSelfReferentialCollateral>(
        await CTokenSelfReferentialFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          cSelfRefToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          DELAY_UNTIL_DEFAULT,
          await selfRefToken.decimals(),
          compoundMock.address
        )
      )

      // Mint some tokens
      await cSelfRefToken.connect(owner).mint(owner.address, amt.div(bn('1e10')))
    })

    it('Should not allow missing referenceERC20Decimals', async () => {
      await expect(
        CTokenSelfReferentialFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          cSelfRefToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          DELAY_UNTIL_DEFAULT,
          0,
          compoundMock.address
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })

    it('Should not allow missing comptroller', async () => {
      await expect(
        CTokenSelfReferentialFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          cSelfRefToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          DELAY_UNTIL_DEFAULT,
          18,
          ZERO_ADDRESS
        )
      ).to.be.revertedWith('comptroller missing')
    })

    it('Should setup collateral correctly', async function () {
      // Self-referential Collateral
      expect(await cTokenSelfReferentialCollateral.isCollateral()).to.equal(true)
      expect(await cTokenSelfReferentialCollateral.chainlinkFeed()).to.equal(chainlinkFeed.address)
      expect(await cTokenSelfReferentialCollateral.referenceERC20Decimals()).to.equal(18)
      expect(await cTokenSelfReferentialCollateral.erc20()).to.equal(cSelfRefToken.address)
      expect(await cSelfRefToken.decimals()).to.equal(8)
      expect(await cTokenSelfReferentialCollateral.targetName()).to.equal(
        ethers.utils.formatBytes32String('ETH')
      )
      // Get priceable info
      await cTokenSelfReferentialCollateral.refresh()
      expect(await cTokenSelfReferentialCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await cTokenSelfReferentialCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await cTokenSelfReferentialCollateral.maxTradeVolume()).to.equal(
        config.rTokenMaxTradeVolume
      )
      expect(await cTokenSelfReferentialCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await cTokenSelfReferentialCollateral.bal(owner.address)).to.equal(amt)
      expect(await cTokenSelfReferentialCollateral.refPerTok()).to.equal(fp('0.02'))
      expect(await cTokenSelfReferentialCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await cTokenSelfReferentialCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await cTokenSelfReferentialCollateral.prevReferencePrice()).to.equal(
        await cTokenSelfReferentialCollateral.refPerTok()
      )

      expect(await cTokenSelfReferentialCollateral.strictPrice()).to.equal(fp('0.02'))
      await expect(cTokenSelfReferentialCollateral.claimRewards())
        .to.emit(cTokenSelfReferentialCollateral, 'RewardsClaimed')
        .withArgs(compToken.address, 0)
    })

    it('Should calculate prices correctly', async function () {
      expect(await cTokenSelfReferentialCollateral.strictPrice()).to.equal(fp('0.02'))

      // Check refPerTok initial values
      expect(await cTokenSelfReferentialCollateral.refPerTok()).to.equal(fp('0.02'))

      // Increase rate to double
      await cSelfRefToken.setExchangeRate(fp(2))

      // Check price doubled
      expect(await cTokenSelfReferentialCollateral.strictPrice()).to.equal(fp('0.04'))

      // RefPerTok also doubles in this case
      expect(await cTokenSelfReferentialCollateral.refPerTok()).to.equal(fp('0.04'))

      // Update values in Oracle increase by 10%
      await setOraclePrice(cTokenSelfReferentialCollateral.address, bn('1.1e8'))

      // Check new prices
      expect(await cTokenSelfReferentialCollateral.strictPrice()).to.equal(fp('0.044'))

      // Revert if price is zero - Update Oracles and check prices
      await setOraclePrice(cTokenSelfReferentialCollateral.address, bn(0))
      await expect(cTokenSelfReferentialCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // When refreshed, sets status to Unpriced
      await cTokenSelfReferentialCollateral.refresh()
      expect(await cTokenSelfReferentialCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenSelfRefCollateral: CTokenSelfReferentialCollateral = <
        CTokenSelfReferentialCollateral
      >await CTokenSelfReferentialFactory.deploy(
        fp('1'),
        invalidChainlinkFeed.address,
        cSelfRefToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        DELAY_UNTIL_DEFAULT,
        18,
        compoundMock.address
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCTokenSelfRefCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenSelfRefCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCTokenSelfRefCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenSelfRefCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Tests specific to EURFiatCollateral.sol contract, not used by default in fixture
  describe('EUR fiat Collateral #fast', () => {
    let EURFiatCollateralFactory: ContractFactory
    let eurFiatCollateral: EURFiatCollateral
    let eurFiatToken: ERC20Mock
    let targetUnitOracle: MockV3Aggregator
    let referenceUnitOracle: MockV3Aggregator

    beforeEach(async () => {
      eurFiatToken = await (
        await ethers.getContractFactory('ERC20Mock')
      ).deploy('EUR Token', 'EURT')
      targetUnitOracle = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8')) // $1
      )
      referenceUnitOracle = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8')) // $1
      )

      EURFiatCollateralFactory = await ethers.getContractFactory('EURFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })

      eurFiatCollateral = <EURFiatCollateral>(
        await EURFiatCollateralFactory.deploy(
          1,
          referenceUnitOracle.address,
          targetUnitOracle.address,
          eurFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('EUR'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      )

      // Mint some tokens
      await eurFiatToken.connect(owner).mint(owner.address, amt)
    })

    it('Should not allow missing defaultThreshold', async () => {
      await expect(
        EURFiatCollateralFactory.deploy(
          1,
          referenceUnitOracle.address,
          targetUnitOracle.address,
          eurFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('EUR'),
          bn(0),
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })

    it('Should not allow missing delayUntilDefault', async () => {
      await expect(
        EURFiatCollateralFactory.deploy(
          1,
          referenceUnitOracle.address,
          targetUnitOracle.address,
          eurFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('EUR'),
          DEFAULT_THRESHOLD,
          bn(0)
        )
      ).to.be.revertedWith('delayUntilDefault zero')
    })

    it('Should not allow missing uoaPerTarget feed', async () => {
      await expect(
        EURFiatCollateralFactory.deploy(
          1,
          referenceUnitOracle.address,
          ZERO_ADDRESS,
          eurFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('EUR'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('missing uoaPerTarget feed')
    })

    it('Should not allow missing uoaPerRef feed', async () => {
      await expect(
        EURFiatCollateralFactory.deploy(
          1,
          ZERO_ADDRESS,
          targetUnitOracle.address,
          eurFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('EUR'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      ).to.be.revertedWith('missing chainlink feed')
    })

    it('Should not revert during refresh when price2 is 0', async () => {
      const targetFeedAddr = await eurFiatCollateral.uoaPerTargetFeed()
      const targetFeed = await ethers.getContractAt('MockV3Aggregator', targetFeedAddr)
      await targetFeed.updateAnswer(0)
      await eurFiatCollateral.refresh()
      expect(await eurFiatCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Should setup collateral correctly', async function () {
      // Non-Fiat Token
      expect(await eurFiatCollateral.isCollateral()).to.equal(true)
      expect(await eurFiatCollateral.uoaPerTargetFeed()).to.equal(targetUnitOracle.address)
      expect(await eurFiatCollateral.chainlinkFeed()).to.equal(referenceUnitOracle.address)
      expect(await eurFiatCollateral.erc20()).to.equal(eurFiatToken.address)
      expect(await eurFiatToken.decimals()).to.equal(18)
      expect(await eurFiatCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('EUR'))
      // Get priceable info
      await eurFiatCollateral.refresh()
      expect(await eurFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await eurFiatCollateral.whenDefault()).to.equal(MAX_UINT256)
      expect(await eurFiatCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
      expect(await eurFiatCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
      expect(await eurFiatCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await eurFiatCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
      expect(await eurFiatCollateral.bal(owner.address)).to.equal(amt)
      expect(await eurFiatCollateral.refPerTok()).to.equal(fp('1'))
      expect(await eurFiatCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await eurFiatCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await eurFiatCollateral.strictPrice()).to.equal(fp('1'))
      await expect(eurFiatCollateral.claimRewards()).to.not.emit(
        eurFiatCollateral,
        'RewardsClaimed'
      )
    })

    it('Should calculate prices correctly', async function () {
      // Check initial prices
      expect(await eurFiatCollateral.strictPrice()).to.equal(fp('1'))

      // Update values in Oracle = double price
      await referenceUnitOracle.updateAnswer(bn('2e8'))
      await targetUnitOracle.updateAnswer(bn('2e8'))

      // Check new prices
      expect(await eurFiatCollateral.strictPrice()).to.equal(fp('2'))

      // Revert if price is zero - Update Oracles and check prices
      await referenceUnitOracle.updateAnswer(bn('0'))
      await expect(eurFiatCollateral.strictPrice()).to.be.revertedWith('PriceOutsideRange()')

      // When refreshed, sets status to Unpriced
      await eurFiatCollateral.refresh()
      expect(await eurFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Restore
      await referenceUnitOracle.updateAnswer(bn('2e8'))
      await eurFiatCollateral.refresh()
      expect(await eurFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check the other oracle - When refreshed, sets status to Unpriced
      await targetUnitOracle.updateAnswer(bn('0'))
      await eurFiatCollateral.refresh()
      expect(await eurFiatCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      let invalidEURFiatCollateral: EURFiatCollateral = <EURFiatCollateral>(
        await EURFiatCollateralFactory.deploy(
          1,
          invalidChainlinkFeed.address,
          targetUnitOracle.address,
          eurFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('EUR'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidEURFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidEURFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidEURFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidEURFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // With the second oracle
      invalidEURFiatCollateral = <EURFiatCollateral>(
        await EURFiatCollateralFactory.deploy(
          1,
          referenceUnitOracle.address,
          invalidChainlinkFeed.address,
          eurFiatToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('EUR'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidEURFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidEURFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidEURFiatCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidEURFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  describeGas('Gas Reporting', () => {
    it('Force Updates - Soft Default', async function () {
      const delayUntilDefault: BigNumber = await tokenCollateral.delayUntilDefault()

      // Depeg one of the underlying tokens - Reducing price 20%
      // Should also impact on the aToken and cToken
      await setOraclePrice(tokenCollateral.address, bn('7e7'))

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

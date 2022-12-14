import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  TFLendingCollateral,
  TrueFiPoolMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  InvalidMockV3Aggregator,
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderTfUSDC = '0xec6c3fd795d6e6f202825ddb56e01b3c128b0b10'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`TFLendingCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock
  let tfUSDC: TrueFiPoolMock
  let tfUSDCCollateral: TFLendingCollateral
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Core Contracts
  let main: TestIMain
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let deployer: TestIDeployer
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let facadeWrite: FacadeWrite
  let oracleLib: OracleLib
  let govParams: IGovParams

  // RToken Configuration
  const dist: IRevenueShare = {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  }
  const config: IConfig = {
    dist: dist,
    minTradeVolume: fp('1e4'), // $10k
    rTokenMaxTradeVolume: fp('1e6'), // $1M
    shortFreeze: bn('259200'), // 3 days
    longFreeze: bn('2592000'), // 30 days
    rewardPeriod: bn('604800'), // 1 week
    rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    scalingRedemptionRate: fp('0.05'), // 5%
    redemptionRateFloor: fp('1e6'), // 1M RToken
  }

  const defaultRefThreshold = fp('0.05') // 5%
  const loanDefaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let TFLendingCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // USDC token
    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )
    // tfUSDC token
    tfUSDC = <TrueFiPoolMock>(
      await ethers.getContractAt('TrueFiPoolMock', networkConfig[chainId].tokens.tfUSDC || '')
    )

    // Deploy tfUSDC collateral plugin
    TFLendingCollateralFactory = await ethers.getContractFactory('TFLendingCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    tfUSDCCollateral = <TFLendingCollateral>(
      await TFLendingCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        tfUSDC.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultRefThreshold,
        delayUntilDefault,
        loanDefaultThreshold
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // tfUSDC
    initialBal = bn('2000000e18')
    await whileImpersonating(holderTfUSDC, async (tfUSDCSigner) => {
      await tfUSDC.connect(tfUSDCSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
    })

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [],
      primaryBasket: [tfUSDCCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: [],
    }

    // Deploy RToken via FacadeWrite
    const receipt = await (
      await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()

    // Get Main
    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

    // Get core contracts
    assetRegistry = <IAssetRegistry>(
      await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
    )
    backingManager = <TestIBackingManager>(
      await ethers.getContractAt('TestIBackingManager', await main.backingManager())
    )
    basketHandler = <IBasketHandler>(
      await ethers.getContractAt('IBasketHandler', await main.basketHandler())
    )
    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
    rTokenAsset = <RTokenAsset>(
      await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
    )

    // Setup owner and unpause
    await facadeWrite.connect(owner).setupGovernance(
      rToken.address,
      false, // do not deploy governance
      true, // unpaused
      govParams, // mock values, not relevant
      owner.address, // owner
      ZERO_ADDRESS, // no guardian
      ZERO_ADDRESS // no pauser
    )

    // Setup mock chainlink feed for some of the tests (so we can change the value)
    MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      // tfUSDC (TFLendingCollateral)
      expect(await tfUSDCCollateral.isCollateral()).to.equal(true)
      expect(await tfUSDCCollateral.erc20()).to.equal(tfUSDC.address)
      expect(await tfUSDCCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await tfUSDCCollateral.refPerTok()).to.be.closeTo(fp('1.05'), fp('0.1')) // checkk
      expect(await tfUSDCCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await tfUSDCCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await tfUSDCCollateral.strictPrice()).to.be.closeTo(fp('1.05'), fp('0.1')) // currently close to $1.05 cents Dec 2022

      expect(await tfUSDCCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(tfUSDC.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(tfUSDCCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(tfUSDCCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(tfUSDC.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1'), fp('0.015'))

      // Check RToken price
      const issueAmount: BigNumber = bn('10000e18')
      await tfUSDC.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        TFLendingCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          tfUSDC.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          delayUntilDefault,
          loanDefaultThreshold
        )
      ).to.be.revertedWith('defaultRefThreshold zero')

      // ReferemceERC20Decimals
      await expect(
        TFLendingCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          tfUSDC.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultRefThreshold,
          delayUntilDefault,
          bn(0)
        )
      ).to.be.revertedWith('loanDefaultThreshold zero')

      // Comptroller
      await expect(
        TFLendingCollateralFactory.deploy(
          fp('1'),
          ZERO_ADDRESS,
          tfUSDC.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultRefThreshold,
          delayUntilDefault,
          loanDefaultThreshold
        )
      ).to.be.revertedWith('missing chainlink feed')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await tfUSDC.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1tfUSDC: BigNumber = await tfUSDC.balanceOf(addr1.address)

      // Check rates and prices
      const tfUSDCPrice1: BigNumber = await tfUSDCCollateral.strictPrice() // ~ $1.05
      const tfUSDCRefPerTok1: BigNumber = await tfUSDCCollateral.refPerTok() // ~ $1.05

      expect(tfUSDCPrice1).to.be.closeTo(fp('1.05'), fp('0.1'))
      expect(tfUSDCRefPerTok1).to.be.closeTo(fp('1.05'), fp('0.1'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh tfToken manually (required)
      await tfUSDCCollateral.refresh()
      expect(await tfUSDCCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const tfUSDCPrice2: BigNumber = await tfUSDCCollateral.strictPrice()
      const tfUSDCRefPerTok2: BigNumber = await tfUSDCCollateral.refPerTok()

      // Check rates and price increase
      expect(tfUSDCPrice2).to.be.gt(tfUSDCPrice1)
      expect(tfUSDCRefPerTok2).to.be.gt(tfUSDCRefPerTok1)

      // Still close to the original values
      expect(tfUSDCPrice2).to.be.closeTo(fp('1.05'), fp('0.1'))
      expect(tfUSDCRefPerTok2).to.be.closeTo(fp('1.05'), fp('0.1'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh tfToken manually (required)
      await tfUSDCCollateral.refresh()
      expect(await tfUSDCCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const tfUSDCPrice3: BigNumber = await tfUSDCCollateral.strictPrice()
      const tfUSDCRefPerTok3: BigNumber = await tfUSDCCollateral.refPerTok()

      // Check rates and price increase
      expect(tfUSDCPrice3).to.be.gt(tfUSDCPrice2)
      expect(tfUSDCRefPerTok3).to.be.gt(tfUSDCRefPerTok2)

      // Need to adjust ranges
      expect(tfUSDCPrice3).to.be.closeTo(fp('1.068'), fp('0.1'))
      expect(tfUSDCRefPerTok3).to.be.closeTo(fp('1.068'), fp('0.1'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer tfTokens should have been sent to the user
      const newBalanceAddr1tfUSDC: BigNumber = await tfUSDC.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1tfUSDC.sub(balanceAddr1tfUSDC)).to.be.closeTo(bn('9359e6'), bn('8e6')) // ~1.068 * 9359 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await tfUSDC.balanceOf(backingManager.address)).to.be.closeTo(bn(104e6), bn('5e5')) // ~= 104 tfUSDC

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('111'), // ~= 104 (remaining tfUSDC) * 1.068 (price)
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      // Only checking to see that claim call does not revert
      await expectEvents(backingManager.claimRewards(), [])
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expect(tfUSDCCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await tfUSDCCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await tfUSDCCollateral.refresh()
      expect(await tfUSDCCollateral.status()).to.equal(CollateralStatus.IFFY)

      // TfTokens Collateral with no price
      const nonpriceTfTokenCollateral: TFLendingCollateral = <TFLendingCollateral>await (
        await ethers.getContractFactory('TFLendingCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED,
        tfUSDC.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultRefThreshold,
        delayUntilDefault,
        loanDefaultThreshold
      )

      // TfTokens - Collateral with no price info should revert
      await expect(nonpriceTfTokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceTfTokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceTfTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceTfTokenCollateral: TFLendingCollateral = <TFLendingCollateral>await (
        await ethers.getContractFactory('TFLendingCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        tfUSDC.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultRefThreshold,
        delayUntilDefault,
        loanDefaultThreshold
      )

      await setOraclePrice(invalidpriceTfTokenCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceTfTokenCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceTfTokenCollateral.refresh()
      expect(await invalidpriceTfTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for soft default
    it('Updates status in case of usdc depeg', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newtfUSDCCollateral: TFLendingCollateral = <TFLendingCollateral>await (
        await ethers.getContractFactory('TFLendingCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        await tfUSDCCollateral.erc20(),
        await tfUSDCCollateral.maxTradeVolume(),
        await tfUSDCCollateral.oracleTimeout(),
        await tfUSDCCollateral.targetName(),
        await tfUSDCCollateral.defaultRefThreshold(),
        await tfUSDCCollateral.delayUntilDefault(),
        await tfUSDCCollateral.loanDefaultThreshold()
      )

      // Check initial state
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newtfUSDCCollateral.address, bn('8e6')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newtfUSDCCollateral.refresh())
        .to.emit(newtfUSDCCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      const prevWhenDefault: BigNumber = await newtfUSDCCollateral.whenDefault()
      await expect(newtfUSDCCollateral.refresh()).to.not.emit(
        newtfUSDCCollateral,
        'CollateralStatusChanged'
      )
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Updates status in case of loan default threshold passed', async () => {
      // Note: In this case requires to use a TfToken mock to be able to change the rate
      const TrueFiPoolMockFactory: ContractFactory = await ethers.getContractFactory(
        'TrueFiPoolMock'
      )
      const symbol = await tfUSDC.symbol()
      const tfUSDCMock: TrueFiPoolMock = <TrueFiPoolMock>(
        await TrueFiPoolMockFactory.deploy(symbol + ' Token', symbol, usdc.address, usdc.decimals())
      )

      // // Set initial exchange rate to the new tfUSDC Mock
      await tfUSDCMock.setPoolValue(fp('100'))

      // Redeploy plugin using the new tfUSDC mock
      const newtfUSDCCollateral: TFLendingCollateral = <TFLendingCollateral>await (
        await ethers.getContractFactory('TFLendingCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await tfUSDCCollateral.chainlinkFeed(),
        tfUSDCMock.address,
        await tfUSDCCollateral.maxTradeVolume(),
        await tfUSDCCollateral.oracleTimeout(),
        await tfUSDCCollateral.targetName(),
        await tfUSDCCollateral.defaultRefThreshold(),
        await tfUSDCCollateral.delayUntilDefault(),
        await tfUSDCCollateral.loanDefaultThreshold()
      )

      // Check initial state
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await tfUSDCMock.setDeficitValue(fp('50'))
      console.log(await tfUSDCMock.deficitValue())
      console.log(await tfUSDCMock.poolValue())
      // Force updates - Should update whenDefault and status
      await expect(newtfUSDCCollateral.refresh())
        .to.emit(newtfUSDCCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      const prevWhenDefault: BigNumber = await newtfUSDCCollateral.whenDefault()
      await expect(newtfUSDCCollateral.refresh()).to.not.emit(
        newtfUSDCCollateral,
        'CollateralStatusChanged'
      )
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a TfToken mock to be able to change the rate
      const TrueFiPoolMockFactory: ContractFactory = await ethers.getContractFactory(
        'TrueFiPoolMock'
      )
      const symbol = await tfUSDC.symbol()
      const tfUSDCMock: TrueFiPoolMock = <TrueFiPoolMock>(
        await TrueFiPoolMockFactory.deploy(symbol + ' Token', symbol, usdc.address, usdc.decimals())
      )
      // Set initial exchange rate to the new tfUSDC Mock
      await tfUSDCMock.mint(addr1.address, bn('100e6'))
      await tfUSDCMock.setPoolValue(fp('100'))

      // Redeploy plugin using the new tfUSDC mock
      const newtfUSDCCollateral: TFLendingCollateral = <TFLendingCollateral>await (
        await ethers.getContractFactory('TFLendingCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await tfUSDCCollateral.chainlinkFeed(),
        tfUSDCMock.address,
        await tfUSDCCollateral.maxTradeVolume(),
        await tfUSDCCollateral.oracleTimeout(),
        await tfUSDCCollateral.targetName(),
        await tfUSDCCollateral.defaultRefThreshold(),
        await tfUSDCCollateral.delayUntilDefault(),
        await tfUSDCCollateral.loanDefaultThreshold()
      )

      // Check initial state
      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for tfUSDC, will disable collateral immediately
      await tfUSDCMock.setPoolValue(fp('10'))

      // Force updates - Should update whenDefault and status for Atokens/TfTokens
      await expect(newtfUSDCCollateral.refresh())
        .to.emit(newtfUSDCCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newtfUSDCCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newtfUSDCCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
      )

      const invalidTfTokenCollateral: TFLendingCollateral = <TFLendingCollateral>(
        await TFLendingCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await tfUSDCCollateral.erc20(),
          await tfUSDCCollateral.maxTradeVolume(),
          await tfUSDCCollateral.oracleTimeout(),
          await tfUSDCCollateral.targetName(),
          await tfUSDCCollateral.defaultRefThreshold(),
          await tfUSDCCollateral.delayUntilDefault(),
          await tfUSDCCollateral.loanDefaultThreshold()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidTfTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidTfTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidTfTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidTfTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

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
import { expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  RibbonEarnUsdcCollateral,
  REarnMock,
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
const holderUSDC = '0xBcf5AB858CB0C003adb5226BdbFecd0bfd7b6D9f'
const holder_rEarn = '0x9674126ff31e5ece36de0cf03a49351a7c814587'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`RibbonEarnUsdcCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock
  let rEARN: REarnMock
  let rEarnUsdcCollateral: RibbonEarnUsdcCollateral
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

  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let RibbonEarnCollateralFactory: ContractFactory
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

    // Get required contracts for rEARN
    // usdc
    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )

    // rEARN
    rEARN = <REarnMock>(
      await ethers.getContractAt('REarnMock', networkConfig[chainId].tokens.rEARN || '')
    )
   
    RibbonEarnCollateralFactory = await ethers.getContractFactory('RibbonEarnUsdcCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    rEarnUsdcCollateral = <RibbonEarnUsdcCollateral>(
      await RibbonEarnCollateralFactory.deploy(
        fp('1.0'),
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        rEARN.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        defaultThreshold,
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // usdc
    initialBal = bn('2000000e18')
    await whileImpersonating(holderUSDC, async (usdcSigner) => {
      await usdc.connect(usdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
    })

    // rEARN
    await whileImpersonating(holder_rEarn, async (rearnSigner) => {
      await rEARN.connect(rearnSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
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
      primaryBasket: [rEarnUsdcCollateral.address],
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
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // rEARN (rEarnUsdcCollateral)
      expect(await rEarnUsdcCollateral.isCollateral()).to.equal(true)
      expect(await rEarnUsdcCollateral.erc20()).to.equal(rEARN.address)
      expect(await usdc.decimals()).to.equal(6)
      expect(await rEARN.decimals()).to.equal(6)
      expect(await rEarnUsdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await rEarnUsdcCollateral.refPerTok()).to.be.closeTo(fp('1.016'), fp('0.001'))
      expect(await rEarnUsdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await rEarnUsdcCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await rEarnUsdcCollateral.prevReferencePrice()).to.equal(await rEarnUsdcCollateral.refPerTok())
      expect(await rEarnUsdcCollateral.strictPrice()).to.be.closeTo(fp('1.016'), fp('0.001')) // close to $1.016 usdc

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(rEARN.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(rEarnUsdcCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(rEarnUsdcCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(rEARN.address)
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
      const issueAmount: BigNumber = bn('100e18')
      await rEARN.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        RibbonEarnCollateralFactory.deploy(
          fp('1.0'),
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        rEARN.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        bn(0),
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await rEARN.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1rEARN: BigNumber = await rEARN.balanceOf(addr1.address)

      // Check rates and prices
      const rEARNPrice1: BigNumber = await rEarnUsdcCollateral.strictPrice() // ~1.016252
      const rEARNRefPerTok1: BigNumber = await rEarnUsdcCollateral.refPerTok() // ~1.016252

      expect(rEARNPrice1).to.be.closeTo(fp('1.016'), fp('0.001'))
      expect(rEARNRefPerTok1).to.be.closeTo(fp('1.016'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )

      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await rEarnUsdcCollateral.refresh()
      expect(await rEarnUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const rEARNPrice2: BigNumber = await rEarnUsdcCollateral.strictPrice() // ~1.016277
      const rEARNRefPerTok2: BigNumber = await rEarnUsdcCollateral.refPerTok() // ~1.016277

      // Check rates and price increase
      expect(rEARNPrice2).to.be.gt(rEARNPrice1)
      expect(rEARNRefPerTok2).to.be.gt(rEARNRefPerTok1)

      // Still close to the original values
      expect(rEARNPrice2).to.be.closeTo(fp('1.016'), fp('0.001'))
      expect(rEARNRefPerTok2).to.be.closeTo(fp('1.016'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks significantly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh collateral manually (required)
      await rEarnUsdcCollateral.refresh()
      expect(await rEarnUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const rEARNPrice3: BigNumber = await rEarnUsdcCollateral.strictPrice() // ~1.274317
      const rEARNRefPerTok3: BigNumber = await rEarnUsdcCollateral.refPerTok() // ~1.274317

      // Check rates and price increase
      expect(rEARNPrice3).to.be.gt(rEARNPrice2)
      expect(rEARNRefPerTok3).to.be.gt(rEARNRefPerTok2)

      // Need to adjust ranges
      expect(rEARNPrice3).to.be.closeTo(fp('1.274'), fp('0.001'))
      expect(rEARNRefPerTok3).to.be.closeTo(fp('1.274'), fp('0.001'))

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

      // Check balances - Fewer rEARN tokens should have been sent to the user
      const newBalanceAddr1rEARN: BigNumber = await rEARN.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1rEARN.sub(balanceAddr1rEARN)).to.be.closeTo(bn('7847e6'), bn('8e5')) 

      // Check remainders in Backing Manager
      expect(await rEARN.balanceOf(backingManager.address)).to.be.closeTo(bn('1992e6'), bn('8e5')) // ~= 2539 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('2539'), // ~= 2539 usd (from above)
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Provide approvals for issuances
      await rEARN.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.not.emit(backingManager, 'RewardsClaimed')
      expect(await backingManager.claimRewards()).to.not.throw
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      await expect(rEarnUsdcCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await rEarnUsdcCollateral.price(true)
      expect(isFallback).to.equal(true)

      expect(price).to.be.closeTo(fp('1.360'), fp('0.005'))

      // Refresh should mark status IFFY
      await rEarnUsdcCollateral.refresh()
      expect(await rEarnUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Ribbon Earn Collateral with no price
      const nonpriceREarnCollateral: RibbonEarnUsdcCollateral = <RibbonEarnUsdcCollateral>await (
        await ethers.getContractFactory('RibbonEarnUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED,
        rEARN.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        defaultThreshold,
      )

      // Ribbon Earn - Collateral with no price info should revert
      await expect(nonpriceREarnCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceREarnCollateral.refresh()).to.be.reverted
      expect(await nonpriceREarnCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceREarnCollateral: RibbonEarnUsdcCollateral = <RibbonEarnUsdcCollateral>await (
        await ethers.getContractFactory('RibbonEarnUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        rEARN.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        defaultThreshold,
      )

      await setOraclePrice(invalidpriceREarnCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceREarnCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceREarnCollateral.refresh()
      expect(await invalidpriceREarnCollateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for soft default
    it('Updates status in case of soft default', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newREarnCollateral: RibbonEarnUsdcCollateral = <RibbonEarnUsdcCollateral>await (
        await ethers.getContractFactory('RibbonEarnUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        await rEarnUsdcCollateral.erc20(),
        await rEarnUsdcCollateral.maxTradeVolume(),
        await rEarnUsdcCollateral.oracleTimeout(),
        await rEarnUsdcCollateral.targetName(),
        await rEarnUsdcCollateral.delayUntilDefault(),
        await rEarnUsdcCollateral.defaultThreshold(),
      )

      // Check initial state
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newREarnCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newREarnCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newREarnCollateral.refresh())
        .to.emit(newREarnCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newREarnCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newREarnCollateral.whenDefault()
      await expect(newREarnCollateral.refresh()).to.not.emit(
        newREarnCollateral,
        'CollateralStatusChanged'
      )
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newREarnCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a REarnMock to be able to change the rate
      const REarnMockFactory: ContractFactory = await ethers.getContractFactory('REarnMock')
      const symbol = await rEARN.symbol()
      const rEarnMock: REarnMock = <REarnMock>(
        await REarnMockFactory.deploy(symbol + ' Token', symbol, usdc.address)
      )

      // Redeploy plugin using the new cDai mock
      const newREarnCollateral: RibbonEarnUsdcCollateral = <RibbonEarnUsdcCollateral>await (
        await ethers.getContractFactory('RibbonEarnUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await rEarnUsdcCollateral.chainlinkFeed(),
        rEarnMock.address,
        await rEarnUsdcCollateral.maxTradeVolume(),
        await rEarnUsdcCollateral.oracleTimeout(),
        await rEarnUsdcCollateral.targetName(),
        await rEarnUsdcCollateral.delayUntilDefault(),
        await rEarnUsdcCollateral.defaultThreshold(),
      )

      // Check initial state
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newREarnCollateral.whenDefault()).to.equal(MAX_UINT256)
      await newREarnCollateral.refresh();
      expect(await newREarnCollateral.prevReferencePrice()).to.be.closeTo(fp('1.016'), fp('0.005'))

      // Decrease price per share, will disable collateral immediately
      await rEarnMock.setPricePerShare(bn('918922'))

      // Force updates - Should update whenDefault and status
      await expect(newREarnCollateral.refresh())
        .to.emit(newREarnCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newREarnCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidREarnCollateral: RibbonEarnUsdcCollateral = <RibbonEarnUsdcCollateral>(
        await RibbonEarnCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await rEarnUsdcCollateral.erc20(),
          await rEarnUsdcCollateral.maxTradeVolume(),
          await rEarnUsdcCollateral.oracleTimeout(),
          await rEarnUsdcCollateral.targetName(),
          await rEarnUsdcCollateral.delayUntilDefault(),
          await rEarnUsdcCollateral.defaultThreshold(),
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidREarnCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidREarnCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidREarnCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidREarnCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

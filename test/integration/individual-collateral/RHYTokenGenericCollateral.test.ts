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
import { advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  ChainlinkPriceProvider,
  PriceProviderMock,
  VaultTokenMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  RHVaultTokenGenericCollateral,
  InvalidPriceProviderMock,
} from '../../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`RHVaultTokenGenericCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let link: ERC20Mock
  let yvLink: VaultTokenMock
  let yvLinkCollateral: RHVaultTokenGenericCollateral
  let priceProvider: ChainlinkPriceProvider
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

  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let VaultTokenCollateralFactory: ContractFactory
  let VaultTokenMockFactory: ContractFactory
  let PriceProviderFactory: ContractFactory
  let PriceProviderMockFactory: ContractFactory
  let mockPriceProvider: PriceProviderMock

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
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, govParams } = await loadFixture(
      defaultFixture
    ))

    // Get required contracts for YVLink
    // LINK token
    link = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.LINK || '')
    )
    VaultTokenMockFactory = await ethers.getContractFactory('VaultTokenMock')
    // YVLink token
    yvLink = <VaultTokenMock>(
      await VaultTokenMockFactory.deploy('LINK yVault', 'yvLINK', link.address)
    )
    await yvLink.setExchangeRate(fp('1.01'))
    expect(await yvLink.pricePerShare()).to.be.equal(
      toBNDecimals(fp('1.01'), await link.decimals())
    )

    // Deploy Chainlink price provider
    PriceProviderFactory = await ethers.getContractFactory('ChainlinkPriceProvider')
    priceProvider = <ChainlinkPriceProvider>await PriceProviderFactory.deploy(ORACLE_TIMEOUT)
    // No feed has been provided yet so should revert
    await expect(priceProvider.price(link.address)).to.be.reverted
    // Setup LINK feed
    await priceProvider.registerAssetFeed(
      link.address,
      networkConfig[chainId].chainlinkFeeds.LINK || ''
    )

    // Deploy yvLink collateral plugin
    VaultTokenCollateralFactory = await ethers.getContractFactory(
      'RHVaultTokenGenericCollateral',
      {}
    )
    yvLinkCollateral = <RHVaultTokenGenericCollateral>(
      await VaultTokenCollateralFactory.deploy(
        yvLink.address,
        config.rTokenMaxTradeVolume,
        fp('7'),
        ethers.utils.formatBytes32String('LINK'),
        delayUntilDefault,
        '100',
        priceProvider.address,
        link.address
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // yvLINK
    initialBal = bn('5000e18')
    await yvLink.mint(addr1.address, initialBal)

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
      primaryBasket: [yvLinkCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiary: ZERO_ADDRESS,
      revShare: {
        rsrDist: bn(0),
        rTokenDist: bn(0),
      },
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

    // Setup mock price provider for some of the tests (so we can change the value)
    PriceProviderMockFactory = await ethers.getContractFactory('PriceProviderMock')
    mockPriceProvider = <PriceProviderMock>await PriceProviderMockFactory.deploy()
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Price provider
      expect(await priceProvider.price(link.address)).to.be.closeTo(fp('7.78'), fp('0.01'))
      // Check Collateral plugin
      // yvLINK (RHVaultTokenGenericCollateral)
      expect(await yvLinkCollateral.isCollateral()).to.equal(true)
      expect(await yvLinkCollateral.erc20()).to.equal(yvLink.address)
      expect(await yvLink.decimals()).to.equal(await link.decimals())
      expect(await yvLink.pricePerShare()).to.be.closeTo(fp('1.01'), fp('0.01'))
      expect(await yvLinkCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('LINK'))
      expect(await yvLinkCollateral.actualRefPerTok()).to.be.closeTo(fp('1.01'), fp('0.01'))
      expect(await yvLinkCollateral.refPerTok()).to.be.closeTo(fp('0.9999'), fp('0.01'))
      expect(await yvLinkCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await yvLinkCollateral.strictPrice()).to.be.closeTo(fp('7.85'), fp('0.1')) // ~(1.01 * 7.78 = 7.85)

      // Check claim data
      await expect(yvLinkCollateral.claimRewards()).to.not.emit(yvLinkCollateral, 'RewardsClaimed')
      expect(await yvLinkCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(yvLink.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(yvLinkCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(yvLinkCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(yvLink.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('7.85'), fp('0.01'))

      // Check RToken price
      const issueAmount: BigNumber = bn('1000e18')
      await yvLink
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, await link.decimals()).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('7.85'), fp('0.01'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Delay until default
      await expect(
        VaultTokenCollateralFactory.deploy(
          yvLink.address,
          config.rTokenMaxTradeVolume,
          fp('1'),
          ethers.utils.formatBytes32String('LINK'),
          bn('0'),
          '100',
          priceProvider.address,
          link.address
        )
      ).to.be.revertedWith('delayUntilDefault zero')

      // Rate per period
      await expect(
        VaultTokenCollateralFactory.deploy(
          yvLink.address,
          config.rTokenMaxTradeVolume,
          fp('1'),
          ethers.utils.formatBytes32String('LINK'),
          delayUntilDefault,
          '10001',
          priceProvider.address,
          link.address
        )
      ).to.be.revertedWith('basisPoints_ invalid')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await yvLink
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, await link.decimals()).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1yvLink: BigNumber = await yvLink.balanceOf(addr1.address)

      // Check rates and prices
      const yvLinkPrice1: BigNumber = await yvLinkCollateral.strictPrice()
      const yvLinkRefPerTok1: BigNumber = await yvLinkCollateral.refPerTok()

      expect(yvLinkPrice1).to.be.closeTo(fp('7.85'), fp('0.1'))
      expect(yvLinkRefPerTok1).to.be.closeTo(fp('1'), fp('0.01'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(fp('78.5'), fp('0.1')) // approx 785 in value

      // Increase exchange rate slightly
      await yvLink.setExchangeRate(fp('1.02'))

      // Refresh yToken manually
      await yvLinkCollateral.refresh()
      expect(await yvLinkCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const yvLinkPrice2: BigNumber = await yvLinkCollateral.strictPrice() // ~7.85
      const yvLinkRefPerTok2: BigNumber = await yvLinkCollateral.refPerTok() // ~1

      // Check rates and price increase
      expect(yvLinkPrice2).to.be.gt(yvLinkPrice1)
      expect(yvLinkRefPerTok2).to.be.gt(yvLinkRefPerTok1)

      // Still close to the original values
      expect(yvLinkPrice2).to.be.closeTo(fp('7.85'), fp('0.1'))
      expect(yvLinkRefPerTok2).to.be.closeTo(fp('1'), fp('0.01'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Increase exchange rate greatly
      await yvLink.setExchangeRate(fp('2'))

      // Refresh yToken manually
      await yvLinkCollateral.refresh()
      expect(await yvLinkCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, great increase
      const yvLinkPrice3: BigNumber = await yvLinkCollateral.strictPrice() // ~15.7
      const yvLinkRefPerTok3: BigNumber = await yvLinkCollateral.refPerTok() // ~1.98

      // Check rates and price increase
      expect(yvLinkPrice3).to.be.gt(yvLinkPrice2)
      expect(yvLinkRefPerTok3).to.be.gt(yvLinkRefPerTok2)

      // Now significantly different
      expect(yvLinkPrice3).to.be.closeTo(fp('15.7'), fp('0.5'))
      expect(yvLinkRefPerTok3).to.be.closeTo(fp('1.98'), fp('0.01'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2) // ~157

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer yvTokens should have been sent to the user
      const newBalanceAddr1YVLink: BigNumber = await yvLink.balanceOf(addr1.address)

      // Check received tokens represent ~78.5 in value at current prices
      expect(newBalanceAddr1YVLink.sub(balanceAddr1yvLink)).to.be.closeTo(fp('5'), fp('0.1'))

      // Check remainders in Backing Manager
      expect(await yvLink.balanceOf(backingManager.address)).to.be.closeTo(fp('5'), fp('0.1'))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('78.5'),
        fp('2')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('10e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          emitted: false,
        },
      ])

      // Provide approvals for issuances
      await yvLink
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, await link.decimals()).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.not.emit(backingManager, 'RewardsClaimed')

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.not.emit(backingManager, 'RewardsClaimed')
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // The underlying chainlink feed would have become stale
      await expect(yvLinkCollateral.strictPrice()).to.be.reverted

      // Fallback price is returned
      const [isFallback, price] = await yvLinkCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('7'))

      // Refresh should mark status IFFY
      await yvLinkCollateral.refresh()
      expect(await yvLinkCollateral.status()).to.equal(CollateralStatus.IFFY)

      // VaultTokens Collateral with no price
      const nonpriceYtokenCollateral: RHVaultTokenGenericCollateral = <
        RHVaultTokenGenericCollateral
      >await (
        await ethers.getContractFactory('RHVaultTokenGenericCollateral', {})
      ).deploy(
        yvLink.address,
        config.rTokenMaxTradeVolume,
        fp('1'),
        ethers.utils.formatBytes32String('LINK'),
        delayUntilDefault,
        '100',
        NO_PRICE_DATA_FEED,
        link.address
      )

      // VaultTokens - Collateral with no price info should revert
      await expect(nonpriceYtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceYtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceYtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceYtokenCollateral: RHVaultTokenGenericCollateral = <
        RHVaultTokenGenericCollateral
      >await (
        await ethers.getContractFactory('RHVaultTokenGenericCollateral', {})
      ).deploy(
        yvLink.address,
        config.rTokenMaxTradeVolume,
        fp('1'),
        ethers.utils.formatBytes32String('LINK'),
        delayUntilDefault,
        '100',
        mockPriceProvider.address,
        link.address
      )

      await mockPriceProvider.setPrice(link.address, bn('0'))

      // Reverts with zero price
      await expect(invalidpriceYtokenCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceYtokenCollateral.refresh()
      expect(await invalidpriceYtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for soft default
    it('Updates status in case of soft default', async () => {
      // Redeploy plugin using a price provider mock where we can change the price
      const newYVLinkCollateral: RHVaultTokenGenericCollateral = <RHVaultTokenGenericCollateral>(
        await (
          await ethers.getContractFactory('RHVaultTokenGenericCollateral', {})
        ).deploy(
          await yvLinkCollateral.erc20(),
          await yvLinkCollateral.maxTradeVolume(),
          fp('1'),
          await yvLinkCollateral.targetName(),
          await yvLinkCollateral.delayUntilDefault(),
          '100',
          mockPriceProvider.address,
          link.address
        )
      )

      // Check initial state
      expect(await newYVLinkCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYVLinkCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Set zero price, should soft default
      await mockPriceProvider.setPrice(link.address, bn('0'))

      // Force updates - Should update whenDefault and status
      await expect(newYVLinkCollateral.refresh())
        .to.emit(newYVLinkCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newYVLinkCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newYVLinkCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newYVLinkCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      const prevWhenDefault: BigNumber = await newYVLinkCollateral.whenDefault()
      await expect(newYVLinkCollateral.refresh()).to.not.emit(
        newYVLinkCollateral,
        'DefaultStatusChanged'
      )
      expect(await newYVLinkCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newYVLinkCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a VaultToken mock to be able to change the rate
      const symbol = await yvLink.symbol()
      const yvLinkMock: VaultTokenMock = <VaultTokenMock>(
        await VaultTokenMockFactory.deploy(symbol + ' Token', symbol, link.address)
      )
      // Set initial exchange rate to the new yvLink Mock
      await yvLinkMock.setExchangeRate(fp('0.9'))

      // Redeploy plugin using the new yvLink mock
      const newYvLinkCollateral: RHVaultTokenGenericCollateral = <RHVaultTokenGenericCollateral>(
        await VaultTokenCollateralFactory.deploy(
          yvLinkMock.address,
          await yvLinkCollateral.maxTradeVolume(),
          fp('1'),
          await yvLinkCollateral.targetName(),
          await yvLinkCollateral.delayUntilDefault(),
          '100',
          await yvLinkCollateral.priceProvider(),
          link.address
        )
      )

      // Check initial state
      expect(await newYvLinkCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYvLinkCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Increase rate for yvLINK, no issues
      await yvLinkMock.setExchangeRate(fp('1'))
      await newYvLinkCollateral.refresh()
      expect(await newYvLinkCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYvLinkCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for yvLINK within threshold, no issues
      await yvLinkMock.setExchangeRate(fp('0.995'))
      await newYvLinkCollateral.refresh()
      expect(await newYvLinkCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYvLinkCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for yvLINK outside threshold, should default immediately
      await yvLinkMock.setExchangeRate(fp('0.98'))

      // Force updates - Should update whenDefault and status for VaultTokens
      await expect(newYvLinkCollateral.refresh())
        .to.emit(newYvLinkCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newYvLinkCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newYvLinkCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if price provider reverts or runs out of gas, maintains status', async () => {
      const InvalidPriceProviderMockFactory = await ethers.getContractFactory(
        'InvalidPriceProviderMock'
      )
      const invalidPriceProvider: InvalidPriceProviderMock = <InvalidPriceProviderMock>(
        await InvalidPriceProviderMockFactory.deploy()
      )

      const invalidVaultTokenCollateral: RHVaultTokenGenericCollateral = <
        RHVaultTokenGenericCollateral
      >await VaultTokenCollateralFactory.deploy(
        await yvLinkCollateral.erc20(),
        await yvLinkCollateral.maxTradeVolume(),
        fp('1'),
        await yvLinkCollateral.targetName(),
        await yvLinkCollateral.delayUntilDefault(),
        '100',
        invalidPriceProvider.address,
        link.address
      )

      // Reverting with no reason
      await invalidPriceProvider.setSimplyRevert(true)
      await expect(invalidVaultTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidVaultTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Running out of gas (same error)
      await invalidPriceProvider.setSimplyRevert(false)
      await expect(invalidVaultTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidVaultTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

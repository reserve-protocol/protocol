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
import { setOraclePrice } from '../../utils/oracles'
import { advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  RHVaultTokenFiatCollateral,
  VaultTokenMock,
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

const createFixtureLoader = waffle.createFixtureLoader

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`RHVaultTokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let dai: ERC20Mock
  let yvDai: VaultTokenMock
  let yvDaiCollateral: RHVaultTokenFiatCollateral
  // let compToken: ERC20Mock
  // let compAsset: Asset
  // let comptroller: ComptrollerMock
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

  let VaultTokenCollateralFactory: ContractFactory
  let VaultTokenMockFactory: ContractFactory
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

    // Get required contracts for yvDAI
    // DAI token
    dai = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI || '')
    )

    VaultTokenMockFactory = await ethers.getContractFactory('VaultTokenMock')
    // yvDAI token
    yvDai = <VaultTokenMock>await VaultTokenMockFactory.deploy('DAI yVault', 'yvDAI', dai.address)
    await yvDai.setExchangeRate(fp('1.0998'))
    expect(await yvDai.pricePerShare()).to.be.equal(fp('1.0998'))

    // Deploy yvDai collateral plugin
    VaultTokenCollateralFactory = await ethers.getContractFactory('RHVaultTokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    yvDaiCollateral = <RHVaultTokenFiatCollateral>(
      await VaultTokenCollateralFactory.deploy(
        yvDai.address,
        config.rTokenMaxTradeVolume,
        fp('1'),
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        '100',
        networkConfig[chainId].chainlinkFeeds.DAI as string,
        ORACLE_TIMEOUT,
        defaultThreshold
      )
    )

    // Setup balances for addr1 - mint tokens on mock
    // yvDAI
    initialBal = bn('500000e18')
    await yvDai.mint(addr1.address, toBNDecimals(initialBal, 18))

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
      primaryBasket: [yvDaiCollateral.address],
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
    MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Rewards assets (if applies)
      // Check Collateral plugin
      // yvDAI (RHVaultTokenFiatCollateral)
      expect(await yvDaiCollateral.isCollateral()).to.equal(true)
      expect(await yvDaiCollateral.erc20()).to.equal(yvDai.address)
      expect(await yvDai.decimals()).to.equal(await dai.decimals())
      expect(await yvDaiCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await yvDaiCollateral.actualRefPerTok()).to.be.closeTo(fp('1.0998'), fp('0.001'))
      expect(await yvDaiCollateral.refPerTok()).to.be.closeTo(fp('1.0888'), fp('0.001'))
      expect(await yvDaiCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await yvDaiCollateral.strictPrice()).to.be.closeTo(fp('1.099'), fp('0.001'))

      // Check claim data
      await expect(yvDaiCollateral.claimRewards()).to.not.emit(yvDaiCollateral, 'RewardsClaimed')
      expect(await yvDaiCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(yvDai.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(yvDaiCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(yvDaiCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(yvDai.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1.01'), fp('0.001')) // weight / refPerTok * price = 1 / 1.088 * 1.099

      // Check RToken price
      const issueAmount: BigNumber = bn('10000e18')
      await yvDai
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, await dai.decimals()).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1.01'), fp('0.001'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Delay until default
      await expect(
        VaultTokenCollateralFactory.deploy(
          yvDai.address,
          config.rTokenMaxTradeVolume,
          fp('1'),
          ethers.utils.formatBytes32String('USD'),
          bn('0'),
          '100',
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          ORACLE_TIMEOUT,
          defaultThreshold
        )
      ).to.be.revertedWith('delayUntilDefault zero')

      // Default threshold
      await expect(
        VaultTokenCollateralFactory.deploy(
          yvDai.address,
          config.rTokenMaxTradeVolume,
          fp('1'),
          ethers.utils.formatBytes32String('USD'),
          bn('1000'),
          '100',
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          ORACLE_TIMEOUT,
          bn('0')
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // basis points excess
      await expect(
        VaultTokenCollateralFactory.deploy(
          yvDai.address,
          config.rTokenMaxTradeVolume,
          fp('1'),
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          '10001',
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          ORACLE_TIMEOUT,
          defaultThreshold
        )
      ).to.be.revertedWith('basisPoints_ invalid')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await yvDai
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, await dai.decimals()).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1yvDai: BigNumber = await yvDai.balanceOf(addr1.address)

      // Check rates and prices
      const yvDaiPrice1: BigNumber = await yvDaiCollateral.strictPrice()
      const yvDaiRefPerTok1: BigNumber = await yvDaiCollateral.refPerTok()

      expect(yvDaiPrice1).to.be.closeTo(fp('1.099'), fp('0.001'))
      expect(yvDaiRefPerTok1).to.be.closeTo(fp('1.088'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(fp('10100'), fp('10')) // approx 10.1K in value

      // Increase exchange rate slightly
      await yvDai.setExchangeRate(fp('1.1'))

      // Refresh yToken manually
      await yvDaiCollateral.refresh()
      expect(await yvDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const yvDaiPrice2: BigNumber = await yvDaiCollateral.strictPrice() // ~1.1
      const yvDaiRefPerTok2: BigNumber = await yvDaiCollateral.refPerTok() // ~1.09

      // Check rates and price increase
      expect(yvDaiPrice2).to.be.gt(yvDaiPrice1)
      expect(yvDaiRefPerTok2).to.be.gt(yvDaiRefPerTok1)

      // Still close to the original values
      expect(yvDaiPrice2).to.be.closeTo(fp('1.1'), fp('0.001'))
      expect(yvDaiRefPerTok2).to.be.closeTo(fp('1.09'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Increase exchange rate greatly
      await yvDai.setExchangeRate(fp('1.9'))

      // Refresh yToken manually
      await yvDaiCollateral.refresh()
      expect(await yvDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, great increase
      const yvDaiPrice3: BigNumber = await yvDaiCollateral.strictPrice() // ~1.9
      const yvDaiRefPerTok3: BigNumber = await yvDaiCollateral.refPerTok() // ~1.88

      // Check rates and price increase
      expect(yvDaiPrice3).to.be.gt(yvDaiPrice2)
      expect(yvDaiRefPerTok3).to.be.gt(yvDaiRefPerTok2)

      // Now significantly different
      expect(yvDaiPrice3).to.be.closeTo(fp('1.9'), fp('0.001'))
      expect(yvDaiRefPerTok3).to.be.closeTo(fp('1.88'), fp('0.01'))

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

      // Check balances - Fewer yvTokens should have been sent to the user
      const newBalanceAddr1yvDai: BigNumber = await yvDai.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1yvDai.sub(balanceAddr1yvDai)).to.be.closeTo(fp('5300'), fp('100'))

      // Check remainders in Backing Manager
      expect(await yvDai.balanceOf(backingManager.address)).to.be.closeTo(fp('3800'), fp('100'))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('7500'),
        fp('300')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          emitted: false,
        },
      ])

      // Provide approvals for issuances
      await yvDai
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, await dai.decimals()).mul(100))

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

      // Compound
      await expect(yvDaiCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await yvDaiCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await yvDaiCollateral.refresh()
      expect(await yvDaiCollateral.status()).to.equal(CollateralStatus.IFFY)

      // VaultTokens Collateral with no price
      const nonpriceYtokenCollateral: RHVaultTokenFiatCollateral = <RHVaultTokenFiatCollateral>(
        await (
          await ethers.getContractFactory('RHVaultTokenFiatCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          yvDai.address,
          config.rTokenMaxTradeVolume,
          fp('1'),
          ethers.utils.formatBytes32String('RH10000yvDAI'),
          delayUntilDefault,
          '100',
          NO_PRICE_DATA_FEED,
          ORACLE_TIMEOUT,
          defaultThreshold
        )
      )

      // VaultTokens - Collateral with no price info should revert
      await expect(nonpriceYtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceYtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceYtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceYtokenCollateral: RHVaultTokenFiatCollateral = <RHVaultTokenFiatCollateral>(
        await (
          await ethers.getContractFactory('RHVaultTokenFiatCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          yvDai.address,
          config.rTokenMaxTradeVolume,
          fp('1'),
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          '100',
          mockChainlinkFeed.address,
          ORACLE_TIMEOUT,
          defaultThreshold
        )
      )

      await setOraclePrice(invalidpriceYtokenCollateral.address, bn(0))

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
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newYVDaiCollateral: RHVaultTokenFiatCollateral = <RHVaultTokenFiatCollateral>await (
        await ethers.getContractFactory('RHVaultTokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        await yvDaiCollateral.erc20(),
        await yvDaiCollateral.maxTradeVolume(),
        fp('1'),
        await yvDaiCollateral.targetName(),
        await yvDaiCollateral.delayUntilDefault(),
        '100',
        mockChainlinkFeed.address,
        await yvDaiCollateral.oracleTimeout(),
        await yvDaiCollateral.defaultThreshold()
      )

      // Check initial state
      expect(await newYVDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYVDaiCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await mockChainlinkFeed.updateAnswer(fp('0.8')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newYVDaiCollateral.refresh())
        .to.emit(newYVDaiCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newYVDaiCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newYVDaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newYVDaiCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      const prevWhenDefault: BigNumber = await newYVDaiCollateral.whenDefault()
      await expect(newYVDaiCollateral.refresh()).to.not.emit(
        newYVDaiCollateral,
        'DefaultStatusChanged'
      )
      expect(await newYVDaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newYVDaiCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a VaultToken mock to be able to change the rate
      const symbol = await yvDai.symbol()
      const yvDaiMock: VaultTokenMock = <VaultTokenMock>(
        await VaultTokenMockFactory.deploy(symbol + ' Token', symbol, dai.address)
      )
      // Set initial exchange rate to the new yDai Mock
      await yvDaiMock.setExchangeRate(fp('0.9'))

      // Redeploy plugin using the new yDai mock
      const newYvDaiCollateral: RHVaultTokenFiatCollateral = <RHVaultTokenFiatCollateral>(
        await VaultTokenCollateralFactory.deploy(
          yvDaiMock.address,
          await yvDaiCollateral.maxTradeVolume(),
          fp('1'),
          await yvDaiCollateral.targetName(),
          await yvDaiCollateral.delayUntilDefault(),
          '100',
          await yvDaiCollateral.chainlinkFeed(),
          await yvDaiCollateral.oracleTimeout(),
          await yvDaiCollateral.defaultThreshold()
        )
      )

      // Check initial state
      expect(await newYvDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYvDaiCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Increase rate for yvDAI, no issues
      await yvDaiMock.setExchangeRate(fp('1'))
      await newYvDaiCollateral.refresh()
      expect(await newYvDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYvDaiCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for yvDAI within threshold, no issues
      await yvDaiMock.setExchangeRate(fp('0.995'))
      await newYvDaiCollateral.refresh()
      expect(await newYvDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newYvDaiCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for yvDAI outside threshold, should default immediately
      await yvDaiMock.setExchangeRate(fp('0.98'))

      // Force updates - Should update whenDefault and status for VaultTokens
      await expect(newYvDaiCollateral.refresh())
        .to.emit(newYvDaiCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newYvDaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newYvDaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidVaultTokenCollateral: RHVaultTokenFiatCollateral = <RHVaultTokenFiatCollateral>(
        await VaultTokenCollateralFactory.deploy(
          await yvDaiCollateral.erc20(),
          await yvDaiCollateral.maxTradeVolume(),
          fp('1'),
          await yvDaiCollateral.targetName(),
          await yvDaiCollateral.delayUntilDefault(),
          '100',
          invalidChainlinkFeed.address,
          await yvDaiCollateral.oracleTimeout(),
          await yvDaiCollateral.defaultThreshold()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidVaultTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidVaultTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Running out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidVaultTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidVaultTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

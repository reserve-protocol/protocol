/* eslint-disable prettier/prettier */
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
  TfUsdcCollateral,
  TfTokenMock,
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
const holderTFUSDC = '0xec6c3fd795d6e6f202825ddb56e01b3c128b0b10'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`TfUsdcCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock
  let tfUsdc: TfTokenMock
  let tfUsdcCollateral: TfUsdcCollateral

  let truToken: ERC20Mock
  let truAsset: Asset
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

  let TfTokenCollateralFactory: ContractFactory
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
    // Get required contracts for tfUSDC
    truToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.TRU || '')
    )
    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )
    tfUsdc = <TfTokenMock>(
      await ethers.getContractAt('TfTokenMock', networkConfig[chainId].tokens.tfUSDC || '')
    )
    // Create TRU asset
    truAsset = <Asset>(
      await (
        await ethers.getContractFactory('Asset')
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.TRU || '',
        truToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT
      )
    )
    // Deploy tfUsdc collateral plugin
    TfTokenCollateralFactory = await ethers.getContractFactory('TfUsdcCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    tfUsdcCollateral = <TfUsdcCollateral>await TfTokenCollateralFactory.deploy(
      fp('1.03'),
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      tfUsdc.address, // pool address of truefi usdc
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      defaultThreshold,
      delayUntilDefault,
      (await usdc.decimals()).toString(),
      truToken.address as string
    )
    // Setup balances for addr1 - Transfer from Mainnet holder
    // tfUsdc
    initialBal = bn('2000000e18')
    await whileImpersonating(holderTFUSDC, async (tfusdcSigner) => {
      await tfUsdc.connect(tfusdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
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
      assets: [truAsset.address],
      primaryBasket: [tfUsdcCollateral.address],
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
      // Check Rewards assets (if applies)
      // TRU Asset
      expect(await truAsset.isCollateral()).to.equal(false)
      expect(await truAsset.erc20()).to.equal(truToken.address)
      expect(await truAsset.erc20()).to.equal(networkConfig[chainId].tokens.TRU)
      expect(await truToken.decimals()).to.equal(8)
      expect(await truAsset.strictPrice()).to.be.closeTo(fp('0.086'), fp('0.001')) // Close to $0.086 USD - June 2022
      await expect(truAsset.claimRewards()).to.not.emit(truAsset, 'RewardsClaimed')
      expect(await truAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check Collateral plugin
      // tfUsdc (TfUsdcCollateral)
      expect(await tfUsdcCollateral.isCollateral()).to.equal(true)
      expect(await tfUsdcCollateral.referenceERC20Decimals()).to.equal(await usdc.decimals())
      expect(await tfUsdcCollateral.erc20()).to.equal(tfUsdc.address)
      expect(await tfUsdc.decimals()).to.equal(6)
      expect(await tfUsdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await tfUsdcCollateral.refPerTok()).to.be.closeTo(fp('1'), fp('0.1'))
      expect(await tfUsdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await tfUsdcCollateral.pricePerTarget()).to.equal(fp('1'))
      // refPerTok changes continually, and should increase, else default
      expect(await tfUsdcCollateral.prevReferencePrice()).to.be.lt(
        await tfUsdcCollateral.refPerTok()
      )
      expect(await tfUsdcCollateral.strictPrice()).to.be.closeTo(fp('1'), fp('0.1'))

      // Check claim data
      await expect(tfUsdcCollateral.claimRewards())
        .to.emit(tfUsdcCollateral, 'RewardsClaimed')
        .withArgs(truToken.address, 0)
      expect(await tfUsdcCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(truToken.address)
      expect(ERC20s[3]).to.equal(tfUsdc.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(truAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(tfUsdcCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(tfUsdcCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(tfUsdc.address)
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
      await tfUsdc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        TfTokenCollateralFactory.deploy(
          fp('1.03'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          tfUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          delayUntilDefault,
          (await usdc.decimals()).toString(),
          truToken.address as string
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferenceERC20Decimals
      await expect(
        TfTokenCollateralFactory.deploy(
          fp('1.03'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          tfUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          0,
          truToken.address as string
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await tfUsdc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1tfUsdc: BigNumber = await tfUsdc.balanceOf(addr1.address)

      // Check rates and prices
      const tfUsdcPrice1: BigNumber = await tfUsdcCollateral.strictPrice() // ~ 1.05 usd
      const tfUsdcRefPerTok1: BigNumber = await tfUsdcCollateral.refPerTok() // ~ 1.05 usd

      expect(tfUsdcPrice1).to.be.closeTo(fp('1.05'), fp('0.01'))
      expect(tfUsdcRefPerTok1).to.be.closeTo(fp('1.05'), fp('0.01'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh tfUSDC manually (required)
      await tfUsdcCollateral.refresh()
      expect(await tfUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const tfUsdcPrice2: BigNumber = await tfUsdcCollateral.strictPrice() // ~1.05
      const tfUsdcRefPerTok2: BigNumber = await tfUsdcCollateral.refPerTok() // ~1.05

      // Check rates and price increase
      expect(tfUsdcPrice2).to.be.gt(tfUsdcPrice1)
      expect(tfUsdcRefPerTok2).to.be.gt(tfUsdcRefPerTok1)

      // Still close to the original values
      expect(tfUsdcPrice2).to.be.closeTo(fp('1.05'), fp('0.01'))
      expect(tfUsdcRefPerTok2).to.be.closeTo(fp('1.05'), fp('0.01'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh tfUSDC manually (required)
      await tfUsdcCollateral.refresh()
      expect(await tfUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const tfUsdcPrice3: BigNumber = await tfUsdcCollateral.strictPrice()
      const tfUsdcRefPerTok3: BigNumber = await tfUsdcCollateral.refPerTok()

      // Check rates and price increase
      expect(tfUsdcPrice3).to.be.gt(tfUsdcPrice2)
      expect(tfUsdcRefPerTok3).to.be.gt(tfUsdcRefPerTok2)

      // Need to adjust ranges
      expect(tfUsdcPrice3).to.be.closeTo(fp('1.06'), fp('0.01'))
      expect(tfUsdcRefPerTok3).to.be.closeTo(fp('1.06'), fp('0.01'))

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
      const newBalanceAddr1tfUsdc: BigNumber = await tfUsdc.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1tfUsdc.sub(balanceAddr1tfUsdc)).to.be.closeTo(bn('9433e6'), bn('100e6')) // ~1.06 * 9433 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await tfUsdc.balanceOf(backingManager.address)).to.be.closeTo(bn('1040e5'), bn('10e5')) // ~=110 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('110.3'), // ~= 110 usd (from above)
        fp('1')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await truToken.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [truToken.address, bn(0)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await truToken.balanceOf(backingManager.address)).to.equal(0)

      // Provide approvals for issuances
      await tfUsdc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 6).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await truToken.balanceOf(backingManager.address)).to.equal(0)
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Fallback price is returned
      const [isFallback, price] = await tfUsdcCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1.03'))

      // Refresh should mark status IFFY
      await tfUsdcCollateral.refresh()
      expect(await tfUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)

      // TfTokens Collateral with no price
      const nonpriceTftokenCollateral: TfUsdcCollateral = <TfUsdcCollateral>await (
        await ethers.getContractFactory('TfUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1.03'),
        NO_PRICE_DATA_FEED,
        tfUsdc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        await usdc.decimals(),
        truToken.address as string
      )

      // TfTokens - Collateral with no price info should revert
      await expect(nonpriceTftokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceTftokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceTftokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceTftokenCollateral: TfUsdcCollateral = <TfUsdcCollateral>await (
        await ethers.getContractFactory('TfUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1.03'),
        mockChainlinkFeed.address,
        tfUsdc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        await usdc.decimals(),
        truToken.address as string
      )

      await setOraclePrice(invalidpriceTftokenCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceTftokenCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceTftokenCollateral.refresh()
      expect(await invalidpriceTftokenCollateral.status()).to.equal(CollateralStatus.IFFY)
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
      const newtfUsdcCollateral: TfUsdcCollateral = <TfUsdcCollateral>await (
        await ethers.getContractFactory('TfUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1.03'),
        mockChainlinkFeed.address,
        await tfUsdcCollateral.erc20(),
        await tfUsdcCollateral.maxTradeVolume(),
        await tfUsdcCollateral.oracleTimeout(),
        await tfUsdcCollateral.targetName(),
        await tfUsdcCollateral.defaultThreshold(),
        await tfUsdcCollateral.delayUntilDefault(),
        18,
        truToken.address
      )

      // Check initial state
      expect(await newtfUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newtfUsdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newtfUsdcCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newtfUsdcCollateral.refresh())
        .to.emit(newtfUsdcCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newtfUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newtfUsdcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newtfUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // TfToken
      const prevWhenDefault: BigNumber = await newtfUsdcCollateral.whenDefault()
      await expect(newtfUsdcCollateral.refresh()).to.not.emit(
        newtfUsdcCollateral,
        'CollateralStatusChanged'
      )
      expect(await newtfUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newtfUsdcCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a TfToken mock to be able to change the rate
      const TfTokenMockFactory: ContractFactory = await ethers.getContractFactory('TfTokenMock')
      const symbol = await tfUsdc.symbol()
      const tfUsdcMock: TfTokenMock = <TfTokenMock>(
        await TfTokenMockFactory.deploy(symbol + ' Token', symbol, usdc.address)
      )
      // Set initial exchange rate to the new tfUsdc Mock
      await tfUsdcMock.setPoolValue(fp('1'))
      await tfUsdcMock.setTotalSupply(fp('1'))
      // Redeploy plugin using the new tfUsdc mock
      const newtfUsdcCollateral: TfUsdcCollateral = <TfUsdcCollateral>await (
        await ethers.getContractFactory('TfUsdcCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1.03'),
        await tfUsdcCollateral.chainlinkFeed(),
        tfUsdcMock.address,
        await tfUsdcCollateral.maxTradeVolume(),
        await tfUsdcCollateral.oracleTimeout(),
        await tfUsdcCollateral.targetName(),
        await tfUsdcCollateral.defaultThreshold(),
        await tfUsdcCollateral.delayUntilDefault(),
        18,
        truToken.address
      )

      // Check initial state
      expect(await newtfUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newtfUsdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for tfUsdc, will disable collateral immediately
      await tfUsdcMock.setPoolValue(fp('0.9'))
      await tfUsdcMock.setTotalSupply(fp('1'))

      // Force updates - Should update whenDefault and status for TfUsdc
      await expect(newtfUsdcCollateral.refresh())
        .to.emit(newtfUsdcCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newtfUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newtfUsdcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidTfTokenCollateral: TfUsdcCollateral = <TfUsdcCollateral>(
        await TfTokenCollateralFactory.deploy(
          fp('1.03'),
          invalidChainlinkFeed.address,
          await tfUsdcCollateral.erc20(),
          await tfUsdcCollateral.maxTradeVolume(),
          await tfUsdcCollateral.oracleTimeout(),
          await tfUsdcCollateral.targetName(),
          await tfUsdcCollateral.defaultThreshold(),
          await tfUsdcCollateral.delayUntilDefault(),
          18,
          truToken.address
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

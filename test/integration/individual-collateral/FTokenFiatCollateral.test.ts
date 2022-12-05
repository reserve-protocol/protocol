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
  FTokenFiatCollateral,
  FTokenMock,
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

// Holder address in Mainnet
const holderFFRAXCRV = '0xfcf7c8fb47855e04a1bee503d1091b65359c6009'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`FTokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let frax: ERC20Mock
  let fFraxCrv: FTokenMock 
  let fTokenCollateral: FTokenFiatCollateral
  // let compToken: ERC20Mock
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

  let FTokenCollateralFactory: ContractFactory
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

    // FRAX token
    frax = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.FRAX || '')
    )
    // fFRAXCRV token
    fFraxCrv = <FTokenMock>(
      await ethers.getContractAt('FTokenMock', networkConfig[chainId].tokens.fFRAXCRV || '')
    )

    // Deploy fFraxCrv collateral plugin
    FTokenCollateralFactory = await ethers.getContractFactory('FTokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    fTokenCollateral = <FTokenFiatCollateral>(
      await FTokenCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.FRAX as string, // frax chainlink feed
        fFraxCrv.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        (await frax.decimals()).toString(),
        {gasLimit: 5000000}
      )
    )

    await fTokenCollateral.deployed();

    // Setup balances for addr1 - Transfer from Mainnet holder
    // fFRAXCRV
    initialBal = bn('75e18')
    
    await whileImpersonating(holderFFRAXCRV, async (ffraxcrvSigner) => {
      await fFraxCrv.connect(ffraxcrvSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [fTokenCollateral.address],
      weights: [fp('1')],
      backups: [],
      beneficiary: ZERO_ADDRESS,
      revShare: { rTokenDist: bn('0'), rsrDist: bn('0') },
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
      // Check Collateral plugin
      // fFRAXCRV (FTokenFiatCollateral)
      expect(await fTokenCollateral.isCollateral()).to.equal(true)
      expect(await fTokenCollateral.referenceERC20Decimals()).to.equal(await frax.decimals())
      expect(await fTokenCollateral.erc20()).to.equal(fFraxCrv.address)
      expect(await fFraxCrv.decimals()).to.equal(18)
      expect(await fTokenCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await fTokenCollateral.refPerTok()).to.be.closeTo(fp('1'), fp('0.01'))
      expect(await fTokenCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await fTokenCollateral.pricePerTarget()).to.be.closeTo(fp('1'), fp('0.01'))
      expect(await fTokenCollateral.prevReferencePrice()).to.equal(await fTokenCollateral.refPerTok())
      expect(await fTokenCollateral.strictPrice()).to.be.closeTo(fp('1'), fp('1')) // close to $1

      // TODO: Check claim data 
      // await expect(fTokenCollateral.claimRewards())
      //   .to.emit(undefined);
      expect(await fTokenCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(fFraxCrv.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(fTokenCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(fTokenCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(fFraxCrv.address)
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
      const issueAmount: BigNumber = bn('10e18')
      // await fFraxCrv.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
      await fFraxCrv.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        FTokenCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.FRAX as string,
          fFraxCrv.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          delayUntilDefault,
          (await frax.decimals()).toString(),
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferenceERC20Decimals
      await expect(
        FTokenCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.FRAX as string,
          fFraxCrv.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          0,
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      // await fFraxCrv.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
      await fFraxCrv.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1fFraxCrv: BigNumber = await fFraxCrv.balanceOf(addr1.address)

      // Check rates and prices
      const fFraxCrvPrice1: BigNumber = await fTokenCollateral.strictPrice() // ~ $1 
      const fFraxCrvRefPerTok1: BigNumber = await fTokenCollateral.refPerTok() // ~ $1 

      expect(fFraxCrvPrice1).to.be.closeTo(fp('1'), fp('0.01'))
      expect(fFraxCrvRefPerTok1).to.be.closeTo(fp('1'), fp('0.01'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('0.05')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await fTokenCollateral.refresh()
      expect(await fTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const fFraxCrvPrice2: BigNumber = await fTokenCollateral.strictPrice() // ~$1
      const fFraxCrvRefPerTok2: BigNumber = await fTokenCollateral.refPerTok() // ~$1

      // Check rates and price increase
      expect(fFraxCrvPrice2).to.be.gt(fFraxCrvPrice1)
      expect(fFraxCrvRefPerTok2).to.be.gt(fFraxCrvRefPerTok1)

      // Still close to the original values
      expect(fFraxCrvPrice2).to.be.closeTo(fp('1'), fp('0.01'))
      expect(fFraxCrvRefPerTok2).to.be.closeTo(fp('1'), fp('0.01'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await fTokenCollateral.refresh()
      expect(await fTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const fFraxCrvPrice3: BigNumber = await fTokenCollateral.strictPrice() // ~$1.5
      const fFraxCrvRefPerTok3: BigNumber = await fTokenCollateral.refPerTok() // ~$1.5

      // Check rates and price increase
      expect(fFraxCrvPrice3).to.be.gt(fFraxCrvPrice2)
      expect(fFraxCrvRefPerTok3).to.be.gt(fFraxCrvRefPerTok2)

      // Need to adjust ranges
      expect(fFraxCrvPrice3).to.be.closeTo(fp('1.5'), fp('0.01'))
      expect(fFraxCrvRefPerTok3).to.be.closeTo(fp('1.5'), fp('0.01'))

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

      // Check balances - Fewer cTokens should have been sent to the user
      const newBalanceAddr1fFraxCrv: BigNumber = await fFraxCrv.balanceOf(addr1.address)

      // Check received tokens represent ~$10 in value at current prices
      expect(newBalanceAddr1fFraxCrv.sub(balanceAddr1fFraxCrv)).to.be.closeTo(bn('6.6e18'), bn('1e17')) // ~$1.5 * 6.6 ~= $10 (100% of basket)

      // Check remainders in Backing Manager
      expect(await fFraxCrv.balanceOf(backingManager.address)).to.be.closeTo(bn('3.3e18'), bn('1e17')) // ~= 4.95 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('4.95'), // ~= 4.95 usd (from above)
        fp('0.03')
      )
    })
  })

  // TODO: check for rewards
  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  // describe('Rewards', () => {
  //   it('Should be able to claim rewards (if applicable)', async () => {
  //     const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
  //     const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

  //     // Try to claim rewards at this point - Nothing for Backing Manager
  //     expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

  //     await expectEvents(backingManager.claimRewards(), [
  //       {
  //         contract: backingManager,
  //         name: 'RewardsClaimed',
  //         args: [compToken.address, bn(0)],
  //         emitted: true,
  //       },
  //     ])

  //     // No rewards so far
  //     expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

  //     // Provide approvals for issuances
  //     await fFraxCrv.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

  //     // Issue rTokens
  //     await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

  //     // Check RTokens issued to user
  //     expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

  //     // Now we can claim rewards - check initial balance still 0
  //     expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

  //     // Advance Time
  //     await advanceTime(8000)

  //     // Claim rewards
  //     await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

  //     // Check rewards both in COMP and stkAAVE
  //     const rewardsCOMP1: BigNumber = await compToken.balanceOf(backingManager.address)

  //     expect(rewardsCOMP1).to.be.gt(0)

  //     // Keep moving time
  //     await advanceTime(3600)

  //     // Get additional rewards
  //     await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

  //     const rewardsCOMP2: BigNumber = await compToken.balanceOf(backingManager.address)

  //     expect(rewardsCOMP2.sub(rewardsCOMP1)).to.be.gt(0)
  //   })
  // })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expect(fTokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await fTokenCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await fTokenCollateral.refresh()
      expect(await fTokenCollateral.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: FTokenFiatCollateral = <FTokenFiatCollateral>await (
        await ethers.getContractFactory('FTokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED, // TODO: figure out how this should be configured
        fFraxCrv.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        await frax.decimals(),
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceCtokenCollateral: FTokenFiatCollateral = <FTokenFiatCollateral>await (
        await ethers.getContractFactory('FTokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address, // TODO: figure out how this should be configured
        fFraxCrv.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        await frax.decimals()
      )

      await setOraclePrice(invalidpriceCtokenCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceCtokenCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceCtokenCollateral.refresh()
      expect(await invalidpriceCtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
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
      const newFTokenCollateral: FTokenFiatCollateral = <FTokenFiatCollateral>await (
        await ethers.getContractFactory('FTokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        await fTokenCollateral.erc20(),
        await fTokenCollateral.maxTradeVolume(),
        await fTokenCollateral.oracleTimeout(),
        await fTokenCollateral.targetName(),
        await fTokenCollateral.defaultThreshold(),
        await fTokenCollateral.delayUntilDefault(),
        18,
      )

      // Check initial state
      expect(await newFTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newFTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newFTokenCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newFTokenCollateral.refresh())
        .to.emit(newFTokenCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newFTokenCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newFTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newFTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newFTokenCollateral.whenDefault()
      await expect(newFTokenCollateral.refresh()).to.not.emit(
        newFTokenCollateral,
        'DefaultStatusChanged'
      )
      expect(await newFTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newFTokenCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const FTokenMockFactory: ContractFactory = await ethers.getContractFactory('FTokenMock')
      const symbol = await fFraxCrv.symbol()
      const fFraxCrvMock: FTokenMock = <FTokenMock>(
        await FTokenMockFactory.deploy(symbol + ' Token', symbol)
      )
      // Set initial exchange rate to the new fFraxCrv Mock
      await fFraxCrvMock.setAssetsPerShare(fp('1'))

      // Redeploy plugin using the new fFraxCrv mock
      const newFTokenCollateral: FTokenFiatCollateral = <FTokenFiatCollateral>await (
        await ethers.getContractFactory('FTokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await fTokenCollateral.chainlinkFeed(),
        fFraxCrvMock.address,
        await fTokenCollateral.maxTradeVolume(),
        await fTokenCollateral.oracleTimeout(),
        await fTokenCollateral.targetName(),
        await fTokenCollateral.defaultThreshold(),
        await fTokenCollateral.delayUntilDefault(),
        18,
      )

      // Check initial state
      expect(await newFTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newFTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for fFRAXCRV, will disable collateral immediately
      await fFraxCrvMock.setAssetsPerShare(fp('0.94')) 
      // TODO: add more functions to the mock contract, so we can test more stuff?

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newFTokenCollateral.refresh())
        .to.emit(newFTokenCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newFTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newFTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidFTokenCollateral: FTokenFiatCollateral = <FTokenFiatCollateral>(
        await FTokenCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await fTokenCollateral.erc20(),
          await fTokenCollateral.maxTradeVolume(),
          await fTokenCollateral.oracleTimeout(),
          await fTokenCollateral.targetName(),
          await fTokenCollateral.defaultThreshold(),
          await fTokenCollateral.delayUntilDefault(),
          18,
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidFTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidFTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidFTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidFTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

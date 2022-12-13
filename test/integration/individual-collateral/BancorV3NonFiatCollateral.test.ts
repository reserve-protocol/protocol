import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, utils, Wallet } from 'ethers'
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
import { CollateralStatus,MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents,expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp} from '../../utils/time'
import {
  Asset,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  BancorV3NonFiatCollateral,
  IBnTokenERC20,
  IStandardRewards,
  InvalidMockV3Aggregator,
  IAutoCompoundingRewards,
  ERC20,
  BnTokenMock,
} from '../../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const HOLDER_BNETH = '0xb0b958398abb0b5db4ce4d7598fb868f5a00f372'

const NO_PRICE_DATA_FEED = '0x05Cf62c4bA0ccEA3Da680f9A8744Ac51116D6231'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`BancorV3NonFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let dai: ERC20Mock
  let bnETH: ERC20Mock
  let bnETHMock: BnTokenMock
  let BancorV3Collateral: BancorV3NonFiatCollateral
  let bancorProxy: IBnTokenERC20
  let rewardsProxy: IStandardRewards
  let autoProcessRewardsProxy: IAutoCompoundingRewards
  let bancorToken: ERC20Mock
  let bancorAsset: Asset
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

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let BancorV3CollateralFactory: ContractFactory
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


    bnETH = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.bnETH || '')
    )

    bnETHMock = <BnTokenMock>(
      await ethers.getContractAt('BnTokenMock', networkConfig[chainId].tokens.bnETH || '')
    )

    bancorProxy = <IBnTokenERC20>(
      await ethers.getContractAt('IBnTokenERC20', networkConfig[chainId].BANCOR_PROXY || '')
    )

    rewardsProxy = <IStandardRewards>(
      await ethers.getContractAt(
        'IStandardRewards',
        networkConfig[chainId].BANCOR_REWARDS_PROXY || ''
      )
    )

    autoProcessRewardsProxy = <IAutoCompoundingRewards>(
      await ethers.getContractAt(
        'IAutoCompoundingRewards',
        networkConfig[chainId].BANCOR_PROCESSING_PROXY || ''
      )
    )

    bancorToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.BNT || '')
    )

    bancorAsset = <Asset>(
      await (
        await ethers.getContractFactory('Asset')
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.BNT || '',
        bancorToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT
      )
    )

    // Deploy BancorV3 collateral plugin
    BancorV3CollateralFactory = await ethers.getContractFactory('BancorV3NonFiatCollateral', {})
    BancorV3Collateral = <BancorV3NonFiatCollateral>(
      await BancorV3CollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        bnETH.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault,
        bancorProxy.address,
        rewardsProxy.address,
        autoProcessRewardsProxy.address
      )
    )

    // Setup balances of bnETH for addr1 - Transfer from Mainnet holder
    await whileImpersonating(HOLDER_BNETH, async (bnETHSigner) => {
      await bnETH.connect(bnETHSigner).transfer(addr1.address, bn('100e18'))
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
      assets: [bancorAsset.address],
      primaryBasket: [BancorV3Collateral.address],
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
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e18'))
  })
  
  describe('Deployment', () => {
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // COMP Asset
      expect(await bancorAsset.isCollateral()).to.equal(false)
      expect(await bancorAsset.erc20()).to.equal(bancorToken.address)
      expect(await bancorAsset.erc20()).to.equal(networkConfig[chainId].tokens.BNT)
      expect(await bancorToken.decimals()).to.equal(18)
      expect(await bancorAsset.strictPrice()).to.be.closeTo(fp('0.4'), fp('0.3')) 
      await expect(bancorAsset.claimRewards()).to.not.emit(bancorAsset, 'RewardsClaimed')
      expect(await bancorAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      expect(await bancorProxy.address).to.equal(networkConfig[chainId].BANCOR_PROXY)
      expect(await BancorV3Collateral.isCollateral()).to.equal(true)
      expect(await BancorV3Collateral.erc20Decimals()).to.equal(await bnETH.decimals())
      expect(await BancorV3Collateral.erc20()).to.equal(bnETH.address)
      expect(await BancorV3Collateral.targetName()).to.equal(
        ethers.utils.formatBytes32String('ETH')
      )
      expect(await BancorV3Collateral.targetPerRef()).to.equal(fp('1'))
      expect(await BancorV3Collateral.pricePerTarget()).to.equal(fp('1121.37265236'))
      expect(await BancorV3Collateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await BancorV3Collateral.refPerTok()).to.be.closeTo(fp('1.1'), fp('0.1')) 
      expect(await BancorV3Collateral.strictPrice()).to.be.closeTo(fp('1200'), fp('500')) 

      await expect(BancorV3Collateral.claimRewards())
        .to.emit(BancorV3Collateral, 'RewardsClaimed')
        .withArgs(bancorToken.address, 0)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })
    

    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(bancorToken.address)
      expect(ERC20s[3]).to.equal(bnETH.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(bancorAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(BancorV3Collateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(BancorV3Collateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(bnETH.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1121'), fp('1'))

      // Check RToken price
      const issueAmount: BigNumber = bn('10e18')
      await bnETH.connect(addr1).approve(rToken.address, issueAmount.mul(100))
      await bnETH.connect(addr1).increaseAllowance(rToken.address,issueAmount.mul(100))
      expect(await rToken.connect(addr1).balanceOf(addr1.address)).to.equal(bn('0'))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1000'), fp('150'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        BancorV3CollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          bnETH.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          bn(0),
          delayUntilDefault,
          bancorProxy.address,
          rewardsProxy.address,
          autoProcessRewardsProxy.address
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // Comptroller
      await expect(
        BancorV3CollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          bnETH.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          defaultThreshold,
          delayUntilDefault,
          bancorProxy.address,
          ZERO_ADDRESS,
          autoProcessRewardsProxy.address
        )
      ).to.be.revertedWith('standardRewards missing')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('100e8')
    // values at block 15000000
    // bnETHPrice1 = 1123214985732310979533
    // bnETHRefPerTok1 = 1001642926968509239
    // values after 2000 blocks from initial forkblock (block: 15002000)
    const bnETHPrice2_hardcode = bn('1161863513664381091050')
    const bnETHRefPerTok2_hardcode = bn('1001651647650058758')
    // values after 102000 blocks from initial forkblock (block: 15102000)
    const bnETHPrice3_hardcode = bn('1218326346354864650813')
    const bnETHRefPerTok3_hardcode = bn('1002079643799180510')
 

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await bnETH.connect(addr1).approve(rToken.address,issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1bnETH: BigNumber = await bnETH.balanceOf(addr1.address)

      // Check rates and prices
      const bnETHPrice1: BigNumber = await BancorV3Collateral.strictPrice() // 
      const bnETHRefPerTok1: BigNumber = await BancorV3Collateral.refPerTok() // 
      
      expect(bnETHPrice1).to.be.closeTo(fp('1000'), fp('150'))
      expect(bnETHRefPerTok1).to.be.closeTo(fp('1'), fp('0.5'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) 

      await advanceTime(2000)
      await advanceBlocks(2000)

      // Refresh BnToken manually (required)
      await BancorV3Collateral.refresh()
      expect(await BancorV3Collateral.status()).to.equal(CollateralStatus.SOUND)
      
      // Check rates and prices - Have changed, slight inrease
      const bnETHPrice2: BigNumber = await BancorV3Collateral.strictPrice()
      const bnETHRefPerTok2: BigNumber = await BancorV3Collateral.refPerTok() 

      // Check rates and price increase
      expect(bnETHPrice2).to.be.gte(bnETHPrice1)
      expect(bnETHRefPerTok2).to.be.gte(bnETHRefPerTok1)
      
      expect(bnETHPrice2_hardcode).to.be.gt(bnETHPrice1)
      expect(bnETHRefPerTok2_hardcode).to.be.gt(bnETHRefPerTok1)

      // Still close to the original values
      expect(bnETHPrice2).to.be.closeTo(fp('1100'), fp('150'))
      expect(bnETHRefPerTok2).to.be.closeTo(fp('1'), fp('0.5'))

      expect(bnETHPrice2_hardcode).to.be.closeTo(fp('1100'), fp('150'))
      expect(bnETHRefPerTok2_hardcode).to.be.closeTo(fp('1'), fp('0.5'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gte(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000)
      await advanceBlocks(100000)

      // Refresh BnToken manually (required)
      await BancorV3Collateral.refresh()
      expect(await BancorV3Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const bnETHPrice3: BigNumber = await BancorV3Collateral.strictPrice()
      const bnETHRefPerTok3: BigNumber = await BancorV3Collateral.refPerTok()

      // Check rates and price increase
      expect(bnETHPrice3).to.be.gte(bnETHPrice2)
      expect(bnETHRefPerTok3).to.be.gte(bnETHRefPerTok2)

      expect(bnETHPrice3_hardcode).to.be.gt(bnETHPrice2)
      expect(bnETHRefPerTok3_hardcode).to.be.gt(bnETHRefPerTok2)

      // Need to adjust ranges
      expect(bnETHPrice3).to.be.closeTo(fp('1200'), fp('150'))
      expect(bnETHRefPerTok3).to.be.closeTo(fp('1'), fp('0.5'))

      expect(bnETHPrice3_hardcode).to.be.closeTo(fp('1200'), fp('150'))
      expect(bnETHRefPerTok3_hardcode).to.be.closeTo(fp('1'), fp('0.5'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gte(totalAssetValue2)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer BnTokens should have been sent to the user
      const newBalanceAddr1bnETH: BigNumber = await bnETH.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1bnETH.sub(balanceAddr1bnETH)).to.equal(9983597678)

      // Check remainders in Backing Manager
      expect(await bnETH.balanceOf(backingManager.address)).to.be.closeTo(bn(1), bn(1e8))

      // Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        bn('1123'),
        bn('0.5')
      )
    }) 
       
  })

  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('20e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await bancorToken.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [bancorToken.address, bn(0)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await bancorToken.balanceOf(backingManager.address)).to.equal(0)

      // Provide approvals for issuances
      await bnETH.connect(addr1).approve(rToken.address,issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await bancorToken.balanceOf(backingManager.address)).to.equal(0)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards both in COMP and stkAAVE
      const rewardsBNT1: BigNumber = await bancorToken.balanceOf(backingManager.address)

      expect(rewardsBNT1).to.be.gte(0)

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardsBNT2: BigNumber = await bancorToken.balanceOf(backingManager.address)

      expect(rewardsBNT2.sub(rewardsBNT1)).to.be.gte(0)
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Fallback price is returned
      const [isFallback, price] = await BancorV3Collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))


      // BancorV3 Collateral with no price
      const nonpriceBancorV3Collateral: BancorV3NonFiatCollateral = <BancorV3NonFiatCollateral>await (
        await ethers.getContractFactory('BancorV3NonFiatCollateral', {})
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED,
        bnETH.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault,
        bancorProxy.address,
        rewardsProxy.address,
        autoProcessRewardsProxy.address
      )

      // BnTokens - Collateral with no price info should revert
      await expect(nonpriceBancorV3Collateral.strictPrice()).to.be.reverted

      expect(await nonpriceBancorV3Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceBancorV3Collateral: BancorV3NonFiatCollateral = <BancorV3NonFiatCollateral>await (
        await ethers.getContractFactory('BancorV3NonFiatCollateral', {})
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        bnETH.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault,
        bancorProxy.address,
        rewardsProxy.address,
        autoProcessRewardsProxy.address
      )

      await setOraclePrice(invalidpriceBancorV3Collateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceBancorV3Collateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status SOUND
      await invalidpriceBancorV3Collateral.refresh()
      expect(await invalidpriceBancorV3Collateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  describe('Collateral Status', () => {

    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const BnTokenMockFactory = await ethers.getContractFactory('BnTokenMock')
      const bnETHMock: BnTokenMock = await BnTokenMockFactory.deploy('Ether', 'ETH')

      await bnETHMock.connect(owner).mint(addr1.address, fp('1e8'))

      // Set initial exchange rate to the new bnToken Mock
      await bnETHMock.setUnderlying(fp('0.002'))

      // Redeploy plugin using the new bnToken mock
      const newBnTokenCollateral = <BancorV3NonFiatCollateral>await BancorV3CollateralFactory.deploy(
        fp('1'),
        mockChainlinkFeed.address,
        bnETH.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault,
        bnETHMock.address,
        rewardsProxy.address,
        autoProcessRewardsProxy.address
      )

      // Initialize internal state of max redPerTok
      await newBnTokenCollateral.refresh()

      // Check initial state
      expect(await newBnTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newBnTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for bnToken, will disable collateral immediately
      await bnETHMock.setUnderlying(bn('1e7'))

      // Force updates - Should update whenDefault and status for collateral
      await expect(newBnTokenCollateral.refresh())
        .to.emit(newBnTokenCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newBnTokenCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newBnTokenCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })
    // Test for soft default
    it('Updates status in case of soft default', async () => {
      // `ref` == `target` so there is be no need to run this test
      })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      // `ref` == `target` so there is be no need to run this test
      })
  })
})

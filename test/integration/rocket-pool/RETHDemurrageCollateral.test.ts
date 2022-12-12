import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, providers, Wallet } from 'ethers'
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
import { bn, fp, toBNDecimals, ZERO } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  REthDemurrageCollateral,
  REthDemurrageCollateralMock,
  IREthToken,
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
import forkBlockNumber from '../fork-block-numbers'


const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderRETH = '0xeadb3840596cabf312f2bc88a4bb0b93a4e1ff5f'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = process.env.FORK ? describe : describe

describeFork(`REthDemurrageCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let rEth: IREthToken
  let rEthCollateral: REthDemurrageCollateral
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

  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let REthCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {

    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    // Fork at designated block number - REQUIRED
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{forking: {
            jsonRpcUrl: process.env.MAINNET_RPC_URL,
            blockNumber: forkBlockNumber['mainnet-deployment']
          },},],
      });
      

    //expect(await ethers.provider.getBlockNumber()).to.equal('15690042')
  })

  beforeEach(async () => {

    ;[owner, addr1] = await ethers.getSigners()

    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // Get required contracts for rETH

    // rToken ETH
    rEth = <IREthToken>(
      await ethers.getContractAt('IREthToken', networkConfig[chainId].tokens.rETH || '')
    )

    // Deploy rETH collateral plugin
    REthCollateralFactory = await ethers.getContractFactory('REthDemurrageCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    rEthCollateral = <REthDemurrageCollateral>(
      await REthCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        rEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('DMR365rETH'),
        delayUntilDefault,
        ('18'),
        28,
        10,
        {gasLimit: 5000000}
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // rEth
    initialBal = bn('50e18')
    await whileImpersonating(holderRETH, async (rEthSigner) => {
      await rEth.connect(rEthSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [rEthCollateral.address],
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

      // Check Collateral plugin
      // rEth (REthDemurrageCollateral)
      expect(await rEthCollateral.isCollateral()).to.equal(true)
      expect(await rEthCollateral.referenceERC20Decimals()).to.equal(18) // ether decimals
      expect(await rEthCollateral.erc20()).to.equal(rEth.address)
      //expect(await rEth.decimals()).to.equal(18)
      expect(await rEthCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('DMR365rETH'))
      expect(await rEthCollateral.refPerTok()).to.be.closeTo(fp('1'), fp('0.01'))
      expect(await rEthCollateral.targetPerRef()).to.equal(fp('1')) 
      expect(await rEthCollateral.pricePerTarget()).to.equal(fp('1368.77682315'))// $1368.77
      await rEthCollateral.refresh()
      expect(await rEthCollateral.latestRefPerTok()).to.equal(bn('1000000000000000000'));
      expect(await rEthCollateral.strictPrice()).to.be.closeTo(fp('1423'), fp('1')) // 


      expect(await rEthCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)

      const rEthPrice2: BigNumber = await rEthCollateral.strictPrice() 
      const rEthRefPerTok2: BigNumber = await rEthCollateral.refPerTok() 

   


    })


    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(rEth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(rEthCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(rEthCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(rEth.address as string)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(ZERO)
      expect(await basketHandler.timestamp()).to.be.gt(ZERO)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(ZERO)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      
     
      expect(price).to.be.closeTo(fp((1423).toString()), fp('1e10'))

      // Check RToken price
      const issueAmount: BigNumber = bn('1e18')
      await rEth.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(bn('1e18'))).to.emit(rToken, 'Issuance')


    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // ReferemceERC20Decimals
      await expect(
        REthCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          rEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('RETH'),
          delayUntilDefault,
          0,
          28,
          10,
          {gasLimit: 5000000}
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })
  })})

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('1e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = bn('1e18') // instant issuance

      // Provide approvals for issuances
      await rEth.connect(addr1).approve(rToken.address, issueAmount)
      
      // Issue rEth
      await expect(rToken.connect(addr1).issue(bn("1e18"))).to.emit(rToken, 'Issuance')

      // Check rEth issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(bn("1e18"))

      // Store Balances after issuance
      const balanceAddr1rEth: BigNumber = await rEth.balanceOf(addr1.address)
      // Check rates and prices
      const rEthPrice1: BigNumber = await rEthCollateral.strictPrice() 
      const rEthRefPerTok1: BigNumber = await rEthCollateral.refPerTok() 
      expect(rEthPrice1).to.be.closeTo(fp('1423'), fp('1'))
      expect(rEthRefPerTok1).to.be.closeTo(bn("1e7"), fp('1e6'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(rEthPrice1).to.be.closeTo(fp('1423'), fp('1')) // approx 1.423K in value
      // Advance time and blocks slightly, causing refPerTok() to increase

      // to save gas on exponentiations this plugin requires refresh calls at most every x-1 days, with x being the maximum amount
      // days without refreshes.

      for(let i = 0; i < 10; i++){
       
        await advanceTime(3600 * 24 * 2)
        await advanceBlocks(3600 * 24 * 2)
        await rEthCollateral.refresh();
      
      }
      
     
      // Refresh rEth manually (required)
      await rEthCollateral.refresh()
      expect(await rEthCollateral.status()).to.equal(CollateralStatus.SOUND)
      await rEthCollateral.refresh()

      await whileImpersonating(holderRETH, async (rEthSigner) => {
        await rEth.connect(rEthSigner).burn(fp('2'))
      })
      await advanceTime(3600 * 24)
        await advanceBlocks(3600 * 24)
      await rEthCollateral.refresh();
      // Check rates and prices - Have changed, slight inrease
      const rEthPrice2: BigNumber = await rEthCollateral.strictPrice() 
      const rEthRefPerTok2: BigNumber = await rEthCollateral.refPerTok() 

      // Check rates and price increase
      expect(rEthPrice2).to.be.gt(rEthPrice1)
      expect(rEthRefPerTok2).to.be.gt(rEthRefPerTok1)

      // Still close to the original values
      expect(rEthPrice1).to.be.closeTo(fp('1423'), fp('1'))
      expect(rEthRefPerTok1).to.be.closeTo(bn("1e7"), fp('1e6'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      //expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      await rEthCollateral.refresh()
      
      // advance 800 days
      for(let i = 0; i < 400; i++){
       
        await advanceTime(3600 * 24 * 2)
        await advanceBlocks(3600 * 24 * 2)
        await rEthCollateral.refresh();
      
      }

      expect(await rEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const rEthPrice3: BigNumber = await rEthCollateral.strictPrice() // ~0.03294
      const rEthRefPerTok3: BigNumber = await rEthCollateral.refPerTok() // ~0.03294

      // Check rates and price increase
      expect(rEthPrice3).to.be.gt(rEthPrice2)
      expect(rEthRefPerTok3).to.be.gt(rEthRefPerTok2)

      // Need to adjust ranges
      expect(rEthPrice3).to.be.closeTo(fp('1429'), fp('1'))
      expect(rEthRefPerTok3).to.be.closeTo(fp('1'), fp('0.1'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      // Redeem REth with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer cTokens should have been sent to the user
      const newBalanceAddr1rEth: BigNumber = await rEth.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1rEth.sub(balanceAddr1rEth)).to.be.closeTo(fp('1'), fp('0.1'))

      // Check remainders in Backing Manager
      expect(await rEth.balanceOf(backingManager.address)).to.be.closeTo(bn('3.96e15'), bn('1e13')) 

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('5.6'), 
        fp('0.1')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      

      // Deploy rETH collateral plugin
    REthCollateralFactory = await ethers.getContractFactory('REthDemurrageCollateralMock', {
      libraries: { OracleLib: oracleLib.address },
    })
    let rEthCollateralMock = <REthDemurrageCollateralMock>(
      await REthCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        rEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('DMR365rETH'),
        delayUntilDefault,
        ('18'),
        28,
        10,
        {gasLimit: 5000000}
      )
    )
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // this timeout is large enough so that it defaults the collateral plugin by having a period too big between refresh() calls.
      // in order to handle this, one can implement a mock contract that is able to refresh without updating status based on refPerTok().
      
      await expect(rEthCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(rEthCollateralMock.strictPrice()).to.be.revertedWith('StalePrice()')
      // Fallback price is returned
      const [isFallback, price] = await rEthCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))
      const [isFallback2, price2] = await rEthCollateralMock.price(true)

   
      // Refresh should mark status IFFY
      await rEthCollateralMock.refresh()
      expect(await rEthCollateralMock.status()).to.equal(CollateralStatus.IFFY)

      await rEthCollateral.refresh()
      expect(await rEthCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // rEth Collateral with no price
      const nonpriceREthCollateral: REthDemurrageCollateral = <REthDemurrageCollateral>await (
        await ethers.getContractFactory('REthDemurrageCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED,
        rEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('WETH'),
        delayUntilDefault,
        ('18'),
        28,
        10,
        {gasLimit: 5000000}
      )


      // rEth - Collateral with no price info should revert
      await expect(nonpriceREthCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceREthCollateral.refresh()).to.be.reverted
      expect(await nonpriceREthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // go forward in time and blocks to get around gas limit error during deployment
      await advanceTime(1)
      await advanceBlocks(10)

      // Reverts with a feed with zero price
      const invalidpriceREthCollateral: REthDemurrageCollateral = <REthDemurrageCollateral>await (
        await ethers.getContractFactory('REthDemurrageCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        rEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('WETH'),
        delayUntilDefault,
        ('18'),
        28,
        10,
        {gasLimit: 5000000}
      )

      await setOraclePrice(invalidpriceREthCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceREthCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceREthCollateral.refresh()
      expect(await invalidpriceREthCollateral.status()).to.equal(CollateralStatus.IFFY)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      
      // Check initial state
      expect(await rEthCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await rEthCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for rEth, will disable collateral immediately
      await advanceTime(10000000000)
      await advanceBlocks(10000000000)
      // Force updates - Should update whenDefault and status 
      await expect(rEthCollateral.refresh())
        .to.emit(rEthCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

        expect(await rEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
        expect(await rEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)


    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(18, bn('1e18'))
      )

      const invalidrEthCollateral: REthDemurrageCollateral = <REthDemurrageCollateral>(
        await REthCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await rEthCollateral.erc20(),
          await rEthCollateral.maxTradeVolume(),
          await rEthCollateral.oracleTimeout(),
          await rEthCollateral.targetName(),
          await rEthCollateral.delayUntilDefault(),
          '18',
          28,
          10,
          {gasLimit: 5000000}
        )
      )
      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidrEthCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidrEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidrEthCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidrEthCollateral.status()).to.equal(CollateralStatus.SOUND)

    })
  })
}) 
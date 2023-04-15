import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { IMPLEMENTATION, ORACLE_ERROR, PRICE_TIMEOUT, REVENUE_HIDING } from '../../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from '../fixtures'
import { getChainId } from '../../../../common/blockchain-utils'
import forkBlockNumber from '../../../integration/fork-block-numbers'
import {
  IConfig,
  IGovParams,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../../common/configuration'
import { CollateralStatus, MAX_UINT48, ZERO_ADDRESS } from '../../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../../common/events'
import { bn, fp, toBNDecimals } from '../../../../common/numbers'
import { whileImpersonating } from '../../../utils/impersonation'
import {
  expectPrice,
  expectRTokenPrice,
  expectUnpriced,
  setOraclePrice,
} from '../../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../../utils/time'
import {
  Asset,
  BNTokenFiatCollateral,
  ERC20Mock,
  BancorNetworkInfoMock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../../typechain'
import { useEnv } from '#/utils/env'

// Setup test environment
const setup = async (blockNumber: number) => {
  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

// Holder address in Mainnet
const holderbnUSDC = '0xa0f75491720835b36edc92d06ddc468d201e9b73'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`BNTokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let bnUSDC: ERC20Mock

  let bancorNetworkInfoMock: BancorNetworkInfoMock
  let usdcBancorPlugin: BNTokenFiatCollateral


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
    rewardRatio: bn('1069671574938'), // approx. half life of 90 days
    unstakingDelay: bn('1209600'), // 2 weeks
    tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
    auctionLength: bn('900'), // 15 minutes
    backingBuffer: fp('0.0001'), // 0.01%
    maxTradeSlippage: fp('0.01'), // 1%
    issuanceThrottle: {
      amtRate: fp('1e6'), // 1M RToken
      pctRate: fp('0.05'), // 5%
    },
    redemptionThrottle: {
      amtRate: fp('1e6'), // 1M RToken
      pctRate: fp('0.05'), // 5%
    },
  }

  const defaultThreshold = fp('0.01') // 1%
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let chainId: number

  let BNTokenFiatCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    await setup(forkBlockNumber['bancor']) // https://etherscan.io/block/16934828, March 29 2023

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

    // Get required contracts for USDC
    // bnUSDC token
    bnUSDC = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.bnUSDC || '')
    )

    // We need to mock this because bnUSDC is currently in deficit
    const BancorNetworkInfoMockFactory: ContractFactory = await ethers.getContractFactory(
      'BancorNetworkInfoMock'
    )
    bancorNetworkInfoMock = <BancorNetworkInfoMock>(
      await BancorNetworkInfoMockFactory.deploy(fp("1.1"), fp("1.0"), "6")
    )

    BNTokenFiatCollateralFactory = await ethers.getContractFactory('BNTokenFiatCollateral')
    usdcBancorPlugin = <BNTokenFiatCollateral>await BNTokenFiatCollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC as string,
        oracleError: ORACLE_ERROR,
        erc20: networkConfig[chainId].tokens.bnUSDC as string,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      bancorNetworkInfoMock.address,
      networkConfig[chainId].tokens.USDC as string,
      REVENUE_HIDING
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // USDC
    // Send 100000 USDC from rich acct to addr1
    initialBal = bn('100000e6')
    await whileImpersonating(holderbnUSDC, async (bnUSDCHolderSigner) => {
      await bnUSDC.connect(bnUSDCHolderSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [usdcBancorPlugin.address],
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
      // Check Rewards assets (if applies) (no rewards)
      
      // Check Collateral plugin
      // bnUSDC (BNTokenFiatCollateral)
      expect(await usdcBancorPlugin.isCollateral()).to.equal(true)
      expect(await usdcBancorPlugin.erc20()).to.equal(networkConfig[chainId].tokens.bnUSDC)
      expect(await usdcBancorPlugin.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await usdcBancorPlugin.refPerTok()).to.not.reverted;
      expect(await usdcBancorPlugin.refPerTok()).to.be.closeTo(fp('1.1'), fp('0.0001'))
      expect(await usdcBancorPlugin.targetPerRef()).to.equal(fp('1'))
      expect(await usdcBancorPlugin.exposedReferencePrice()).to.equal(
        await usdcBancorPlugin.refPerTok()
      )

      await expectPrice(
        usdcBancorPlugin.address,
        fp('1.1'),
        ORACLE_ERROR,
        true,
        bn('1e3')
      ) // close to $1.1 cents

      expect(await usdcBancorPlugin.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
      expect(usdcBancorPlugin.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(networkConfig[chainId].tokens.bnUSDC as string)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(usdcBancorPlugin.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(usdcBancorPlugin.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(networkConfig[chainId].tokens.bnUSDC as string)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      
      // Check RToken price
      await expectPrice(
        basketHandler.address,
        fp('1'),
        ORACLE_ERROR,
        true,
        bn('1e3')
      ) 

      // Issue tokens and check price
      await advanceTime(3600)

      bnUSDC.connect(addr1).approve(rToken.address, ethers.constants.MaxUint256)

      await bnUSDC.connect(addr1).balanceOf(addr1.address)
      // Without the above balanceof check above the rtoken issue call fails with the below error on bnUSDC's transferFrom:
      // Error: VM Exception while processing transaction: reverted with reason string 'SafeMath: subtraction overflow'
      //
      // I think this may be a bug with hardhat, as looking at bnUSDC code, balanceOf is an autogenerated view
      // function from the public balanceOf attribute, and is not overriden anywhere. View functions should not
      // change any blockchain state, and not cause any observable difference of future calls.

      await expect(rToken.connect(addr1).issue(bn("10000e18"))).to.emit(rToken, 'Issuance')
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Missing erc20
      await expect(
        BNTokenFiatCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC as string,
            oracleError: ORACLE_ERROR,
            erc20: ZERO_ADDRESS,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          ZERO_ADDRESS,
          ZERO_ADDRESS,
          REVENUE_HIDING
        )
      ).to.be.revertedWith('missing erc20')
      
      // Missing BancorNetworkInfo
      await expect(
        BNTokenFiatCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC as string,
            oracleError: ORACLE_ERROR,
            erc20: networkConfig[chainId].tokens.bnUSDC,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          ZERO_ADDRESS,
          ZERO_ADDRESS,
          REVENUE_HIDING
        )
      ).to.be.revertedWith('missing network info')

      // Missing Underlying Token
      await expect(
        BNTokenFiatCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC as string,
            oracleError: ORACLE_ERROR,
            erc20: networkConfig[chainId].tokens.bnUSDC,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          networkConfig[chainId].BANCOR_NETWORK_INFO,
          ZERO_ADDRESS,
          REVENUE_HIDING
        )
      ).to.be.revertedWith('missing pool token')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Setup mocks so that the case of no pool deficit is handled

      // Addr1 approves rToken to spend its bnUSDC tokens
      await bnUSDC.connect(addr1).approve(rToken.address, ethers.constants.MaxUint256);

      await advanceTime(3600)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1bnUSDC: BigNumber = await bnUSDC.balanceOf(addr1.address)

      // Check rates and prices
      const [bnUSDCPriceLow1, bnUSDCPriceHigh1] = await usdcBancorPlugin.price() // ~ $1.1
      const bnUSDCRefPerTok1: BigNumber = await usdcBancorPlugin.refPerTok() // ~ $1.1

      await expectPrice(
        usdcBancorPlugin.address,
        fp('1.1'),
        ORACLE_ERROR,
        true,
        bn('1e3')
      )
      expect(bnUSDCRefPerTok1).to.be.closeTo(fp('1.1'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      await bancorNetworkInfoMock.setLPConversion(fp('1.2'))

      // Refresh cToken manually (required)
      await usdcBancorPlugin.refresh()
      expect(await usdcBancorPlugin.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const [bnUSDCPriceLow2, bnUSDCPriceHigh2] = await usdcBancorPlugin.price() // ~1.2
      const bnUSDCRefPerTok2: BigNumber = await usdcBancorPlugin.refPerTok() // ~1.2

      // Check rates and price increase
      expect(bnUSDCPriceLow2).to.be.gt(bnUSDCPriceLow1)
      expect(bnUSDCPriceHigh2).to.be.gt(bnUSDCPriceHigh1)
      expect(bnUSDCRefPerTok2).to.be.gt(bnUSDCRefPerTok1)

      // Still close to the original values
      await expectPrice(
        usdcBancorPlugin.address,
        fp('1.2'),
        ORACLE_ERROR,
        true,
        bn('1e3')
      )
      expect(bnUSDCRefPerTok2).to.be.closeTo(fp('1.2'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      await bancorNetworkInfoMock.setLPConversion(fp('1.3'))

      // Refresh cToken manually (required)
      await usdcBancorPlugin.refresh()
      expect(await usdcBancorPlugin.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const [bnUSDCPriceLow3, bnUSDCPriceHigh3] = await usdcBancorPlugin.price() // ~1.3
      const bnUSDCRefPerTok3: BigNumber = await usdcBancorPlugin.refPerTok() // ~1.3

      // Check rates and price increase
      expect(bnUSDCPriceLow3).to.be.gt(bnUSDCPriceLow2)
      expect(bnUSDCPriceHigh3).to.be.gt(bnUSDCPriceHigh2)
      expect(bnUSDCRefPerTok3).to.be.gt(bnUSDCRefPerTok2)

      expect(bnUSDCRefPerTok3).to.be.closeTo(fp('1.3'), fp('0.001'))
      await expectPrice(
        usdcBancorPlugin.address,
        fp('1.3'),
        ORACLE_ERROR,
        true,
        bn('1e3')
      )

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount, await basketHandler.nonce())).to.emit(
        rToken,
        'Redemption'
      )

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer cTokens should have been sent to the user
      const newBalanceAddr1bnUSDC: BigNumber = await bnUSDC.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1bnUSDC.sub(balanceAddr1bnUSDC)).to.be.closeTo(bn('7692307692'), bn('1e6')) // ~7692.307692 * 1.3 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await bnUSDC.balanceOf(backingManager.address)).to.be.closeTo(bn('1398601399'), bn('1e6')) // ~= 1398.6 * 1.3 ~= 1818.2 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('1818.2'), // ~= 1818.2 usd (from above)
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      // Claim rewards
      await expect(backingManager.claimRewards()).to.not.emit(backingManager, 'RewardsClaimed').and.to.not.be.reverted
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Does not revert with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expectUnpriced(usdcBancorPlugin.address)

      // Refresh should mark status IFFY
      await usdcBancorPlugin.refresh()
      expect(await usdcBancorPlugin.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceStarTokenCollateral: BNTokenFiatCollateral = <BNTokenFiatCollateral>await (
        await ethers.getContractFactory('BNTokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: NO_PRICE_DATA_FEED,
          oracleError: ORACLE_ERROR,
          erc20: networkConfig[chainId].tokens.bnUSDC as string,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        networkConfig[chainId].BANCOR_NETWORK_INFO as string,
        networkConfig[chainId].tokens.USDC as string,
        REVENUE_HIDING,
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceStarTokenCollateral.price()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceStarTokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceStarTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Does not revert with zero price
      const zeropriceStarTokenCollateral: BNTokenFiatCollateral = <BNTokenFiatCollateral>await (
        await ethers.getContractFactory('BNTokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: networkConfig[chainId].tokens.bnUSDC as string,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        networkConfig[chainId].BANCOR_NETWORK_INFO as string,
        networkConfig[chainId].tokens.USDC as string,
        REVENUE_HIDING,
      )

      await setOraclePrice(zeropriceStarTokenCollateral.address, bn(0))

      // Does not revert with zero price
      await expectPrice(zeropriceStarTokenCollateral.address, bn('0'), bn('0'), false)

      // Refresh should mark status IFFY
      await zeropriceStarTokenCollateral.refresh()
      expect(await zeropriceStarTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
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
      const newUSDCBancorPlugin: BNTokenFiatCollateral = <BNTokenFiatCollateral>await (
        await ethers.getContractFactory('BNTokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: await usdcBancorPlugin.erc20(),
          maxTradeVolume: await usdcBancorPlugin.maxTradeVolume(),
          oracleTimeout: await usdcBancorPlugin.oracleTimeout(),
          targetName: await usdcBancorPlugin.targetName(),
          defaultThreshold,
          delayUntilDefault: await usdcBancorPlugin.delayUntilDefault(),
        },
        networkConfig[chainId].BANCOR_NETWORK_INFO as string,
        networkConfig[chainId].tokens.USDC as string,
        REVENUE_HIDING
      )

      // Check initial state
      expect(await newUSDCBancorPlugin.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUSDCBancorPlugin.whenDefault()).to.equal(MAX_UINT48)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newUSDCBancorPlugin.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newUSDCBancorPlugin.refresh())
        .to.emit(newUSDCBancorPlugin, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUSDCBancorPlugin.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUSDCBancorPlugin.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUSDCBancorPlugin.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newUSDCBancorPlugin.whenDefault()
      await expect(newUSDCBancorPlugin.refresh()).to.not.emit(
        usdcBancorPlugin,
        'CollateralStatusChanged'
      )
      expect(await newUSDCBancorPlugin.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUSDCBancorPlugin.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default from bancor deficit
    it('Updates status in case of bancor deficit', async () => {
      // Check initial state
      expect(await usdcBancorPlugin.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcBancorPlugin.whenDefault()).to.equal(MAX_UINT48)

      // Decrease withdraw rate for USDC, will disable collateral immediately
      bancorNetworkInfoMock.setWithdrawConversion(fp("0.8"))
      //So hardhat reflects changes to mock
      await bancorNetworkInfoMock.withdraw_conversion()

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(usdcBancorPlugin.refresh())
        .to.emit(usdcBancorPlugin, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await usdcBancorPlugin.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await usdcBancorPlugin.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    // Test for hard default from LP token exchange
    it('Updates status in case of LP token rate default', async () => {
      // Check initial state
      expect(await usdcBancorPlugin.status()).to.equal(CollateralStatus.SOUND)
      expect(await usdcBancorPlugin.whenDefault()).to.equal(MAX_UINT48)

      // Decrease conversion rate for bnUSDC, will disable collateral immediately
      await bancorNetworkInfoMock.setLPConversion(fp("0.8"))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(usdcBancorPlugin.refresh())
        .to.emit(usdcBancorPlugin, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await usdcBancorPlugin.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await usdcBancorPlugin.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: BNTokenFiatCollateral = <BNTokenFiatCollateral>(
        await BNTokenFiatCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: invalidChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: await usdcBancorPlugin.erc20(),
            maxTradeVolume: await usdcBancorPlugin.maxTradeVolume(),
            oracleTimeout: await usdcBancorPlugin.oracleTimeout(),
            targetName: await usdcBancorPlugin.targetName(),
            defaultThreshold,
            delayUntilDefault: await usdcBancorPlugin.delayUntilDefault(),
          },
          networkConfig[chainId].BANCOR_NETWORK_INFO as string,
          networkConfig[chainId].tokens.USDC as string,
          REVENUE_HIDING,
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCTokenCollateral.refresh()).to.be.reverted
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCTokenCollateral.refresh()).to.be.reverted
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

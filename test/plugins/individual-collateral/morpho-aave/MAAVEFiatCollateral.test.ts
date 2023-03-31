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
  ComptrollerMock,
  MorphoAAVEFiatCollateral,
  CTokenMock,
  ERC20Mock,
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
  MorphoAAVEPositionWrapper,
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
const holderWBTC = '0x7f62f9592b823331e012d3c5ddf2a7714cfb9de2'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`MAAVEFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Tokens/Assets
  let wbtc: ERC20Mock

  let wbtcMorphoPlugin: MorphoAAVEFiatCollateral
  let wbtcMorphoWrapper: MorphoAAVEPositionWrapper

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

  let MorphoAAVECollateralFactory: ContractFactory
  let MorphoAAVEPositionWrapperFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    await setup(forkBlockNumber['morpho-aave']) // Jun-06-2022

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, govParams } = await loadFixture(
      defaultFixture
    ))

    // Get required contracts for cDAI
    // COMP token
    //compToken = <ERC20Mock>(
    //  await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.COMP || '')
    //)
    // WBTC token
    wbtc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WBTC || '')
    )

    //TODO: Create mocks of Morpho controller, lens and reward token

    console.log(networkConfig[chainId].MORPHO_AAVE_CONTROLLER, networkConfig[chainId].MORPHO_AAVE_LENS, chainId)
    MorphoAAVEPositionWrapperFactory = await ethers.getContractFactory('MorphoAAVEPositionWrapper')
    wbtcMorphoWrapper = <MorphoAAVEPositionWrapper>await MorphoAAVEPositionWrapperFactory.deploy(
      {
        morpho_controller: networkConfig[chainId].MORPHO_AAVE_CONTROLLER,
        morpho_lens: networkConfig[chainId].MORPHO_AAVE_LENS,
        underlying_erc20: wbtc.address,
        pool_token: networkConfig[chainId].tokens.aWBTC,
        underlying_symbol: ethers.utils.formatBytes32String('WBTC')
      }
    )

    console.log(wbtcMorphoWrapper.address)
    MorphoAAVECollateralFactory = await ethers.getContractFactory('MorphoAAVEFiatCollateral')
    wbtcMorphoPlugin = <MorphoAAVEFiatCollateral>await MorphoAAVECollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.WBTC as string,
        oracleError: ORACLE_ERROR,
        erc20: wbtcMorphoWrapper.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      wbtcMorphoWrapper.address,
      REVENUE_HIDING,
    )
    console.log("b")

    // Setup balances for addr1 - Transfer from Mainnet holder
    // wBTC
    // Send 4000 wbtc from rich acct to addr1
    initialBal = bn('4000')
    await whileImpersonating(holderWBTC, async (wbtcHolderSigner) => {
      await wbtc.connect(wbtcHolderSigner).transfer(addr1.address, toBNDecimals(initialBal, 8))
    })

    // Send 4000 wbtc from rich acct to addr2
    await whileImpersonating(holderWBTC, async (wbtcHolderSigner) => {
      await wbtc.connect(wbtcHolderSigner).transfer(addr2.address, toBNDecimals(initialBal, 8))
    })
    console.log("c", wbtcMorphoPlugin.address)

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      //TODO: Add morpho reward token as asset
      assets: [],
      primaryBasket: [wbtcMorphoPlugin.address],
      weights: [fp('1')],
      backups: [],
      beneficiaries: [],
    }

    // Deploy RToken via FacadeWrite
    console.log(facadeWrite.address, owner.address, wbtcMorphoPlugin.address, wbtcMorphoWrapper.address)
    const receipt = await (
      await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()
    console.log("c a")

    // Get Main
    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    console.log("split")
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)
    console.log("d")

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
    console.log("e")
    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
    rTokenAsset = <RTokenAsset>(
      await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
    )
    console.log("f")

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
      
      // Check Wrapper Deployment
      expect(await wbtcMorphoWrapper.decimals()).to.equal(18)
      expect(await wbtcMorphoWrapper.get_exchange_rate()).to.equal(fp('1'))

      // Check Collateral plugin
      // maWBTC (CTokenFiatCollateral)
      expect(await wbtcMorphoPlugin.isCollateral()).to.equal(true)
      expect(await wbtcMorphoPlugin.referenceERC20Decimals()).to.equal(await wbtcMorphoWrapper.decimals())
      expect(await wbtcMorphoPlugin.erc20()).to.equal(wbtcMorphoWrapper.address)
      expect(await wbtcMorphoPlugin.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await wbtcMorphoPlugin.refPerTok()).to.be.closeTo(fp('1'), fp('0.001'))
      expect(await wbtcMorphoPlugin.targetPerRef()).to.equal(fp('1'))
      expect(await wbtcMorphoPlugin.exposedReferencePrice()).to.equal(
        await wbtcMorphoPlugin.refPerTok()
      )
      await expectPrice(
        wbtcMorphoPlugin.address,
        fp('0.022015105509346448'),
        ORACLE_ERROR,
        true,
        bn('1e5')
      ) // close to $0.022 cents

      // Check claim data
      await expect(wbtcMorphoPlugin.claimRewards())
        .to.emit(wbtcMorphoPlugin, 'RewardsClaimed')
        .withArgs(compToken.address, 0)
      expect(await wbtcMorphoPlugin.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
      expect(wbtcMorphoPlugin.address).to.not.equal(ZERO_ADDRESS)
      expect(wbtcMorphoWrapper.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(compToken.address)
      expect(ERC20s[3]).to.equal(wbtcMorphoWrapper.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(wbtcMorphoWrapper.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(wbtcMorphoWrapper.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(wbtcMorphoWrapper.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

      // Check RToken price
      const issueAmount: BigNumber = bn('10000e18')
      await wbtcMorphoWrapper.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
      await advanceTime(3600)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
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
        MorphoAAVECollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
            oracleError: ORACLE_ERROR,
            erc20: ZERO_ADDRESS,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          REVENUE_HIDING,
          ZERO_ADDRESS
        )
      ).to.be.revertedWith('missing erc20')

      // Comptroller
      await expect(
        MorphoAAVECollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
            oracleError: ORACLE_ERROR,
            erc20: wbtcMorphoWrapper.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          REVENUE_HIDING,
          ZERO_ADDRESS
        )
      ).to.be.revertedWith('comptroller missing')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await wbtcMorphoWrapper.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

      await advanceTime(3600)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cDai: BigNumber = await wbtcMorphoWrapper.balanceOf(addr1.address)

      // Check rates and prices
      const [cDaiPriceLow1, cDaiPriceHigh1] = await wbtcMorphoPlugin.price() // ~ 0.022015 cents
      const cDaiRefPerTok1: BigNumber = await wbtcMorphoPlugin.refPerTok() // ~ 0.022015 cents

      await expectPrice(
        cDaiCollateral.address,
        fp('0.022015105946267361'),
        ORACLE_ERROR,
        true,
        bn('1e5')
      )
      expect(cDaiRefPerTok1).to.be.closeTo(fp('0.022'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await cDaiCollateral.refresh()
      expect(await cDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const [cDaiPriceLow2, cDaiPriceHigh2] = await cDaiCollateral.price() // ~0.022016
      const cDaiRefPerTok2: BigNumber = await cDaiCollateral.refPerTok() // ~0.022016

      // Check rates and price increase
      expect(cDaiPriceLow2).to.be.gt(cDaiPriceLow1)
      expect(cDaiPriceHigh2).to.be.gt(cDaiPriceHigh1)
      expect(cDaiRefPerTok2).to.be.gt(cDaiRefPerTok1)

      // Still close to the original values
      await expectPrice(
        cDaiCollateral.address,
        fp('0.022016198467092545'),
        ORACLE_ERROR,
        true,
        bn('1e5')
      )
      expect(cDaiRefPerTok2).to.be.closeTo(fp('0.022'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await cDaiCollateral.refresh()
      expect(await cDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const [cDaiPriceLow3, cDaiPriceHigh3] = await cDaiCollateral.price() // ~0.03294
      const cDaiRefPerTok3: BigNumber = await cDaiCollateral.refPerTok() // ~0.03294

      // Check rates and price increase
      expect(cDaiPriceLow3).to.be.gt(cDaiPriceLow2)
      expect(cDaiPriceHigh3).to.be.gt(cDaiPriceHigh2)
      expect(cDaiRefPerTok3).to.be.gt(cDaiRefPerTok2)

      await expectPrice(
        cDaiCollateral.address,
        fp('0.032941254792840879'),
        ORACLE_ERROR,
        true,
        bn('1e5')
      )
      expect(cDaiRefPerTok3).to.be.closeTo(fp('0.032'), fp('0.001'))

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
      const newBalanceAddr1cDai: BigNumber = await cDai.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1cDai.sub(balanceAddr1cDai)).to.be.closeTo(bn('303570e8'), bn('8e7')) // ~0.03294 * 303571 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await cDai.balanceOf(backingManager.address)).to.be.closeTo(bn(150663e8), bn('5e7')) // ~= 4962.8 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('4962.8'), // ~= 4962.8 usd (from above)
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Does not revert with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expectUnpriced(cDaiCollateral.address)

      // Refresh should mark status IFFY
      await cDaiCollateral.refresh()
      expect(await cDaiCollateral.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>await (
        await ethers.getContractFactory('CTokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: NO_PRICE_DATA_FEED,
          oracleError: ORACLE_ERROR,
          erc20: cDai.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        REVENUE_HIDING,
        comptroller.address
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.price()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Does not revert with zero price
      const zeropriceCtokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>await (
        await ethers.getContractFactory('CTokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: cDai.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        REVENUE_HIDING,
        comptroller.address
      )

      await setOraclePrice(zeropriceCtokenCollateral.address, bn(0))

      // Does not revert with zero price
      await expectPrice(zeropriceCtokenCollateral.address, bn('0'), bn('0'), false)

      // Refresh should mark status IFFY
      await zeropriceCtokenCollateral.refresh()
      expect(await zeropriceCtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
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
      const newCDaiCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>await (
        await ethers.getContractFactory('MorphoAAVEFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: await cDaiCollateral.erc20(),
          maxTradeVolume: await cDaiCollateral.maxTradeVolume(),
          oracleTimeout: await cDaiCollateral.oracleTimeout(),
          targetName: await cDaiCollateral.targetName(),
          defaultThreshold,
          delayUntilDefault: await cDaiCollateral.delayUntilDefault(),
        },
        REVENUE_HIDING,
        comptroller.address
      )

      // Check initial state
      expect(await newCDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newCDaiCollateral.whenDefault()).to.equal(MAX_UINT48)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newCDaiCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newCDaiCollateral.refresh())
        .to.emit(newCDaiCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newCDaiCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newCDaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newCDaiCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newCDaiCollateral.whenDefault()
      await expect(newCDaiCollateral.refresh()).to.not.emit(
        newCDaiCollateral,
        'CollateralStatusChanged'
      )
      expect(await newCDaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newCDaiCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const CTokenMockFactory: ContractFactory = await ethers.getContractFactory('CTokenMock')
      const symbol = await cDai.symbol()
      const cDaiMock: CTokenMock = <CTokenMock>(
        await CTokenMockFactory.deploy(symbol + ' Token', symbol, dai.address)
      )
      // Set initial exchange rate to the new cDai Mock
      await cDaiMock.setExchangeRate(fp('0.02'))

      // Redeploy plugin using the new cDai mock
      const newCDaiCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>await (
        await ethers.getContractFactory('CTokenFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await cDaiCollateral.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: cDaiMock.address,
          maxTradeVolume: await cDaiCollateral.maxTradeVolume(),
          oracleTimeout: await cDaiCollateral.oracleTimeout(),
          targetName: await cDaiCollateral.targetName(),
          defaultThreshold,
          delayUntilDefault: await cDaiCollateral.delayUntilDefault(),
        },
        REVENUE_HIDING,
        comptroller.address
      )
      await newCDaiCollateral.refresh()

      // Check initial state
      expect(await newCDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newCDaiCollateral.whenDefault()).to.equal(MAX_UINT48)

      // Decrease rate for cDAI, will disable collateral immediately
      await cDaiMock.setExchangeRate(fp('0.019'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newCDaiCollateral.refresh())
        .to.emit(newCDaiCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newCDaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newCDaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>(
        await CTokenCollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: invalidChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: await cDaiCollateral.erc20(),
            maxTradeVolume: await cDaiCollateral.maxTradeVolume(),
            oracleTimeout: await cDaiCollateral.oracleTimeout(),
            targetName: await cDaiCollateral.targetName(),
            defaultThreshold,
            delayUntilDefault: await cDaiCollateral.delayUntilDefault(),
          },
          REVENUE_HIDING,
          comptroller.address
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

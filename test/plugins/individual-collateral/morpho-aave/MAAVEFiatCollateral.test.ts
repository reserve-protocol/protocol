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
  MorphoAAVEFiatCollateral,
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
  MorphoAAVEPositionWrapperMock,
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
const holderUSDT = '0xd6216fc19db775df9774a6e33526131da7d19a2c'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`MAAVEFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Tokens/Assets
  let usdt: ERC20Mock

  let usdtMorphoPlugin: MorphoAAVEFiatCollateral
  let usdtMorphoWrapper: MorphoAAVEPositionWrapper

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
    await setup(forkBlockNumber['morpho-aave']) // https://etherscan.io/block/16859314, March 19 2023

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

    // Get required contracts for USDT
    // USDT token
    usdt = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDT || '')
    )

    //TODO: Add support for MORPHO rewards once chainlink releases MORPHO / USDT

    MorphoAAVEPositionWrapperFactory = await ethers.getContractFactory('MorphoAAVEPositionWrapper')
    usdtMorphoWrapper = <MorphoAAVEPositionWrapper>await MorphoAAVEPositionWrapperFactory.deploy(
      {
        morpho_controller: networkConfig[chainId].MORPHO_AAVE_CONTROLLER,
        morpho_lens: networkConfig[chainId].MORPHO_AAVE_LENS,
        underlying_erc20: usdt.address,
        pool_token: networkConfig[chainId].tokens.aUSDT,
        underlying_symbol: ethers.utils.formatBytes32String('USDT')
      }
    )

    MorphoAAVECollateralFactory = await ethers.getContractFactory('MorphoAAVEFiatCollateral')
    usdtMorphoPlugin = <MorphoAAVEFiatCollateral>await MorphoAAVECollateralFactory.deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDT as string,
        oracleError: ORACLE_ERROR,
        erc20: usdtMorphoWrapper.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      REVENUE_HIDING,
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // wBTC
    // Send 10000 usdt from rich acct to addr1
    initialBal = bn('10000e6')
    await whileImpersonating(holderUSDT, async (usdtHolderSigner) => {
      await usdt.connect(usdtHolderSigner).transfer(addr1.address, initialBal)
    })

    // Send 10000 usdt from rich acct to addr2
    await whileImpersonating(holderUSDT, async (usdtHolderSigner) => {
      await usdt.connect(usdtHolderSigner).transfer(addr2.address, initialBal)
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
      //TODO: Add morpho reward token as asset
      assets: [],
      primaryBasket: [usdtMorphoPlugin.address],
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

    //console.log(await usdtMorphoWrapper.test_underlying_to_fix())

    // Setup mock chainlink feed for some of the tests (so we can change the value)
    MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Rewards assets (if applies) (no rewards)
      
      // Check Wrapper Deployment
      expect(await usdtMorphoWrapper.decimals()).to.equal(18)
      expect(await usdtMorphoWrapper.get_exchange_rate()).to.equal(fp('1'))

      // Check Collateral plugin
      // maUSDT (MorphoAAVEFiatCollateral)
      expect(await usdtMorphoPlugin.isCollateral()).to.equal(true)
      expect(await usdtMorphoPlugin.erc20()).to.equal(usdtMorphoWrapper.address)
      expect(await usdtMorphoPlugin.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await usdtMorphoPlugin.refPerTok()).to.be.closeTo(fp('1'), fp('0.001'))
      expect(await usdtMorphoPlugin.targetPerRef()).to.equal(fp('1'))
      expect(await usdtMorphoPlugin.exposedReferencePrice()).to.equal(
        await usdtMorphoPlugin.refPerTok()
      )

      await expectPrice(
        usdtMorphoPlugin.address,
        fp('1.00278919'),
        ORACLE_ERROR,
        true,
        bn('1e5')
      ) // close to $1.00278919 cents

      expect(await usdtMorphoPlugin.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
      expect(usdtMorphoPlugin.address).to.not.equal(ZERO_ADDRESS)
      expect(usdtMorphoWrapper.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(usdtMorphoWrapper.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(usdtMorphoPlugin.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(usdtMorphoPlugin.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(usdtMorphoWrapper.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      
      // Check RToken price
      await expectPrice(
        basketHandler.address,
        fp('1.00278919'),
        ORACLE_ERROR,
        true,
        bn('1e5')
      ) 

      // Approve usdtMorphoWrapper to spend 5000 of addr1 usdt, then mint usdtMorphoWrapper
      await usdt.connect(addr1).approve(usdtMorphoWrapper.address, bn("5000e6"))
      await usdtMorphoWrapper.connect(addr1).mint(addr1.address, bn("100e18"))

      // Addr1 approves rToken to spend its wrapper tokens
      await usdtMorphoWrapper.connect(addr1).approve(rToken.address, bn("100e18"))

      // Issue tokens and check price
      await advanceTime(3600)
      await expect(rToken.connect(addr1).issue(bn("100e18"))).to.emit(rToken, 'Issuance')
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1.00278919'),
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
        )
      ).to.be.revertedWith('missing erc20')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Approve usdtMorphoWrapper to spend 5000 of addr1 usdt, then mint usdtMorphoWrapper
      await usdt.connect(addr1).approve(usdtMorphoWrapper.address, bn("10000e6"))
      await usdtMorphoWrapper.connect(addr1).mint(addr1.address, issueAmount)

      // Addr1 approves rToken to spend its wrapper tokens
      await usdtMorphoWrapper.connect(addr1).approve(rToken.address, issueAmount);

      await advanceTime(3600)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1USDT: BigNumber = await usdtMorphoWrapper.balanceOf(addr1.address)

      // Check rates and prices
      const [usdtPriceLow1, usdtPriceHigh1] = await usdtMorphoPlugin.price() // ~ 0.022015 cents
      const usdtRefPerTok1: BigNumber = await usdtMorphoPlugin.refPerTok() // ~ 0.022015 cents

      await expectPrice(
        usdtMorphoPlugin.address,
        fp('1.00278919'),
        ORACLE_ERROR,
        true,
        bn('1e5')
      )
      expect(usdtRefPerTok1).to.be.closeTo(fp('1'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await usdtMorphoPlugin.refresh()
      expect(await usdtMorphoPlugin.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const [usdtPriceLow2, usdtPriceHigh2] = await usdtMorphoPlugin.price() // ~0.022016
      const usdtRefPerTok2: BigNumber = await usdtMorphoPlugin.refPerTok() // ~0.022016

      // Check rates and price increase
      expect(usdtPriceLow2).to.be.gt(usdtPriceLow1)
      expect(usdtPriceHigh2).to.be.gt(usdtPriceHigh1)
      expect(usdtRefPerTok2).to.be.gt(usdtRefPerTok1)

      // Still close to the original values
      await expectPrice(
        usdtMorphoPlugin.address,
        fp('1.00278919'),
        ORACLE_ERROR,
        true,
        bn('1e3')
      )
      expect(usdtRefPerTok2).to.be.closeTo(fp('1'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await usdtMorphoPlugin.refresh()
      expect(await usdtMorphoPlugin.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const [usdtPriceLow3, usdtPriceHigh3] = await usdtMorphoPlugin.price() // ~0.03294
      const usdtRefPerTok3: BigNumber = await usdtMorphoPlugin.refPerTok() // ~0.03294

      // Check rates and price increase
      expect(usdtPriceLow3).to.be.gt(usdtPriceLow2)
      expect(usdtPriceHigh3).to.be.gt(usdtPriceHigh2)
      expect(usdtRefPerTok3).to.be.gt(usdtRefPerTok2)

      expect(usdtRefPerTok3).to.be.closeTo(fp('1.14492'), fp('0.001'))
      await expectPrice(
        usdtMorphoPlugin.address,
        fp('1.148122554980383617'),
        ORACLE_ERROR,
        true,
        bn('1e5')
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
      const newBalanceAddr1usdtWrapper: BigNumber = await usdtMorphoWrapper.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1usdtWrapper.sub(balanceAddr1USDT)).to.be.closeTo(bn('8734.1650501e18'), bn('0.01e18')) // ~8734.1650501 * 1.14812 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await usdtMorphoWrapper.balanceOf(backingManager.address)).to.be.closeTo(bn('1265.8104e18'), bn('0.01e18')) // ~= 1453.8 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('1453.8'), // ~= 1453.8 usd (from above)
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
      await expectUnpriced(usdtMorphoPlugin.address)

      // Refresh should mark status IFFY
      await usdtMorphoPlugin.refresh()
      expect(await usdtMorphoPlugin.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: MorphoAAVEFiatCollateral = <MorphoAAVEFiatCollateral>await (
        await ethers.getContractFactory('MorphoAAVEFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: NO_PRICE_DATA_FEED,
          oracleError: ORACLE_ERROR,
          erc20: usdtMorphoWrapper.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        REVENUE_HIDING,
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.price()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Does not revert with zero price
      const zeropriceCtokenCollateral: MorphoAAVEFiatCollateral = <MorphoAAVEFiatCollateral>await (
        await ethers.getContractFactory('MorphoAAVEFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: usdtMorphoWrapper.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        },
        REVENUE_HIDING,
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
      const newUSDTCollateral: MorphoAAVEFiatCollateral = <MorphoAAVEFiatCollateral>await (
        await ethers.getContractFactory('MorphoAAVEFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: await usdtMorphoPlugin.erc20(),
          maxTradeVolume: await usdtMorphoPlugin.maxTradeVolume(),
          oracleTimeout: await usdtMorphoPlugin.oracleTimeout(),
          targetName: await usdtMorphoPlugin.targetName(),
          defaultThreshold,
          delayUntilDefault: await usdtMorphoPlugin.delayUntilDefault(),
        },
        REVENUE_HIDING
      )

      // Check initial state
      expect(await newUSDTCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUSDTCollateral.whenDefault()).to.equal(MAX_UINT48)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newUSDTCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newUSDTCollateral.refresh())
        .to.emit(newUSDTCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUSDTCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUSDTCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUSDTCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newUSDTCollateral.whenDefault()
      await expect(newUSDTCollateral.refresh()).to.not.emit(
        newUSDTCollateral,
        'CollateralStatusChanged'
      )
      expect(await newUSDTCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUSDTCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const MorphoAAVEPositionWrapperMockFactory: ContractFactory = await ethers.getContractFactory('MorphoAAVEPositionWrapperMock')
      const usdtMorphoWrapperMock = <MorphoAAVEPositionWrapperMock>await MorphoAAVEPositionWrapperMockFactory.deploy(
        {
          morpho_controller: networkConfig[chainId].MORPHO_AAVE_CONTROLLER,
          morpho_lens: networkConfig[chainId].MORPHO_AAVE_LENS,
          underlying_erc20: usdt.address,
          pool_token: networkConfig[chainId].tokens.aUSDT,
          underlying_symbol: ethers.utils.formatBytes32String('WBTC')
        }
      )

      // Set initial exchange rate to the new USDT Mock
      await usdtMorphoWrapperMock.set_exchange_rate(fp('1'))

      // Redeploy plugin using the new USDT mock
      const newUSDTCollateral: MorphoAAVEFiatCollateral = <MorphoAAVEFiatCollateral>await (
        await ethers.getContractFactory('MorphoAAVEFiatCollateral')
      ).deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: usdtMorphoWrapperMock.address,
          maxTradeVolume: await usdtMorphoPlugin.maxTradeVolume(),
          oracleTimeout: await usdtMorphoPlugin.oracleTimeout(),
          targetName: await usdtMorphoPlugin.targetName(),
          defaultThreshold,
          delayUntilDefault: await usdtMorphoPlugin.delayUntilDefault(),
        },
        REVENUE_HIDING
      )
      await newUSDTCollateral.refresh()

      // Check initial state
      expect(await newUSDTCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUSDTCollateral.whenDefault()).to.equal(MAX_UINT48)

      // Decrease rate for USDT, will disable collateral immediately
      await usdtMorphoWrapperMock.set_exchange_rate(fp('0.9'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newUSDTCollateral.refresh())
        .to.emit(newUSDTCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newUSDTCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newUSDTCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: MorphoAAVEFiatCollateral = <MorphoAAVEFiatCollateral>(
        await MorphoAAVECollateralFactory.deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: invalidChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: await usdtMorphoPlugin.erc20(),
            maxTradeVolume: await usdtMorphoPlugin.maxTradeVolume(),
            oracleTimeout: await usdtMorphoPlugin.oracleTimeout(),
            targetName: await usdtMorphoPlugin.targetName(),
            defaultThreshold,
            delayUntilDefault: await usdtMorphoPlugin.delayUntilDefault(),
          },
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

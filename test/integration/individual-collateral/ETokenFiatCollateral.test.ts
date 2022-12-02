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
  ETokenFiatCollateral,
  ETokenMock, // TODO: make ETokenMock?
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
import forkBlockNumber from '../fork-block-numbers'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet - an absolute giga-🐋
const holderEUSDC = '0xD8de4C018fADB5a0CCcACB3eBd6A3Fe916f224f6'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

const MAINNET_RPC_URL = useEnv(['MAINNET_RPC_URL', 'ALCHEMY_MAINNET_RPC_URL'])

describeFork(`ETokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock
  let eUsdc: ETokenMock 
  let eUsdcCollateral: ETokenFiatCollateral
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

  let ETokenCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{forking: {
            jsonRpcUrl: MAINNET_RPC_URL,
            blockNumber: forkBlockNumber['euler-plugins']
          },},],
      });

    expect(await ethers.provider.getBlockNumber()).to.equal(forkBlockNumber['euler-plugins'])

  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // USDC token
    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )
    // eUSDC token
    eUsdc = <ETokenMock>(
      await ethers.getContractAt('ETokenMock', networkConfig[chainId].tokens.eUSDC || '')
    )

    // Deploy eUsdc collateral plugin
    ETokenCollateralFactory = await ethers.getContractFactory('ETokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    eUsdcCollateral = <ETokenFiatCollateral>(
      await ETokenCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        eUsdc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        (await usdc.decimals()).toString(),
        {gasLimit: 5000000}
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // eUSDC
    initialBal = bn('5000e18')
    await whileImpersonating(holderEUSDC, async (eusdcSigner) => {
      await eUsdc.connect(eusdcSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [eUsdcCollateral.address],
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
      // eUSDC (ETokenFiatCollateral)
      expect(await eUsdcCollateral.isCollateral()).to.equal(true)
      expect(await eUsdcCollateral.referenceERC20Decimals()).to.equal(await usdc.decimals())
      expect(await eUsdcCollateral.erc20()).to.equal(eUsdc.address)
      expect(await eUsdc.decimals()).to.equal(18)
      expect(await eUsdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await eUsdcCollateral.refPerTok()).to.be.closeTo(fp('1.023573'), fp('0.000001'))
      expect(await eUsdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await eUsdcCollateral.pricePerTarget()).to.equal(fp('1'))
      // the following assertion cannot always be true since Euler's eToken->underlying exchange rates do not need to be updated via 
      // a write function, and hence refPerTok() will be different from its last read in a long enough timeframe even if refresh() wasn't 
      // called to update prevReferencePrice. 
      // expect(await eWethCollateral.prevReferencePrice()).to.equal(await eWethCollateral.refPerTok())
      expect(await eUsdcCollateral.strictPrice()).to.be.closeTo(fp('1.023'), fp('0.001')) // close to $1.023

      // claimRewards() should not actually claim any rewards for the user, 
      // since there are no extra rewards for eToken holders
      expect(await eUsdcCollateral.claimRewards()).to.not.emit(eUsdcCollateral, 'RewardsClaimed')
      expect(await eUsdcCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(eUsdc.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(eUsdcCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(eUsdcCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(eUsdc.address)
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
      const issueAmount: BigNumber = bn('1000e18')
      await eUsdc.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        ETokenCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          eUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          delayUntilDefault,
          (await usdc.decimals()).toString(),
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferenceERC20Decimals
      await expect(
        ETokenCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          eUsdc.address,
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
    const MIN_ISSUANCE_PER_BLOCK = bn('1000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await eUsdc.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1eUsdc: BigNumber = await eUsdc.balanceOf(addr1.address)

      // Check rates and prices
      const eUsdcPrice1: BigNumber = await eUsdcCollateral.strictPrice() // ~ 0.022015 cents
      const eUsdcRefPerTok1: BigNumber = await eUsdcCollateral.refPerTok() // ~ 0.022015 cents

      expect(eUsdcPrice1).to.be.closeTo(fp('1.023'), fp('0.001'))
      expect(eUsdcRefPerTok1).to.be.closeTo(fp('1.023'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('0.01')) // approx 1K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await eUsdcCollateral.refresh()
      expect(await eUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const eUsdcPrice2: BigNumber = await eUsdcCollateral.strictPrice() // ~$1.023
      const eUsdcRefPerTok2: BigNumber = await eUsdcCollateral.refPerTok() // ~$1.023

      // Check rates and price increase
      expect(eUsdcPrice2).to.be.gt(eUsdcPrice1)
      expect(eUsdcRefPerTok2).to.be.gt(eUsdcRefPerTok1)

      // Still close to the original values
      expect(eUsdcPrice2).to.be.closeTo(fp('1.023'), fp('0.001'))
      expect(eUsdcRefPerTok2).to.be.closeTo(fp('1.023'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks greatly, causing refPerTok() to increase greatly
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await eUsdcCollateral.refresh()
      expect(await eUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const eUsdcPrice3: BigNumber = await eUsdcCollateral.strictPrice() // ~0.03294
      const eUsdcRefPerTok3: BigNumber = await eUsdcCollateral.refPerTok() // ~0.03294

      // Check rates and price increase
      expect(eUsdcPrice3).to.be.gt(eUsdcPrice2)
      expect(eUsdcRefPerTok3).to.be.gt(eUsdcRefPerTok2)

      // Need to adjust ranges
      expect(eUsdcPrice3).to.be.closeTo(fp('1.192'), fp('0.001'))
      expect(eUsdcRefPerTok3).to.be.closeTo(fp('1.192'), fp('0.001'))

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
      const newBalanceAddr1eUsdc: BigNumber = await eUsdc.balanceOf(addr1.address)

      // Check received tokens represent ~1K in value at current prices
      expect(newBalanceAddr1eUsdc.sub(balanceAddr1eUsdc)).to.be.closeTo(bn('838e18'), bn('1e18')) // ~1.192 * 838 ~= 1K (100% of basket)

      // Check remainders in Backing Manager
      expect(await eUsdc.balanceOf(backingManager.address)).to.be.closeTo(bn('139e18'), bn('1e18')) // ~= 165 usd in value

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('165'), // ~= 165 usd (from above)
        fp('1')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      // since there are no rewards to claim, we not check to see that it doesn't emit anything
      await expectEvents(backingManager.claimRewards(), [])
    })
  })


  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expect(eUsdcCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await eUsdcCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await eUsdcCollateral.refresh()
      expect(await eUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED,
        eUsdc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        await usdc.decimals(),
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // go forward in time and blocks to get around gas limit error during deployment
      await advanceTime(1)
      await advanceBlocks(10)

      // Reverts with a feed with zero price
      const invalidpriceCtokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        eUsdc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        await usdc.decimals(),
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
      const newEUsdcCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        await eUsdcCollateral.erc20(),
        await eUsdcCollateral.maxTradeVolume(),
        await eUsdcCollateral.oracleTimeout(),
        await eUsdcCollateral.targetName(),
        await eUsdcCollateral.defaultThreshold(),
        await eUsdcCollateral.delayUntilDefault(),
        8,
      )

      // Check initial state
      expect(await newEUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newEUsdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newEUsdcCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newEUsdcCollateral.refresh())
        .to.emit(newEUsdcCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newEUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newEUsdcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newEUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newEUsdcCollateral.whenDefault()
      await expect(newEUsdcCollateral.refresh()).to.not.emit(
        newEUsdcCollateral,
        'CollateralStatusChanged'
      )
      expect(await newEUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newEUsdcCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const ETokenMockFactory: ContractFactory = await ethers.getContractFactory('ETokenMock')
      const symbol = await eUsdc.symbol()
      const eUsdcMock: ETokenMock = <ETokenMock>(
        await ETokenMockFactory.deploy(symbol + ' Token', symbol, usdc.address, {gasLimit: 2000000})
      )
      // Set initial exchange rate to the new eUsdc Mock
      await eUsdcMock.setExchangeRate(fp('1.1'))

      // Redeploy plugin using the new eUsdc mock
      const newEUsdcCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>await (
        await ethers.getContractFactory('ETokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await eUsdcCollateral.chainlinkFeed(),
        eUsdcMock.address,
        await eUsdcCollateral.maxTradeVolume(),
        await eUsdcCollateral.oracleTimeout(),
        await eUsdcCollateral.targetName(),
        await eUsdcCollateral.defaultThreshold(),
        await eUsdcCollateral.delayUntilDefault(),
        8,
        {gasLimit: 5000000}
      )

      // Check initial state
      expect(await newEUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newEUsdcCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for eUSDC, will disable collateral immediately
      await eUsdcMock.setExchangeRate(fp('1.09'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newEUsdcCollateral.refresh())
        .to.emit(newEUsdcCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newEUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newEUsdcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidETokenCollateral: ETokenFiatCollateral = <ETokenFiatCollateral>(
        await ETokenCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await eUsdcCollateral.erc20(),
          await eUsdcCollateral.maxTradeVolume(),
          await eUsdcCollateral.oracleTimeout(),
          await eUsdcCollateral.targetName(),
          await eUsdcCollateral.defaultThreshold(),
          await eUsdcCollateral.delayUntilDefault(),
          8,
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidETokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidETokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidETokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidETokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

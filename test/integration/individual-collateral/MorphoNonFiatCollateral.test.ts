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
import { expectInIndirectReceipt } from '../../../common/events'
import { bn, fp } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  ComptrollerMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  IMCToken,
  InvalidMockV3Aggregator,
  OracleLib,
  MCTokenMock,
  MorphoNonFiatCollateral,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../typechain'
import { useEnv } from '#/utils/env'
import forkBlockNumber from '../fork-block-numbers'

// Setup test environment
const setup = async (blockNumber: number) => {
  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderWBTC = '0xBF72Da2Bd84c5170618Fbe5914B0ECA9638d5eb5'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`MorphoNonFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let wbtc: ERC20Mock
  let mcWbtc: IMCToken
  let mcWbtcCollateral: MorphoNonFiatCollateral
  let compToken: ERC20Mock
  let compAsset: Asset
  let comptroller: ComptrollerMock
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

  const defaultThreshold = fp('0.9') // 90%
  const delayUntilDefault = bn('86400') // 24h
  const wbtcDecimals = 8

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let MorphoCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  before(async () => {
    await setup(forkBlockNumber['morpho-vault-deployment'])
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  after(async () => {
    await setup(forkBlockNumber['default'])
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // Get required contracts for cWBTC
    // COMP token
    compToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.COMP || '')
    )
    // Compound Comptroller
    comptroller = await ethers.getContractAt(
      'ComptrollerMock',
      networkConfig[chainId].COMPTROLLER || ''
    )
    // WBTC token
    wbtc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WBTC || '')
    )
    // mcWBTC token
    mcWbtc = <IMCToken>(
      await ethers.getContractAt('IMCToken', networkConfig[chainId].tokens.mcWBTC || '')
    )

    // Create COMP asset
    compAsset = <Asset>(
      await (
        await ethers.getContractFactory('Asset')
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.COMP || '',
        compToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT
      )
    )

    // Deploy mcWbtc collateral plugin
    MorphoCollateralFactory = await ethers.getContractFactory('MorphoNonFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    mcWbtcCollateral = <MorphoNonFiatCollateral>(
      await MorphoCollateralFactory.deploy(
        fp('0.02'),
        networkConfig[chainId].chainlinkFeeds.WBTC as string,
        networkConfig[chainId].chainlinkFeeds.BTC as string,
        mcWbtc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        wbtcDecimals,
        comptroller.address
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // WBTC
    initialBal = bn('10000e8')
    await whileImpersonating(holderWBTC, async (wbtcSigner) => {
      await wbtc.connect(wbtcSigner).transfer(addr1.address, initialBal)
    })
    await wbtc.connect(addr1).approve(mcWbtc.address, initialBal)
    await mcWbtc.connect(addr1).deposit(initialBal.sub(bn('1e8')), addr1.address)

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [compAsset.address],
      primaryBasket: [mcWbtcCollateral.address],
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
      // COMP Asset
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compAsset.erc20()).to.equal(networkConfig[chainId].tokens.COMP)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.strictPrice()).to.be.closeTo(fp('38.79'), fp('0.5'))
      await expect(compAsset.claimRewards()).to.not.emit(compAsset, 'RewardsClaimed')
      expect(await compAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check Collateral plugin
      // mcWBTC (MorphoNonFiatCollateral)
      expect(await mcWbtcCollateral.isCollateral()).to.equal(true)
      expect(await mcWbtcCollateral.referenceERC20Decimals()).to.equal(await wbtc.decimals())
      expect(await mcWbtcCollateral.erc20()).to.equal(mcWbtc.address)
      expect(await mcWbtc.decimals()).to.equal(18)
      expect(await mcWbtcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await mcWbtcCollateral.refPerTok()).to.be.closeTo(bn('1.000013e8'), fp('0.0001'))
      expect(await mcWbtcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await mcWbtcCollateral.pricePerTarget()).to.be.closeTo(fp('16641.12'), fp('0.01'))
      expect(await mcWbtcCollateral.prevReferencePrice()).to.equal(
        await mcWbtcCollateral.refPerTok()
      )
      expect(await mcWbtcCollateral.strictPrice()).to.be.closeTo(bn('16591.422e8'), bn('0.001e8'))

      // Check claim data
      await expect(mcWbtcCollateral.claimRewards())
        .to.emit(mcWbtcCollateral, 'RewardsClaimed')
        .withArgs(compToken.address, 0)
      expect(await mcWbtcCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(compToken.address)
      expect(ERC20s[3]).to.equal(mcWbtc.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(mcWbtcCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(mcWbtcCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(mcWbtc.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('16591.2'), fp('0.1'))

      // Check RToken price
      const issueAmount: BigNumber = bn('1000e8')
      await mcWbtc.connect(addr1).approve(rToken.address, bn('1000e20'))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('16591.20'), fp('0.01'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        MorphoCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.WBTC as string,
          networkConfig[chainId].chainlinkFeeds.BTC as string,
          mcWbtc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          delayUntilDefault,
          wbtcDecimals,
          comptroller.address
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferemceERC20Decimals
      await expect(
        MorphoCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.WBTC as string,
          networkConfig[chainId].chainlinkFeeds.BTC as string,
          mcWbtc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          0,
          comptroller.address
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')

      // Comptroller
      await expect(
        MorphoCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.WBTC as string,
          networkConfig[chainId].chainlinkFeeds.BTC as string,
          mcWbtc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          wbtcDecimals,
          ZERO_ADDRESS
        )
      ).to.be.revertedWith('comptroller missing')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = bn('1000e8')

      // Provide approvals for issuances
      await mcWbtc.connect(addr1).approve(rToken.address, bn('1000e20'))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cWbtc: BigNumber = await mcWbtc.balanceOf(addr1.address)

      // Check rates and prices
      const cWbtcPrice1: BigNumber = await mcWbtcCollateral.strictPrice()
      const cWbtcRefPerTok1: BigNumber = await mcWbtcCollateral.refPerTok()

      expect(cWbtcPrice1).to.be.closeTo(bn('16591.42e8'), bn('0.01e8'))
      expect(cWbtcRefPerTok1).to.be.closeTo(bn('1.000013e8'), bn('0.00001e8'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150'))

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Updating internal values in morpho vault requires one of its state modifying functions to be called.
      // Unless this is done exchange rates won't update
      await mcWbtc.connect(addr1).deposit(bn('1'), addr1.address)

      // Refresh cToken manually (required)
      await mcWbtcCollateral.refresh()
      expect(await mcWbtcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const cWbtcPrice2: BigNumber = await mcWbtcCollateral.strictPrice()
      const cWbtcRefPerTok2: BigNumber = await mcWbtcCollateral.refPerTok()

      // Check rates and price increase
      expect(cWbtcPrice2).to.be.gt(cWbtcPrice1)
      expect(cWbtcRefPerTok2).to.be.gt(cWbtcRefPerTok1)

      // Still close to the original values
      expect(cWbtcPrice2).to.be.closeTo(bn('16591.42e8'), bn('0.01e8'))
      expect(cWbtcRefPerTok2).to.be.closeTo(bn('1.000013e8'), bn('0.00001e8'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks, causing refPerTok() to increase
      await advanceTime(10000000)
      await advanceBlocks(1000000)

      // Update vault state
      await mcWbtc.connect(addr1).deposit(bn('1'), addr1.address)

      // Refresh cToken manually (required)
      await mcWbtcCollateral.refresh()
      expect(await mcWbtcCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const cWbtcPrice3: BigNumber = await mcWbtcCollateral.strictPrice()
      const cWbtcRefPerTok3: BigNumber = await mcWbtcCollateral.refPerTok()

      // Check rates and price increase
      expect(cWbtcPrice3).to.be.gt(cWbtcPrice2)
      expect(cWbtcRefPerTok3).to.be.gt(cWbtcRefPerTok2)

      // Need to adjust ranges
      expect(cWbtcPrice3).to.be.closeTo(bn('16592.06e8'), bn('0.01e8'))
      expect(cWbtcRefPerTok3).to.be.closeTo(bn('1.00005192e8'), bn('0.00001e8'))

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
      const newBalanceAddr1cWbtc: BigNumber = await mcWbtc.balanceOf(addr1.address)
      expect(newBalanceAddr1cWbtc.sub(balanceAddr1cWbtc)).to.be.closeTo(fp('999.94'), fp('0.01'))

      // Check remainders in Backing Manager
      expect(await mcWbtc.balanceOf(backingManager.address)).to.be.closeTo(
        fp('0.0389'),
        fp('0.0001')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        bn('645.72e8'),
        bn('0.01e8')
      )
    })
  })

  // No comp rewards for wbtc

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expect(mcWbtcCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await mcWbtcCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('0.02'))

      // Update vault state
      await mcWbtc.connect(addr1).deposit(bn('1'), addr1.address)

      // Refresh should mark status IFFY
      await mcWbtcCollateral.refresh()
      expect(await mcWbtcCollateral.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: MorphoNonFiatCollateral = <MorphoNonFiatCollateral>await (
        await ethers.getContractFactory('MorphoNonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        NO_PRICE_DATA_FEED,
        NO_PRICE_DATA_FEED,
        mcWbtc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        wbtcDecimals,
        comptroller.address
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceCtokenCollateral: MorphoNonFiatCollateral = <MorphoNonFiatCollateral>await (
        await ethers.getContractFactory('MorphoNonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        mockChainlinkFeed.address,
        networkConfig[chainId].chainlinkFeeds.BTC as string,
        mcWbtc.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        wbtcDecimals,
        comptroller.address
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
      const newCWbtCollateral: MorphoNonFiatCollateral = <MorphoNonFiatCollateral>await (
        await ethers.getContractFactory('MorphoNonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        mockChainlinkFeed.address,
        networkConfig[chainId].chainlinkFeeds.BTC as string,
        await mcWbtcCollateral.erc20(),
        await mcWbtcCollateral.maxTradeVolume(),
        await mcWbtcCollateral.oracleTimeout(),
        await mcWbtcCollateral.targetName(),
        await mcWbtcCollateral.defaultThreshold(),
        await mcWbtcCollateral.delayUntilDefault(),
        wbtcDecimals,
        comptroller.address
      )

      // Check initial state
      expect(await newCWbtCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newCWbtCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newCWbtCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newCWbtCollateral.refresh())
        .to.emit(newCWbtCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newCWbtCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newCWbtCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newCWbtCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newCWbtCollateral.whenDefault()
      await expect(newCWbtCollateral.refresh()).to.not.emit(
        newCWbtCollateral,
        'CollateralStatusChanged'
      )
      expect(await newCWbtCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newCWbtCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a MCToken mock to be able to change the rate
      const MCTokenMockFactory: ContractFactory = await ethers.getContractFactory('MCTokenMock')
      const symbol = await mcWbtc.symbol()
      const poolToken = await mcWbtc.poolToken()
      const mcWbtcMock: MCTokenMock = <MCTokenMock>(
        await MCTokenMockFactory.deploy(symbol + ' Token', symbol, poolToken)
      )
      // Set initial exchange rate to the new mcWbtc Mock
      await mcWbtcMock.setExchangeRate(fp('1.001'))

      // Redeploy plugin using the new mcWbtc mock
      const newMCWbtcCollateral: MorphoNonFiatCollateral = <MorphoNonFiatCollateral>await (
        await ethers.getContractFactory('MorphoNonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        networkConfig[chainId].chainlinkFeeds.WBTC as string,
        networkConfig[chainId].chainlinkFeeds.BTC as string,
        mcWbtcMock.address,
        await mcWbtcCollateral.maxTradeVolume(),
        await mcWbtcCollateral.oracleTimeout(),
        await mcWbtcCollateral.targetName(),
        await mcWbtcCollateral.defaultThreshold(),
        await mcWbtcCollateral.delayUntilDefault(),
        wbtcDecimals,
        comptroller.address
      )

      // Check initial state
      expect(await newMCWbtcCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newMCWbtcCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for mcWBTC, will disable collateral immediately
      await mcWbtcMock.setExchangeRate(fp('0.9'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newMCWbtcCollateral.refresh())
        .to.emit(newMCWbtcCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newMCWbtcCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newMCWbtcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: MorphoNonFiatCollateral = <MorphoNonFiatCollateral>(
        await MorphoCollateralFactory.deploy(
          fp('0.02'),
          invalidChainlinkFeed.address,
          invalidChainlinkFeed.address,
          await mcWbtcCollateral.erc20(),
          await mcWbtcCollateral.maxTradeVolume(),
          await mcWbtcCollateral.oracleTimeout(),
          await mcWbtcCollateral.targetName(),
          await mcWbtcCollateral.defaultThreshold(),
          await mcWbtcCollateral.delayUntilDefault(),
          wbtcDecimals,
          comptroller.address
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

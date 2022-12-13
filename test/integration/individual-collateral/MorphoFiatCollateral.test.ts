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
  MorphoFiatCollateral,
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
const holderDAI = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`MorphoFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let dai: ERC20Mock
  let mcDai: IMCToken
  let mcDaiCollateral: MorphoFiatCollateral
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
  const daiDecimals = 18

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

    // Get required contracts for cDAI
    // COMP token
    compToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.COMP || '')
    )
    // Compound Comptroller
    comptroller = await ethers.getContractAt(
      'ComptrollerMock',
      networkConfig[chainId].COMPTROLLER || ''
    )
    // DAI token
    dai = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI || '')
    )
    // mcDAI token
    mcDai = <IMCToken>(
      await ethers.getContractAt('IMCToken', networkConfig[chainId].tokens.mcDAI || '')
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

    // Deploy mcDai collateral plugin
    MorphoCollateralFactory = await ethers.getContractFactory('MorphoFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    mcDaiCollateral = <MorphoFiatCollateral>(
      await MorphoCollateralFactory.deploy(
        fp('0.02'),
        networkConfig[chainId].chainlinkFeeds.DAI as string,
        mcDai.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        daiDecimals,
        comptroller.address
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // DAI
    initialBal = fp('10000000')
    await whileImpersonating(holderDAI, async (daiSigner) => {
      await dai.connect(daiSigner).transfer(addr1.address, initialBal)
    })
    await dai.connect(addr1).approve(mcDai.address, initialBal)
    await mcDai.connect(addr1).deposit(initialBal.sub(fp('100')), addr1.address)

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
      primaryBasket: [mcDaiCollateral.address],
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
      // mcDAI (MorphoFiatCollateral)
      expect(await mcDaiCollateral.isCollateral()).to.equal(true)
      expect(await mcDaiCollateral.referenceERC20Decimals()).to.equal(await dai.decimals())
      expect(await mcDaiCollateral.erc20()).to.equal(mcDai.address)
      expect(await mcDai.decimals()).to.equal(18)
      expect(await mcDaiCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await mcDaiCollateral.refPerTok()).to.be.closeTo(fp('1.001'), fp('0.001'))
      expect(await mcDaiCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await mcDaiCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await mcDaiCollateral.prevReferencePrice()).to.equal(await mcDaiCollateral.refPerTok())
      expect(await mcDaiCollateral.strictPrice()).to.be.closeTo(fp('1.00109'), fp('0.001'))

      // Check claim data
      await expect(mcDaiCollateral.claimRewards())
        .to.emit(mcDaiCollateral, 'RewardsClaimed')
        .withArgs(compToken.address, 0)
      expect(await mcDaiCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

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
      expect(ERC20s[3]).to.equal(mcDai.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(mcDaiCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(mcDaiCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(mcDai.address)
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
      await mcDai.connect(addr1).approve(rToken.address, issueAmount.mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        MorphoCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          mcDai.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(0),
          delayUntilDefault,
          daiDecimals,
          comptroller.address
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // ReferemceERC20Decimals
      await expect(
        MorphoCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          mcDai.address,
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
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          mcDai.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
          daiDecimals,
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
      await mcDai.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cDai: BigNumber = await mcDai.balanceOf(addr1.address)

      // Check rates and prices
      const cDaiPrice1: BigNumber = await mcDaiCollateral.strictPrice()
      const cDaiRefPerTok1: BigNumber = await mcDaiCollateral.refPerTok()

      expect(cDaiPrice1).to.be.closeTo(fp('1.00109'), fp('0.0001'))
      expect(cDaiRefPerTok1).to.be.closeTo(fp('1.00109'), fp('0.0001'))

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
      await mcDai.connect(addr1).deposit(bn('1'), addr1.address)

      // Refresh cToken manually (required)
      await mcDaiCollateral.refresh()
      expect(await mcDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight inrease
      const cDaiPrice2: BigNumber = await mcDaiCollateral.strictPrice()
      const cDaiRefPerTok2: BigNumber = await mcDaiCollateral.refPerTok()

      // Check rates and price increase
      expect(cDaiPrice2).to.be.gt(cDaiPrice1)
      expect(cDaiRefPerTok2).to.be.gt(cDaiRefPerTok1)

      // Still close to the original values
      expect(cDaiPrice2).to.be.closeTo(fp('1.00109'), fp('0.001'))
      expect(cDaiRefPerTok2).to.be.closeTo(fp('1.00109'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks, causing refPerTok() to increase
      await advanceTime(10000000)
      await advanceBlocks(1000000)

      // Update vault state
      await mcDai.connect(addr1).deposit(bn('1'), addr1.address)

      // Refresh cToken manually (required)
      await mcDaiCollateral.refresh()
      expect(await mcDaiCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const cDaiPrice3: BigNumber = await mcDaiCollateral.strictPrice()
      const cDaiRefPerTok3: BigNumber = await mcDaiCollateral.refPerTok()

      // Check rates and price increase
      expect(cDaiPrice3).to.be.gt(cDaiPrice2)
      expect(cDaiRefPerTok3).to.be.gt(cDaiRefPerTok2)

      // Need to adjust ranges
      expect(cDaiPrice3).to.be.closeTo(fp('1.005474256598464818'), fp('0.001'))
      expect(cDaiRefPerTok3).to.be.closeTo(fp('1.005474256598464818'), fp('0.001'))

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
      const newBalanceAddr1cDai: BigNumber = await mcDai.balanceOf(addr1.address)
      expect(newBalanceAddr1cDai.sub(balanceAddr1cDai)).to.be.closeTo(fp('9946.2015'), fp('0.1'))

      // Check remainders in Backing Manager
      expect(await mcDai.balanceOf(backingManager.address)).to.be.closeTo(fp('43.48'), fp('0.01'))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('43.71'),
        fp('0.01')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const issueAmount: BigNumber = bn('10000e18')

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [compToken.address, bn(0)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

      // Provide approvals for issuances
      await mcDai.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards both in COMP
      const rewardsCOMP1: BigNumber = await compToken.balanceOf(backingManager.address)

      expect(rewardsCOMP1).to.be.gt(0)

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardsCOMP2: BigNumber = await compToken.balanceOf(backingManager.address)

      expect(rewardsCOMP2.sub(rewardsCOMP1)).to.be.gt(0)
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expect(mcDaiCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await mcDaiCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('0.02'))

      // Update vault state
      await mcDai.connect(addr1).deposit(bn('1'), addr1.address)

      // Refresh should mark status IFFY
      await mcDaiCollateral.refresh()
      expect(await mcDaiCollateral.status()).to.equal(CollateralStatus.IFFY)

      // CTokens Collateral with no price
      const nonpriceCtokenCollateral: MorphoFiatCollateral = <MorphoFiatCollateral>await (
        await ethers.getContractFactory('MorphoFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        NO_PRICE_DATA_FEED,
        mcDai.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        daiDecimals,
        comptroller.address
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceCtokenCollateral: MorphoFiatCollateral = <MorphoFiatCollateral>await (
        await ethers.getContractFactory('MorphoFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        mockChainlinkFeed.address,
        mcDai.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        daiDecimals,
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
      const newCDaiCollateral: MorphoFiatCollateral = <MorphoFiatCollateral>await (
        await ethers.getContractFactory('MorphoFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        mockChainlinkFeed.address,
        await mcDaiCollateral.erc20(),
        await mcDaiCollateral.maxTradeVolume(),
        await mcDaiCollateral.oracleTimeout(),
        await mcDaiCollateral.targetName(),
        await mcDaiCollateral.defaultThreshold(),
        await mcDaiCollateral.delayUntilDefault(),
        daiDecimals,
        comptroller.address
      )

      // Check initial state
      expect(await newCDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newCDaiCollateral.whenDefault()).to.equal(MAX_UINT256)

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
      // Note: In this case requires to use a MCToken mock to be able to change the rate
      const MCTokenMockFactory: ContractFactory = await ethers.getContractFactory('MCTokenMock')
      const symbol = await mcDai.symbol()
      const poolToken = await mcDai.poolToken()
      const mcDaiMock: MCTokenMock = <MCTokenMock>(
        await MCTokenMockFactory.deploy(symbol + ' Token', symbol, poolToken)
      )
      // Set initial exchange rate to the new mcDai Mock
      await mcDaiMock.setExchangeRate(fp('1.001'))

      // Redeploy plugin using the new mcDai mock
      const newMCDaiCollateral: MorphoFiatCollateral = <MorphoFiatCollateral>await (
        await ethers.getContractFactory('MorphoFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        await mcDaiCollateral.chainlinkFeed(),
        mcDaiMock.address,
        await mcDaiCollateral.maxTradeVolume(),
        await mcDaiCollateral.oracleTimeout(),
        await mcDaiCollateral.targetName(),
        await mcDaiCollateral.defaultThreshold(),
        await mcDaiCollateral.delayUntilDefault(),
        daiDecimals,
        comptroller.address
      )

      // Check initial state
      expect(await newMCDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newMCDaiCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for mcDAI, will disable collateral immediately
      await mcDaiMock.setExchangeRate(fp('0.9'))

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newMCDaiCollateral.refresh())
        .to.emit(newMCDaiCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newMCDaiCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newMCDaiCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: MorphoFiatCollateral = <MorphoFiatCollateral>(
        await MorphoCollateralFactory.deploy(
          fp('0.02'),
          invalidChainlinkFeed.address,
          await mcDaiCollateral.erc20(),
          await mcDaiCollateral.maxTradeVolume(),
          await mcDaiCollateral.oracleTimeout(),
          await mcDaiCollateral.targetName(),
          await mcDaiCollateral.defaultThreshold(),
          await mcDaiCollateral.delayUntilDefault(),
          daiDecimals,
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

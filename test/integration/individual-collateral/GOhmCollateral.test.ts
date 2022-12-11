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
  GOhmCollateral,
  GOhmCollateral__factory,
  GOHMMock,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const holder = '0x184f3fad8618a6f458c16bae63f70c426fe784b3'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`GOhmCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let gOhm: GOHMMock
  let gOhmCollateral: GOhmCollateral

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

  const referenceERC20Decimals = 9
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let gOhmCollateralFactory: GOhmCollateral__factory
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
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, govParams } = await loadFixture(
      defaultFixture
    ))

    // Setup required token contracts
    // gOhm token
    gOhm = <GOHMMock>(
      await ethers.getContractAt('GOHMMock', networkConfig[chainId].tokens.GOHM || '')
    )

    // Deploy gOhm collateral plugin
    gOhmCollateralFactory = await ethers.getContractFactory('GOhmCollateral')
    gOhmCollateral = <GOhmCollateral>(
      await gOhmCollateralFactory.deploy(
        fp('2800'),
        networkConfig[chainId].chainlinkFeeds.OHM as string,
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        gOhm.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('OHM'),
        delayUntilDefault,
        referenceERC20Decimals
      )
    )

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
      primaryBasket: [gOhmCollateral.address],
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
    mockChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, fp('0.0071722982'))
    )

    initialBal = fp('1000')
    await whileImpersonating(holder, async (signer) => {
      await gOhm.connect(signer).transfer(addr1.address, initialBal)
    })
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      // GOhmCollateral
      expect(await gOhmCollateral.isCollateral()).to.equal(true)
      expect(await gOhmCollateral.erc20()).to.equal(gOhm.address)
      expect(await gOhm.decimals()).to.equal(18)
      expect(await gOhmCollateral.referenceERC20Decimals()).to.equal(referenceERC20Decimals)
      expect(await gOhmCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('OHM'))
      expect(await gOhmCollateral.refPerTok()).to.be.closeTo(fp('158'), fp('1'))
      expect(await gOhmCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await gOhmCollateral.pricePerTarget()).to.closeTo(fp('18.641681548'), fp('1')) // for pined block 14916729
      expect(await gOhmCollateral.prevReferencePrice()).to.be.closeTo(
        await gOhmCollateral.refPerTok(),
        fp('0.01')
      )
      expect(await gOhmCollateral.strictPrice()).to.be.closeTo(fp('2945'), fp('100'))
      expect(await gOhmCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await gOhmCollateral.delayUntilDefault()).to.equal(delayUntilDefault)
      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(gOhm.address)
      expect(ERC20s.length).to.equal(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(gOhmCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(gOhmCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(gOhm.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('18.64'), fp('0.1'))

      // Check RToken price
      const issueAmount: BigNumber = bn('100e18')

      await gOhm.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('18.64'), fp('0.01'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // ETH/USD price feed
      await expect(
        gOhmCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.OHM as string,
          ZERO_ADDRESS,
          gOhm.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('OHM'),
          delayUntilDefault,
          referenceERC20Decimals
        )
      ).to.be.revertedWith('missing uoaPerEthChainlinkFeed_')

      // ETH/OHM price feed
      await expect(
        gOhmCollateralFactory.deploy(
          fp('1'),
          ZERO_ADDRESS,
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          gOhm.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('OHM'),
          delayUntilDefault,
          referenceERC20Decimals
        )
      ).to.be.revertedWith('missing chainlink feed')

      // referenceERC20Decimals
      await expect(
        gOhmCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.OHM as string,
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          gOhm.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('OHM'),
          delayUntilDefault,
          0
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = fp('1000')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await gOhm.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1GOhm: BigNumber = await gOhm.balanceOf(addr1.address)

      // Check rates and prices
      const gOhmPrice1: BigNumber = await gOhmCollateral.strictPrice() // ~ 2945 USD
      const gOhmRefPerTok1: BigNumber = await gOhmCollateral.refPerTok() // ~ 158 OHM

      expect(gOhmPrice1).to.be.closeTo(fp('2945'), fp('10'))
      expect(gOhmRefPerTok1).to.be.gt(fp('158'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )

      // ~  approx 18K ~ 1000 * 18.64 in value
      expect(totalAssetValue1).to.be.closeTo(issueAmount.mul(18), fp('1000'))

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10_000)
      await advanceBlocks(10_000)

      // Refresh gOhmCollateral manually (required)
      await gOhmCollateral.refresh()
      expect(await gOhmCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - They should be the same as before
      // Because oracle and stETH contract didn't change
      const gOhmRefPerTok2: BigNumber = await gOhmCollateral.refPerTok()
      const gOhmPrice2: BigNumber = await gOhmCollateral.strictPrice()

      // Check rates and price be same
      expect(gOhmPrice2).to.be.eq(gOhmPrice1)
      expect(gOhmRefPerTok2).to.be.eq(gOhmRefPerTok1)

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.eq(totalAssetValue1)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer gOhm should have been sent to the user
      const newBalanceAddr1GOhm: BigNumber = await gOhm.balanceOf(addr1.address)

      // Check received tokens represent ~1K in value at current prices
      expect(newBalanceAddr1GOhm.sub(balanceAddr1GOhm)).to.be.closeTo(fp('6'), fp('0.5'))

      // Check remainders in Backing Manager
      expect(await gOhm.balanceOf(backingManager.address)).to.be.eq(fp('0'))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.eq(fp('0'))
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      // Only checking to see that claim call does not revert
      await expectEvents(backingManager.claimRewards(), [])
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with a feed with zero price
      const invalidPriceGOhmCollateral: GOhmCollateral = <GOhmCollateral>(
        await (
          await ethers.getContractFactory('GOhmCollateral')
        ).deploy(
          fp('1'),
          mockChainlinkFeed.address,
          mockChainlinkFeed.address,
          gOhm.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('OHM'),
          delayUntilDefault,
          referenceERC20Decimals
        )
      )
      await setOraclePrice(invalidPriceGOhmCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidPriceGOhmCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidPriceGOhmCollateral.refresh()
      expect(await invalidPriceGOhmCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())
      await expect(gOhmCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await invalidPriceGOhmCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status DISABLED
      await gOhmCollateral.refresh()
      expect(await gOhmCollateral.status()).to.equal(CollateralStatus.IFFY)
      await advanceBlocks(delayUntilDefault.mul(60))
      await gOhmCollateral.refresh()
      expect(await gOhmCollateral.status()).to.equal(CollateralStatus.DISABLED)

      const nonPriceGOhmCollateral: GOhmCollateral = <GOhmCollateral>(
        await (
          await ethers.getContractFactory('GOhmCollateral')
        ).deploy(
          fp('1'),
          NO_PRICE_DATA_FEED,
          NO_PRICE_DATA_FEED,
          gOhm.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('OHM'),
          delayUntilDefault,
          referenceERC20Decimals
        )
      )

      // Collateral with no price info should revert
      await expect(nonPriceGOhmCollateral.strictPrice()).to.be.reverted

      expect(await nonPriceGOhmCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for soft default
    it('No Updates status in case of soft default because there is no soft reset', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const mockUoaPerEthChainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
        await MockV3AggregatorFactory.deploy(18, fp('2000')) // ETH price ~= 2000
      )

      // ETH/OHM feed
      const mockEthPerRefChainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
        await MockV3AggregatorFactory.deploy(18, fp('0.0071'))
      )

      const newGOhmCollateral: GOhmCollateral = <GOhmCollateral>(
        await (
          await ethers.getContractFactory('GOhmCollateral')
        ).deploy(
          fp('2000'),
          mockEthPerRefChainlinkFeed.address,
          mockUoaPerEthChainlinkFeed.address,
          await gOhmCollateral.erc20(),
          await gOhmCollateral.maxTradeVolume(),
          await gOhmCollateral.oracleTimeout(),
          await gOhmCollateral.targetName(),
          await gOhmCollateral.delayUntilDefault(),
          referenceERC20Decimals
        )
      )

      // Check initial state
      expect(await newGOhmCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newGOhmCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Reducing price of gOHM should be sound
      const v3Aggregator = await ethers.getContractAt(
        'MockV3Aggregator',
        mockUoaPerEthChainlinkFeed.address
      )
      await v3Aggregator.updateAnswer(fp('1000'))

      await expect(newGOhmCollateral.refresh()).not.emit(
        newGOhmCollateral,
        'CollateralStatusChanged'
      )
      expect(await newGOhmCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newGOhmCollateral.whenDefault()).to.equal(MAX_UINT256)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a gOhm mock to be able to change the rate
      // to hard default
      const gOhmOracle = (await ethers.getSigners())[3]
      const GOhmMockFactory = await ethers.getContractFactory('GOHMMock')
      const gOhmMock: GOHMMock = <GOHMMock>await GOhmMockFactory.deploy()

      // Set initial exchange rate to the new gOhm Mock
      await gOhmMock.connect(gOhmOracle).setIndex(bn('1e9'))
      console.log(await gOhmMock.index())

      // Redeploy plugin using the new gOhm mock
      const newGOhmCollateral: GOhmCollateral = <GOhmCollateral>(
        await (
          await ethers.getContractFactory('GOhmCollateral')
        ).deploy(
          fp('1'),
          await gOhmCollateral.chainlinkFeed(),
          await gOhmCollateral.chainlinkFeed(),
          gOhmMock.address,
          await gOhmCollateral.maxTradeVolume(),
          await gOhmCollateral.oracleTimeout(),
          await gOhmCollateral.targetName(),
          await gOhmCollateral.delayUntilDefault(),
          referenceERC20Decimals
        )
      )

      // init prevRefPerTok
      await newGOhmCollateral.refresh()

      // Check initial state
      expect(await newGOhmCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newGOhmCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for gOhm, will disable collateral immediately
      await gOhmMock.connect(gOhmOracle).setIndex(bn('9e8'))

      // Force updates - Should update whenDefault and status
      await expect(newGOhmCollateral.refresh())
        .to.emit(newGOhmCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newGOhmCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newGOhmCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(18, fp('1800'))
      )

      const invalidWstETHCollateral: GOhmCollateral = <GOhmCollateral>(
        await gOhmCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          invalidChainlinkFeed.address,
          await gOhmCollateral.erc20(),
          await gOhmCollateral.maxTradeVolume(),
          await gOhmCollateral.oracleTimeout(),
          await gOhmCollateral.targetName(),
          await gOhmCollateral.delayUntilDefault(),
          referenceERC20Decimals
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidWstETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidWstETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Running out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidWstETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidWstETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

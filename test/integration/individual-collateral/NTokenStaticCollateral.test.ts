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
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  INotionalProxy,
  MockV3Aggregator,
  NTokenERC20ProxyMock,
  NTokenStaticCollateral,
  OracleLib,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../typechain'
import { setOraclePrice } from '../../utils/oracles'
import forkBlockNumber from '../fork-block-numbers'

const createFixtureLoader = waffle.createFixtureLoader

const HOLDER_nETH = '0x499b48d5998589a4d58182de765443662bd67b77'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

describe.skip(`NTokenStaticCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let notionalProxy: INotionalProxy
  let nEth: NTokenERC20ProxyMock
  let nEthCollateral: NTokenStaticCollateral
  let noteToken: ERC20Mock
  let noteAsset: Asset
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
  const allowedDropBasisPoints = 100 // 1%

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let NTokenStaticCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

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

  before(async () => {
    await setup(forkBlockNumber['notional-native-coins-wallet'])
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

    // NOTE token
    noteToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.NOTE || '')
    )

    // nETH live token
    nEth = <NTokenERC20ProxyMock>(
      await ethers.getContractAt('NTokenERC20ProxyMock', networkConfig[chainId].tokens.nETH || '')
    )

    // Notional Proxy
    notionalProxy = <INotionalProxy>(
      await ethers.getContractAt('INotionalProxy', networkConfig[chainId].NOTIONAL_PROXY || '')
    )

    // Create NOTE asset
    noteAsset = <Asset>await (
      await ethers.getContractFactory('NoteAsset', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      fp('0.22'),
      networkConfig[chainId].chainlinkFeeds.ETH || '',
      networkConfig[chainId].balancerPools.NOTE || '',
      noteToken.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )

    // Deploy nEth collateral plugin
    NTokenStaticCollateralFactory = await ethers.getContractFactory('NTokenStaticCollateral')
    nEthCollateral = <NTokenStaticCollateral>(
      await NTokenStaticCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        nEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        allowedDropBasisPoints,
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        notionalProxy.address,
        defaultThreshold
      )
    )

    // Setup balances of nETH for addr1 - Transfer from Mainnet holder
    await whileImpersonating(HOLDER_nETH, async (nEthSigner) => {
      await nEth.connect(nEthSigner).transfer(addr1.address, bn('2000e8'))
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
      assets: [noteAsset.address],
      primaryBasket: [nEthCollateral.address],
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
      // Check Rewards asset NOTE
      expect(await noteAsset.isCollateral()).to.equal(false)
      expect(await noteAsset.erc20()).to.equal(noteToken.address)
      expect(await noteAsset.erc20()).to.equal(networkConfig[chainId].tokens.NOTE)
      expect(await noteToken.decimals()).to.equal(8)
      expect(await noteAsset.strictPrice()).to.be.closeTo(fp('0.22'), fp('0.5'))
      await expect(noteAsset.claimRewards()).to.not.emit(noteAsset, 'RewardsClaimed')
      expect(await noteAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check nETH Collateral plugin'
      expect(await nEthCollateral.isCollateral()).to.equal(true)
      expect(await nEthCollateral.erc20Decimals()).to.equal(await nEth.decimals())
      expect(await nEthCollateral.erc20()).to.equal(nEth.address)
      expect(await nEth.decimals()).to.equal(8)
      expect(await nEthCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await nEthCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await nEthCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await nEthCollateral.refPerTok()).to.closeTo(fp('0.02'), fp('0.005')) // close to $1
      expect(await nEthCollateral.strictPrice()).to.be.closeTo(fp('26.9'), fp('0.1')) // close to $1
      expect(await nEthCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check claim data
      await expect(nEthCollateral.claimRewards())
        .to.emit(nEthCollateral, 'RewardsClaimed')
        .withArgs(noteToken.address, 0)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(noteToken.address)
      expect(ERC20s[3]).to.equal(nEth.address)
      expect(ERC20s.length).to.eql(4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(noteAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(nEthCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(nEthCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(nEth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('1355'), fp('1'))

      // Check RToken price
      const issueAmount: BigNumber = bn('100e8')
      await nEth.connect(addr1).approve(rToken.address, issueAmount)
      expect(await rToken.connect(addr1).balanceOf(addr1.address)).to.equal(bn('0'))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rToken.connect(addr1).balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1355.9'), fp('0.1'))
    })

    // Validate constructor arguments
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        NTokenStaticCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          nEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          100, // 1%
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          ethers.constants.AddressZero,
          defaultThreshold
        )
      ).to.be.revertedWith('Notional proxy address missing')

      // Allowed refPerTok drop too high
      await expect(
        NTokenStaticCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          nEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          10000, // 100%
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold
        )
      ).to.be.revertedWith('Allowed refPerTok drop out of range')

      // Negative drop on refPerTok
      await expect(
        NTokenStaticCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          nEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          -1, // negative value
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold
        )
      ).to.be.reverted
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount = bn('100e8')

      // Provide approvals for issuances
      await nEth.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1nEth: BigNumber = await nEth.balanceOf(addr1.address)

      // Check rates and prices
      const nEthPrice1: BigNumber = await nEthCollateral.strictPrice()
      const nEthRefPerTok1: BigNumber = await nEthCollateral.refPerTok()

      expect(nEthPrice1).to.be.closeTo(fp('26.9'), fp('0.1'))
      expect(nEthRefPerTok1).to.be.closeTo(fp('0.0199'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      const minExpectedValue = minimumValue(issueAmount, allowedDropBasisPoints) // minimum expected value given the drop
      expect(totalAssetValue1).to.be.gt(minExpectedValue) // approx 10K in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh nToken manually (required)
      await nEthCollateral.refresh()
      expect(await nEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const nEthPrice2: BigNumber = await nEthCollateral.strictPrice()
      const nEthRefPerTok2: BigNumber = await nEthCollateral.refPerTok()

      // Still close to the original values
      expect(nEthPrice2).to.be.closeTo(fp('26.9'), fp('0.1'))
      expect(nEthRefPerTok2).to.be.closeTo(fp('0.0199'), fp('0.001'))

      // Check price is within the accepted range
      expect(nEthPrice2).to.be.gt(minimumValue(nEthPrice1, allowedDropBasisPoints))
      // Check the refPerTok is greater or equal than the previous one
      expect(nEthRefPerTok2).to.be.gte(nEthRefPerTok1)

      // Check total asset value did not drop more than the allowed margin
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gte(minimumValue(totalAssetValue1, allowedDropBasisPoints))

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await nEthCollateral.refresh()
      expect(await nEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const nEthPrice3: BigNumber = await nEthCollateral.strictPrice()
      const nEthRefPerTok3: BigNumber = await nEthCollateral.refPerTok()

      // Need to adjust ranges
      expect(nEthPrice3).to.be.closeTo(fp('26.9'), fp('0.1'))
      expect(nEthRefPerTok3).to.be.closeTo(fp('0.0199'), fp('0.001'))

      // Check price is within the accepted range
      expect(nEthPrice3).to.be.gt(minimumValue(nEthPrice2, allowedDropBasisPoints))
      // Check the refPerTok is greater or equal than the previous one
      expect(nEthRefPerTok3).to.be.gte(nEthRefPerTok2)

      // Check total asset value did not drop more than the allowed margin
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(minimumValue(totalAssetValue2, allowedDropBasisPoints))

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer cTokens should have been sent to the user
      const newBalanceAddr1nEth: BigNumber = await nEth.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1nEth.sub(balanceAddr1nEth)).to.equal(50)

      // Check remainders in Backing Manager
      expect(await nEth.balanceOf(backingManager.address)).to.be.closeTo(bn(1), bn(1e8))

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        fp('0.000000269883020234')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const issueAmount: BigNumber = bn('100e8')

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await noteToken.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [noteToken.address, bn(0)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await noteToken.balanceOf(backingManager.address)).to.equal(0)

      // Provide approvals for issuances
      await nEth.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await noteToken.balanceOf(backingManager.address)).to.equal(0)

      // Advance Time
      await advanceTime(800000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards in NOTE
      const rewardsNOTE1: BigNumber = await noteToken.balanceOf(backingManager.address)

      expect(rewardsNOTE1).to.be.gt(0)

      // Keep moving time
      await advanceTime(360000)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardsNOTE2: BigNumber = await noteToken.balanceOf(backingManager.address)

      expect(rewardsNOTE2.sub(rewardsNOTE1)).to.be.gt(0)
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      /** Default instance */
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Test oracle timout
      await expect(nEthCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await nEthCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status SOUND because this collateral does not check any peg,
      // it is statically pegged to the target (it IS the target)
      await nEthCollateral.refresh()
      expect(await nEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      /** No price instance */

      // nTokens Collateral with no price
      const nonPriceNEthCollateral = <NTokenStaticCollateral>(
        await NTokenStaticCollateralFactory.deploy(
          fp('1'),
          NO_PRICE_DATA_FEED,
          nEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          allowedDropBasisPoints,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold
        )
      )

      // Collateral with no price info should revert
      await expect(nonPriceNEthCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonPriceNEthCollateral.refresh()).to.not.be.reverted
      expect(await nonPriceNEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      /** Invalid price instance */

      // Reverts with a feed with zero price
      const invalidPriceNEthCollateral = <NTokenStaticCollateral>(
        await NTokenStaticCollateralFactory.deploy(
          fp('1'),
          mockChainlinkFeed.address,
          nEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          allowedDropBasisPoints,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold
        )
      )

      await setOraclePrice(invalidPriceNEthCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidPriceNEthCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status SOUND because this collateral does not check any peg,
      // it is statically pegged to the target (it IS the target)
      await invalidPriceNEthCollateral.refresh()
      expect(await invalidPriceNEthCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    it('Updates status in case of soft default', async () => {
      // For a statically pegged reference to target there is no need to test this because
      // there is no chainlink price feed being quoted on refresh.
      // One `ref` wils always equal to one `target` since it's the native coin
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate
      const NTokenMockFactory = await ethers.getContractFactory('NTokenERC20ProxyMock')
      const nToken: NTokenERC20ProxyMock = await NTokenMockFactory.deploy('TName', 'SMB')

      await nToken.connect(owner).mint(addr1.address, fp('1e8'))

      // Set initial exchange rate to the new nToken Mock
      await nToken.setUnderlyingValue(fp('1e8'))

      // Redeploy plugin using the new cDai mock
      const newNEthCollateral = <NTokenStaticCollateral>await NTokenStaticCollateralFactory.deploy(
        fp('1'),
        mockChainlinkFeed.address,
        nToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        100, // 1%
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        notionalProxy.address,
        defaultThreshold
      )

      // Initialize internal state of max redPerTok
      await newNEthCollateral.refresh()

      // Check initial state
      expect(await newNEthCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newNEthCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for nToken, will disable collateral immediately
      await nToken.setUnderlyingValue(fp('5e7'))

      // Force updates - Should update whenDefault and status for collateral
      await expect(newNEthCollateral.refresh())
        .to.emit(newNEthCollateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newNEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newNEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      // For a statically pegged reference to target there is no need to test this because
      // there is no chainlink price feed being quoted on refresh.
      // One `ref` wils always equal to one `target` since it's the native coin
    })
  })
})

function minimumValue(amount: BigNumber, allowedDrop: number): BigNumber {
  const one = 10000
  return amount.mul(one - allowedDrop).div(one)
}

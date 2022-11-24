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
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
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
  NTokenFiatCollateral,
  NTokenERC20ProxyMock,
  INotionalProxy,
  InvalidMockV3Aggregator,
} from '../../../typechain'
import { NotionalProxy } from '@typechain/NotionalProxy'
import forkBlockNumber from '../fork-block-numbers'
import { setOraclePrice } from '../../utils/oracles'

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = process.env.FORK ? describe : describe.skip

const HOLDER_nUSDC = '0x02479bfc7dce53a02e26fe7baea45a0852cb0909'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

describeFork(`NTokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let notionalProxy: NotionalProxy
  let nUsdc: NTokenERC20ProxyMock
  let nUsdcCollateral: NTokenFiatCollateral
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

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let NTokenFiatCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  describe('Default period', () => {
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

      initialBal = bn('2000000e18')

      // NOTE token
      noteToken = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.NOTE || '')
      )

      // nUSDC live token
      nUsdc = <NTokenERC20ProxyMock>(
        await ethers.getContractAt(
          'NTokenERC20ProxyMock',
          networkConfig[chainId].tokens.nUSDC || ''
        )
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

      // Deploy nUsdc collateral plugin
      NTokenFiatCollateralFactory = await ethers.getContractFactory('NTokenFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
      nUsdcCollateral = <NTokenFiatCollateral>(
        await NTokenFiatCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          nUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold,
          allowedDropBasisPoints
        )
      )

      // Setup balances of nUSDC for addr1 - Transfer from Mainnet holder
      initialBal = bn('2000000e18')
      await whileImpersonating(HOLDER_nUSDC, async (nUsdcSigner) => {
        await nUsdc.connect(nUsdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 8))
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
        primaryBasket: [nUsdcCollateral.address],
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
      const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
        .main
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

        // Check nUSDC Collateral plugin'
        expect(await nUsdcCollateral.isCollateral()).to.equal(true)
        expect(await nUsdcCollateral.erc20Decimals()).to.equal(await nUsdc.decimals())
        expect(await nUsdcCollateral.erc20()).to.equal(nUsdc.address)
        expect(await nUsdc.decimals()).to.equal(8)
        expect(await nUsdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(await nUsdcCollateral.targetPerRef()).to.equal(fp('1'))
        expect(await nUsdcCollateral.pricePerTarget()).to.equal(fp('1'))
        expect(await nUsdcCollateral.refPerTok()).to.closeTo(fp('0.02'), fp('0.005')) // close to $1
        expect(await nUsdcCollateral.strictPrice()).to.be.closeTo(fp('0.02'), fp('0.005')) // close to $1
        expect(await nUsdcCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

        // Check claim data
        await expect(nUsdcCollateral.claimRewards())
          .to.emit(nUsdcCollateral, 'RewardsClaimed')
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
        expect(ERC20s[3]).to.equal(nUsdc.address)
        expect(ERC20s.length).to.eql(4)

        // Assets
        expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
        expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
        expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(noteAsset.address)
        expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(nUsdcCollateral.address)

        // Collaterals
        expect(await assetRegistry.toColl(ERC20s[3])).to.equal(nUsdcCollateral.address)
      })

      // Check RToken basket
      it('Should register Basket correctly', async () => {
        // Basket
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        const backing = await facade.basketTokens(rToken.address)
        expect(backing[0]).to.equal(nUsdc.address)
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
        const issueAmount: BigNumber = bn('100e8')
        await nUsdc.connect(addr1).approve(rToken.address, issueAmount)
        expect(await rToken.connect(addr1).balanceOf(addr1.address)).to.equal(bn('0'))
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
        expect(await rToken.connect(addr1).balanceOf(addr1.address)).to.equal(issueAmount)
        expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
      })

      // Validate constructor arguments
      it('Should validate constructor arguments correctly', async () => {
        // Default threshold
        await expect(
          NTokenFiatCollateralFactory.deploy(
            fp('1'),
            networkConfig[chainId].chainlinkFeeds.USDC as string,
            nUsdc.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            delayUntilDefault,
            ethers.constants.AddressZero,
            defaultThreshold,
            100 // 1%
          )
        ).to.be.revertedWith('Notional proxy address missing')

        // Allowed refPerTok drop too high
        await expect(
          NTokenFiatCollateralFactory.deploy(
            fp('1'),
            networkConfig[chainId].chainlinkFeeds.USDC as string,
            nUsdc.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            delayUntilDefault,
            notionalProxy.address,
            defaultThreshold,
            10000 // 100%
          )
        ).to.be.revertedWith('Allowed refPerTok drop out of range')

        // Negative drop on refPerTok
        await expect(
          NTokenFiatCollateralFactory.deploy(
            fp('1'),
            networkConfig[chainId].chainlinkFeeds.USDC as string,
            nUsdc.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            delayUntilDefault,
            notionalProxy.address,
            defaultThreshold,
            -1 // negative value
          )
        ).to.be.reverted
      })
    })

    describe('Issuance/Appreciation/Redemption - drop period', () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

      // Issuance and redemption, making the collateral appreciate over time
      it('Should issue, redeem, and handle appreciation rates correctly', async () => {
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

        // Provide approvals for issuances
        await nUsdc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        // Store Balances after issuance
        const balanceAddr1nUsdc: BigNumber = await nUsdc.balanceOf(addr1.address)

        // Check rates and prices
        const nUsdcPrice1: BigNumber = await nUsdcCollateral.strictPrice() // ~ 0.022 cents
        const nUsdcRefPerTok1: BigNumber = await nUsdcCollateral.refPerTok() // ~ 0.022 cents

        expect(nUsdcPrice1).to.be.closeTo(fp('0.022'), fp('0.001'))
        expect(nUsdcRefPerTok1).to.be.closeTo(fp('0.022'), fp('0.001'))

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
        await nUsdcCollateral.refresh()
        expect(await nUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Check rates and prices - Have changed, slight increase
        const nUsdcPrice2: BigNumber = await nUsdcCollateral.strictPrice() // ~0.022
        const nUsdcRefPerTok2: BigNumber = await nUsdcCollateral.refPerTok() // ~0.022

        // Still close to the original values
        expect(nUsdcPrice2).to.be.closeTo(fp('0.022'), fp('0.001'))
        expect(nUsdcRefPerTok2).to.be.closeTo(fp('0.022'), fp('0.001'))

        // Check price is within the accepted range
        expect(nUsdcPrice2).to.be.gt(minimumValue(nUsdcPrice1, allowedDropBasisPoints))
        // Check the refPerTok is greater or equal than the previous one
        expect(nUsdcRefPerTok2).to.be.gte(nUsdcRefPerTok1)

        // Check total asset value did not drop more than the allowed margin
        const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue2).to.be.gte(minimumValue(totalAssetValue1, allowedDropBasisPoints))

        // Advance time and blocks slightly, causing refPerTok() to increase
        await advanceTime(100000000)
        await advanceBlocks(100000000)

        // Refresh cToken manually (required)
        await nUsdcCollateral.refresh()
        expect(await nUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Check rates and prices - Have changed significantly
        const nUsdcPrice3: BigNumber = await nUsdcCollateral.strictPrice() // ~0.03294
        const nUsdcRefPerTok3: BigNumber = await nUsdcCollateral.refPerTok() // ~0.03294

        // Need to adjust ranges
        expect(nUsdcPrice3).to.be.closeTo(fp('0.022'), fp('0.001'))
        expect(nUsdcRefPerTok3).to.be.closeTo(fp('0.022'), fp('0.001'))

        // Check price is within the accepted range
        expect(nUsdcPrice3).to.be.gt(minimumValue(nUsdcPrice2, allowedDropBasisPoints))
        // Check the refPerTok is greater or equal than the previous one
        expect(nUsdcRefPerTok3).to.be.gte(nUsdcRefPerTok2)

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
        const newBalanceAddr1nUsdc: BigNumber = await nUsdc.balanceOf(addr1.address)

        // Check received tokens represent ~10K in value at current prices
        expect(newBalanceAddr1nUsdc.sub(balanceAddr1nUsdc)).to.be.closeTo(bn(448430e8), bn(1e8)) // ~0.0223 * 449159 ~= 10K (100% of basket)

        // Check remainders in Backing Manager
        expect(await nUsdc.balanceOf(backingManager.address)).to.be.closeTo(bn(1), bn(1e8)) // ~= 0.0000000002 usd in value

        //  Check total asset value (remainder)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          fp('0.0000000002'), // ~= 0.0000000002 usd (from above)
          fp('0.00000000005')
        )
      })
    })

    // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
    // claiming calls throughout the protocol are handled correctly and do not revert.
    describe('Rewards', () => {
      it('Should be able to claim rewards (if applicable)', async () => {
        const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

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
        await nUsdc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        // Now we can claim rewards - check initial balance still 0
        expect(await noteToken.balanceOf(backingManager.address)).to.equal(0)

        // Advance Time
        await advanceTime(8000)

        // Claim rewards
        await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

        // Check rewards both in COMP and stkAAVE
        const rewardsNOTE1: BigNumber = await noteToken.balanceOf(backingManager.address)

        expect(rewardsNOTE1).to.be.gt(0)

        // Keep moving time
        await advanceTime(3600)

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
        await expect(nUsdcCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

        // Fallback price is returned
        const [isFallback, price] = await nUsdcCollateral.price(true)
        expect(isFallback).to.equal(true)
        expect(price).to.equal(fp('1'))

        // Refresh should mark status IFFY
        await nUsdcCollateral.refresh()
        expect(await nUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)

        /** No price instance */

        // nTokens Collateral with no price
        const nonPriceNUsdcCollateral = <NTokenFiatCollateral>(
          await NTokenFiatCollateralFactory.deploy(
            fp('1'),
            NO_PRICE_DATA_FEED,
            nUsdc.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            delayUntilDefault,
            notionalProxy.address,
            defaultThreshold,
            allowedDropBasisPoints
          )
        )

        // CTokens - Collateral with no price info should revert
        await expect(nonPriceNUsdcCollateral.strictPrice()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonPriceNUsdcCollateral.refresh()).to.be.reverted
        expect(await nonPriceNUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

        /** Invalid price instance */

        // Reverts with a feed with zero price
        const invalidPriceNUsdcCollateral = <NTokenFiatCollateral>(
          await NTokenFiatCollateralFactory.deploy(
            fp('1'),
            mockChainlinkFeed.address,
            nUsdc.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            delayUntilDefault,
            notionalProxy.address,
            defaultThreshold,
            allowedDropBasisPoints
          )
        )

        await setOraclePrice(invalidPriceNUsdcCollateral.address, bn(0))

        // Reverts with zero price
        await expect(invalidPriceNUsdcCollateral.strictPrice()).to.be.revertedWith(
          'PriceOutsideRange()'
        )

        // Refresh should mark status IFFY
        await invalidPriceNUsdcCollateral.refresh()
        expect(await invalidPriceNUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)
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
        const newNUsdcCollateral = <NTokenFiatCollateral>(
          await NTokenFiatCollateralFactory.deploy(
            fp('1'),
            mockChainlinkFeed.address,
            nUsdc.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            delayUntilDefault,
            notionalProxy.address,
            defaultThreshold,
            allowedDropBasisPoints
          )
        )

        // Check initial state
        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newNUsdcCollateral.whenDefault()).to.equal(MAX_UINT256)

        // Depeg one of the underlying tokens - Reducing price 20%
        await setOraclePrice(newNUsdcCollateral.address, bn('8e7')) // -20%

        // Force updates - Should update whenDefault and status
        await expect(newNUsdcCollateral.refresh())
          .to.emit(newNUsdcCollateral, 'DefaultStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)

        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
          delayUntilDefault
        )
        expect(await newNUsdcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

        // Move time forward past delayUntilDefault
        await advanceTime(Number(delayUntilDefault))
        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)

        // Nothing changes if attempt to refresh after default
        const prevWhenDefault: BigNumber = await newNUsdcCollateral.whenDefault()
        await expect(newNUsdcCollateral.refresh()).to.not.emit(
          newNUsdcCollateral,
          'DefaultStatusChanged'
        )
        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await newNUsdcCollateral.whenDefault()).to.equal(prevWhenDefault)
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
        const newNUsdcCollateral = <NTokenFiatCollateral>await NTokenFiatCollateralFactory.deploy(
          fp('1'),
          mockChainlinkFeed.address,
          nToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold,
          100 // 1%
        )

        // Initialize internal state of max redPerTok
        await newNUsdcCollateral.refresh()

        // Check initial state
        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newNUsdcCollateral.whenDefault()).to.equal(MAX_UINT256)

        // Decrease rate for nToken, will disable collateral immediately
        await nToken.setUnderlyingValue(fp('5e7'))

        // Force updates - Should update whenDefault and status for collateral
        await expect(newNUsdcCollateral.refresh())
          .to.emit(newNUsdcCollateral, 'DefaultStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.DISABLED)
        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
        expect(await newNUsdcCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
      })

      it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
        const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
          'InvalidMockV3Aggregator'
        )
        const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
          await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
        )

        const newNUsdcCollateral = <NTokenFiatCollateral>(
          await NTokenFiatCollateralFactory.deploy(
            fp('1'),
            invalidChainlinkFeed.address,
            nUsdc.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            delayUntilDefault,
            notionalProxy.address,
            defaultThreshold,
            allowedDropBasisPoints
          )
        )

        // Reverting with no reason
        await invalidChainlinkFeed.setSimplyRevert(true)
        await expect(newNUsdcCollateral.refresh()).to.be.revertedWith('')
        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Running out of gas (same error)
        await invalidChainlinkFeed.setSimplyRevert(false)
        await expect(newNUsdcCollateral.refresh()).to.be.revertedWith('')
        expect(await newNUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
      })
    })
  })

  describe.skip('Alternate period', () => {
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
      await setup(forkBlockNumber['notional-increasing-period'])
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

      initialBal = bn('2000000e18')

      // NOTE token
      noteToken = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.NOTE || '')
      )

      // nUSDC live token
      nUsdc = <NTokenERC20ProxyMock>(
        await ethers.getContractAt(
          'NTokenERC20ProxyMock',
          networkConfig[chainId].tokens.nUSDC || ''
        )
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

      // Deploy nUsdc collateral plugin
      NTokenFiatCollateralFactory = await ethers.getContractFactory('NTokenFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
      nUsdcCollateral = <NTokenFiatCollateral>(
        await NTokenFiatCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          nUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold,
          allowedDropBasisPoints
        )
      )

      // Setup balances of nUSDC for addr1 - Transfer from Mainnet holder
      initialBal = bn('2000000e18')
      await whileImpersonating(HOLDER_nUSDC, async (nUsdcSigner) => {
        await nUsdc.connect(nUsdcSigner).transfer(addr1.address, toBNDecimals(initialBal, 8))
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
        primaryBasket: [nUsdcCollateral.address],
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
      const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
        .main
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
    })

    describe('Issuance/Appreciation/Redemption - rise period', () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

      // Issuance and redemption, making the collateral appreciate over time
      it('Should issue, redeem, and handle appreciation rates correctly', async () => {
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

        // Provide approvals for issuances
        await nUsdc.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        // Store Balances after issuance
        const balanceAddr1nUsdc: BigNumber = await nUsdc.balanceOf(addr1.address)

        // Check rates and prices
        const nUsdcPrice1: BigNumber = await nUsdcCollateral.strictPrice() // ~ 0.022 cents
        const nUsdcRefPerTok1: BigNumber = await nUsdcCollateral.refPerTok() // ~ 0.022 cents

        console.log(nUsdcRefPerTok1)

        expect(nUsdcPrice1).to.be.closeTo(fp('0.022'), fp('0.001'))
        expect(nUsdcRefPerTok1).to.be.closeTo(fp('0.022'), fp('0.001'))

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
        await nUsdcCollateral.refresh()
        expect(await nUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Check rates and prices - Have changed, slight increase
        const nUsdcPrice2: BigNumber = await nUsdcCollateral.strictPrice() // ~0.022
        const nUsdcRefPerTok2: BigNumber = await nUsdcCollateral.refPerTok() // ~0.022

        console.log(nUsdcRefPerTok2)

        // Still close to the original values
        expect(nUsdcPrice2).to.be.closeTo(fp('0.022'), fp('0.001'))
        expect(nUsdcRefPerTok2).to.be.closeTo(fp('0.022'), fp('0.001'))

        // Check price is within the accepted range
        expect(nUsdcPrice2).to.be.gt(minimumValue(nUsdcPrice1, allowedDropBasisPoints))
        // Check the refPerTok is greater or equal than the previous one
        expect(nUsdcRefPerTok2).to.be.gte(nUsdcRefPerTok1)

        // Check total asset value did not drop more than the allowed margin
        const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue2).to.be.gte(minimumValue(totalAssetValue1, allowedDropBasisPoints))

        // Advance time and blocks slightly, causing refPerTok() to increase
        await advanceTime(100000000)
        await advanceBlocks(100000000)

        // Refresh cToken manually (required)
        await nUsdcCollateral.refresh()
        expect(await nUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Check rates and prices - Have changed significantly
        const nUsdcPrice3: BigNumber = await nUsdcCollateral.strictPrice() // ~0.03294
        const nUsdcRefPerTok3: BigNumber = await nUsdcCollateral.refPerTok() // ~0.03294

        console.log(nUsdcRefPerTok3)

        // Need to adjust ranges
        expect(nUsdcPrice3).to.be.closeTo(fp('0.029'), fp('0.001'))
        expect(nUsdcRefPerTok3).to.be.closeTo(fp('0.029'), fp('0.001'))

        // Check price is within the accepted range
        expect(nUsdcPrice3).to.be.gt(minimumValue(nUsdcPrice2, allowedDropBasisPoints))
        // Check the refPerTok is greater or equal than the previous one
        expect(nUsdcRefPerTok3).to.be.gte(nUsdcRefPerTok2)

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
        const newBalanceAddr1nUsdc: BigNumber = await nUsdc.balanceOf(addr1.address)

        // Check received tokens represent ~10K in value at current prices
        expect(newBalanceAddr1nUsdc.sub(balanceAddr1nUsdc)).to.be.closeTo(bn(338983e8), bn(1e8)) // ~0.0225 * 338851 ~= 10K (100% of basket)

        // Check remainders in Backing Manager
        expect(await nUsdc.balanceOf(backingManager.address)).to.be.closeTo(bn(111467e8), bn(1e8)) // ~= 3301.8 usd in value

        //  Check total asset value (remainder)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          fp('3322.0'), // ~= 3301.8 usd (from above)
          fp('0.5')
        )
      })
    })
  })
})

function minimumValue(amount: BigNumber, allowedDrop: number): BigNumber {
  const one = 10000
  return amount.mul(one - allowedDrop).div(one)
}

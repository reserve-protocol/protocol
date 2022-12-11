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
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import {
  Asset,
  RibbonEarnStEthCollateral,
  REarnStEthMock,
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

const MOCK = false

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderStEth = '0x41318419CFa25396b47A94896FfA2C77c6434040'
const holder_rEarn_stEth = '0xce5513474e077f5336cf1b33c1347fdd8d48ae8c'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`RibbonEarnStEthCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let stEth: ERC20Mock
  let rEARN_stEth: REarnStEthMock
  let rEarnStEthCollateral: RibbonEarnStEthCollateral
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
  const volatilityBuffer = fp('0.02') // 2%

  const ninteyEightPercent = (floatingPointNumber: string) => {
    return fp(floatingPointNumber).sub(fp(floatingPointNumber).div(ethers.BigNumber.from('50')))
  }

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let RibbonEarnCollateralFactory: ContractFactory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator
  let mockChainlinkFeedFallback: MockV3Aggregator
  let REarnMockFactory: ContractFactory
  let rEarnStEthMock: REarnStEthMock

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

    // Get required contracts for rEARN
    // stEth
    stEth = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.STETH || '')
    )

    // rEARN
    rEARN_stEth = <REarnStEthMock>(
      await ethers.getContractAt('REarnStEthMock', networkConfig[chainId].tokens.rEARN_STETH || '')
    )

    // rEARN_stEth Mock
    REarnMockFactory = await ethers.getContractFactory('REarnStEthMock')
    const symbol = await rEARN_stEth.symbol()
    rEarnStEthMock = <REarnStEthMock>(
      await REarnMockFactory.deploy(symbol + ' Token', symbol, stEth.address)
    )

    RibbonEarnCollateralFactory = await ethers.getContractFactory('RibbonEarnStEthCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    rEarnStEthCollateral = <RibbonEarnStEthCollateral>(
      await RibbonEarnCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.STETH as string,
        MOCK ? rEarnStEthMock.address : rEARN_stEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        delayUntilDefault,
        defaultThreshold,
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        volatilityBuffer
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // stEth
    initialBal = bn('500e18')
    await whileImpersonating(holderStEth, async (stEthSigner) => {
      await stEth.connect(stEthSigner).transfer(addr1.address, toBNDecimals(initialBal, 18))
    })

    // rEARN-stETH
    await whileImpersonating(holder_rEarn_stEth, async (rearnSigner) => {
      await rEARN_stEth.connect(rearnSigner).transfer(addr1.address, toBNDecimals(initialBal, 18))
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
      primaryBasket: [rEarnStEthCollateral.address],
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
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1260e8'))
    mockChainlinkFeedFallback = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, bn('1280e8'))
    )
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // rEARN-stEth (rEarnStEthCollateral)
      expect(await rEarnStEthCollateral.isCollateral()).to.equal(true)
      expect(await rEarnStEthCollateral.erc20()).to.equal(rEARN_stEth.address)
      expect(await stEth.decimals()).to.equal(18)
      expect(await rEARN_stEth.decimals()).to.equal(18)
      expect(await rEarnStEthCollateral.targetName()).to.equal(
        ethers.utils.formatBytes32String('ETH')
      )
      // Vault just launched so refPerTok is slightly lower than 1 - volatilityBuffer
      expect(await rEarnStEthCollateral.refPerTok()).to.be.closeTo(
        ninteyEightPercent('0.99'),
        fp('0.005')
      )
      expect(await rEarnStEthCollateral.targetPerRef()).to.equal(fp('1'))
      // current Eth price
      expect(await rEarnStEthCollateral.pricePerTarget()).to.be.closeTo(fp('1260'), fp('0.2'))
      expect(await rEarnStEthCollateral.prevReferencePrice()).to.equal(
        await rEarnStEthCollateral.refPerTok()
      )
      expect(await rEarnStEthCollateral.strictPrice()).to.be.closeTo(fp('1241'), fp('0.5')) // close to $1241 usd

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(rEARN_stEth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(rEarnStEthCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(rEarnStEthCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(rEARN_stEth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      // reports ~ 5% too high due to revenue hiding
      expect(price).to.be.closeTo(fp('1272'), fp('0.6'))

      // Check RToken price
      const issueAmount: BigNumber = bn('1e18')
      await rEARN_stEth.connect(addr1).approve(rToken.address, issueAmount.mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1272'), fp('0.6'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        RibbonEarnCollateralFactory.deploy(
          fp('1'), // not used
          networkConfig[chainId].chainlinkFeeds.STETH as string,
          rEARN_stEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          delayUntilDefault,
          bn(0),
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          volatilityBuffer
        )
      ).to.be.revertedWith('defaultThreshold zero')

      // FallbackPrice
      await expect(
        RibbonEarnCollateralFactory.deploy(
          fp('1'), // not used
          networkConfig[chainId].chainlinkFeeds.STETH as string,
          rEARN_stEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          delayUntilDefault,
          defaultThreshold,
          ZERO_ADDRESS,
          volatilityBuffer
        )
      ).to.be.revertedWith('missing fallback chainlink feed')

      // VolatilityBuffer
      await expect(
        RibbonEarnCollateralFactory.deploy(
          fp('1'), // not used
          networkConfig[chainId].chainlinkFeeds.STETH as string,
          rEARN_stEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          delayUntilDefault,
          defaultThreshold,
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          fp('0')
        )
      ).to.be.revertedWith('volatilityBuffer zero')
    })
  })

  // note: at the time of writing the vault just went live and there
  // are no earnings yet. We will therefore use rEarnStEthMock to
  // simulate appreciation. To make it work, the rToken has to be registered
  // with a collateral that points to our mock contract. We achieve this by
  // setting the variable MOCK=true. Note: this will cause other tests to fail.
  // there are two tests in this category, both need MOCK=true to pass.
  xdescribe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = fp('2')

    it('Should handle volatility correctly - mocked', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      await rEarnStEthMock.mint(addr1.address, fp('400'))

      // Provide approvals for issuances
      await rEarnStEthMock
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // we increas price per share to simulate appreciation
      await rEarnStEthMock.setPricePerShare(fp('1.1'))

      // Refresh Token manually (required)
      await rEarnStEthCollateral.refresh()
      expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // slight decrease in price but within volatilityBuffer should not
      // affect the collateral status
      await rEarnStEthMock.setPricePerShare(ninteyEightPercent('1.1'))

      // Refresh Token manually (required)
      await rEarnStEthCollateral.refresh()
      expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await rEarnStEthCollateral.highestObservedReferencePrice()).to.equal(fp('1.1'))
      expect(await rEarnStEthCollateral.prevReferencePrice()).to.equal(ninteyEightPercent('1.1'))

      // if we decrease price any further it will disable the collateral
      await rEarnStEthMock.setPricePerShare((await rEarnStEthMock.pricePerShare()).sub('1'))
      // Refresh Token manually (required)
      await rEarnStEthCollateral.refresh()
      expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly - mocked', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      await rEarnStEthMock.mint(addr1.address, fp('400'))

      // Provide approvals for issuances
      await rEarnStEthMock
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1rEARN: BigNumber = await rEarnStEthMock.balanceOf(addr1.address)

      // Check rates and prices
      const rEARNPrice1: BigNumber = await rEarnStEthCollateral.strictPrice() // ~1247
      const rEARNRefPerTok1: BigNumber = await rEarnStEthCollateral.refPerTok() // 0.98
      expect(rEARNPrice1).to.be.closeTo(fp('1247'), fp('0.5'))
      expect(rEARNRefPerTok1).to.equal(ninteyEightPercent('1'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )

      expect(totalAssetValue1).to.be.closeTo(fp('2545'), fp('0.04')) // approx 2545 in value

      // we increas price per share to simulate appreciation
      await rEarnStEthMock.setPricePerShare(fp('1.1'))

      // Refresh Token manually (required)
      await rEarnStEthCollateral.refresh()
      expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // // slight decrease in price but within volatilityBuffer should not
      // // affect the collateral status
      // await rEarnStEthMock.setPricePerShare(ninteyEightPercent('1.1'))

      // // Refresh Token manually (required)
      // await rEarnStEthCollateral.refresh()
      // expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // // slight decrease in price but within volatilityBuffer should not
      // // affect the collateral status
      // await rEarnStEthMock.setPricePerShare((await rEarnStEthMock.pricePerShare()).sub('1') )

      // // Refresh Token manually (required)
      // await rEarnStEthCollateral.refresh()
      // expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Check rates and prices - Have changed, slight inrease
      const rEARNPrice2: BigNumber = await rEarnStEthCollateral.strictPrice() // ~1371
      const rEARNRefPerTok2: BigNumber = await rEarnStEthCollateral.refPerTok() // 1.1 - 2%

      // Check rates and price increase
      expect(rEARNPrice2).to.be.gt(rEARNPrice1)
      expect(rEARNRefPerTok2).to.be.gt(rEARNRefPerTok1)

      // Still close to the original values
      expect(rEARNPrice2).to.be.closeTo(fp('1371'), fp('0.8'))
      expect(rEARNRefPerTok2).to.eq(ninteyEightPercent('1.1'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )

      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks significantly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      await rEarnStEthMock.setPricePerShare(fp('2.1'))

      // Refresh collateral manually (required)
      await rEarnStEthCollateral.refresh()
      expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const rEARNPrice3: BigNumber = await rEarnStEthCollateral.strictPrice() // ~2618
      const rEARNRefPerTok3: BigNumber = await rEarnStEthCollateral.refPerTok() // 2.1 - 2%

      // Check rates and price increase
      expect(rEARNPrice3).to.be.gt(rEARNPrice2)
      expect(rEARNRefPerTok3).to.be.gt(rEARNRefPerTok2)

      // Need to adjust ranges
      expect(rEARNPrice3).to.be.closeTo(fp('2618'), fp('0.9'))
      expect(rEARNRefPerTok3).to.eq(ninteyEightPercent('2.1'))

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

      // Check balances - Fewer rEARN tokens should have been sent to the user
      const newBalanceAddr1rEARN: BigNumber = await rEarnStEthMock.balanceOf(addr1.address)
      // ~ 2540 at current price
      expect(newBalanceAddr1rEARN.sub(balanceAddr1rEARN)).to.be.closeTo(fp('0.97'), fp('0.002'))

      // Check remainders in Backing Manager
      expect(await rEarnStEthMock.balanceOf(backingManager.address)).to.be.closeTo(
        fp('1.06'),
        fp('0.01')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('2799'), // ~= 2539 usd (from above)
        fp('0.6')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('2e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Provide approvals for issuances
      await rEARN_stEth
        .connect(addr1)
        .approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.not.emit(backingManager, 'RewardsClaimed')
      expect(await backingManager.claimRewards()).to.not.throw
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
    })
  })

  describe('Price Handling', () => {
    it('should handle stale price due to oracle timeout', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      await expect(rEarnStEthCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
      await expect(rEarnStEthCollateral.pricePerTarget()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await rEarnStEthCollateral.price(true)
      expect(isFallback).to.equal(true)

      expect(price).to.be.closeTo(fp('0.99'), fp('0.005'))

      // Refresh should mark status IFFY
      await rEarnStEthCollateral.refresh()
      expect(await rEarnStEthCollateral.status()).to.equal(CollateralStatus.IFFY)
    })

    it('Should handle invalid price', async () => {
      // Ribbon Earn Collateral with no price
      const nonpriceREarnCollateral: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>await (
        await ethers.getContractFactory('RibbonEarnStEthCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        NO_PRICE_DATA_FEED,
        rEARN_stEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        delayUntilDefault,
        defaultThreshold,
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        volatilityBuffer
      )

      // Ribbon Earn - Collateral with no price info should revert
      await expect(nonpriceREarnCollateral.strictPrice()).to.be.reverted

      // Fallback price feed should still be available
      await expect(nonpriceREarnCollateral.pricePerTarget()).to.not.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceREarnCollateral.refresh()).to.be.reverted

      expect(await nonpriceREarnCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Ribbon Earn Collateral with no fallbackprice
      const nonpriceREarnCollateral2: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>await (
        await ethers.getContractFactory('RibbonEarnStEthCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.STETH as string,
        rEARN_stEth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        delayUntilDefault,
        defaultThreshold,
        NO_PRICE_DATA_FEED,
        volatilityBuffer
      )

      // Ribbon Earn - strict price should not revert
      await expect(nonpriceREarnCollateral2.strictPrice()).to.not.be.reverted

      // pricePerTarget uses fallback price feed so it should revert
      await expect(nonpriceREarnCollateral2.pricePerTarget()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceREarnCollateral2.refresh()).to.be.reverted

      expect(await nonpriceREarnCollateral2.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceREarnCollateral: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>(
        await (
          await ethers.getContractFactory('RibbonEarnStEthCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          fp('1'),
          mockChainlinkFeed.address,
          rEARN_stEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          delayUntilDefault,
          defaultThreshold,
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          volatilityBuffer
        )
      )

      await setOraclePrice(invalidpriceREarnCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceREarnCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // pricePerTarget() not affected
      await expect(invalidpriceREarnCollateral.pricePerTarget()).to.not.be.reverted

      // Refresh should mark status IFFY
      await invalidpriceREarnCollateral.refresh()

      expect(await invalidpriceREarnCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Reverts with a fallback price feed with zero price
      const invalidpriceREarnCollateral2: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>(
        await (
          await ethers.getContractFactory('RibbonEarnStEthCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.STETH as string,
          rEARN_stEth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('ETH'),
          delayUntilDefault,
          defaultThreshold,
          mockChainlinkFeedFallback.address,
          volatilityBuffer
        )
      )

      // same as setOraclePrice() but for other fallback feed
      await mockChainlinkFeedFallback.updateAnswer(bn(0))

      // strictPrice() not affected
      await expect(invalidpriceREarnCollateral2.strictPrice()).to.not.be.reverted

      // pricePerTarget() should revert
      await expect(invalidpriceREarnCollateral2.pricePerTarget()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceREarnCollateral2.refresh()
      expect(await invalidpriceREarnCollateral2.status()).to.equal(CollateralStatus.IFFY)
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
      const newREarnCollateral: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>await (
        await ethers.getContractFactory('RibbonEarnStEthCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        await rEarnStEthCollateral.erc20(),
        await rEarnStEthCollateral.maxTradeVolume(),
        await rEarnStEthCollateral.oracleTimeout(),
        await rEarnStEthCollateral.targetName(),
        await rEarnStEthCollateral.delayUntilDefault(),
        await rEarnStEthCollateral.defaultThreshold(),
        await rEarnStEthCollateral.chainlinkFeedFallback(),
        await rEarnStEthCollateral.volatilityBuffer()
      )

      // Check initial state
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newREarnCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newREarnCollateral.address, bn('990e8')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newREarnCollateral.refresh())
        .to.emit(newREarnCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newREarnCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      const prevWhenDefault: BigNumber = await newREarnCollateral.whenDefault()
      await expect(newREarnCollateral.refresh()).to.not.emit(
        newREarnCollateral,
        'CollateralStatusChanged'
      )
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newREarnCollateral.whenDefault()).to.equal(prevWhenDefault)

      // similar for fallbackPrice feed
      // Redeploy plugin using a Chainlink mock feed for fallback price where we can change the price
      const newREarnCollateral2: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>await (
        await ethers.getContractFactory('RibbonEarnStEthCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await rEarnStEthCollateral.chainlinkFeed(),
        await rEarnStEthCollateral.erc20(),
        await rEarnStEthCollateral.maxTradeVolume(),
        await rEarnStEthCollateral.oracleTimeout(),
        await rEarnStEthCollateral.targetName(),
        await rEarnStEthCollateral.delayUntilDefault(),
        await rEarnStEthCollateral.defaultThreshold(),
        mockChainlinkFeedFallback.address,
        await rEarnStEthCollateral.volatilityBuffer()
      )

      // Check initial state
      expect(await newREarnCollateral2.status()).to.equal(CollateralStatus.SOUND)
      expect(await newREarnCollateral2.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      // same as setOraclePrice() but for fallback feed
      await mockChainlinkFeedFallback.updateAnswer(bn('990e8'))

      // Force updates - we don't expect status to change since we don't mind
      // our collateral apreciating against target
      await expect(newREarnCollateral2.refresh())
        .not.to.emit(newREarnCollateral2, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newREarnCollateral2.status()).to.equal(CollateralStatus.SOUND)

      expect(await newREarnCollateral2.whenDefault()).to.equal(MAX_UINT256)

      // Move time forward has no effect
      await advanceTime(Number(MAX_UINT256.sub(ethers.BigNumber.from('1'))))
      expect(await newREarnCollateral2.status()).to.equal(CollateralStatus.SOUND)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a REarnStEthMock to be able to change the rate
      // const REarnMockFactory: ContractFactory = await ethers.getContractFactory('REarnStEthMock')
      // const symbol = await rEARN_stEth.symbol()
      // const rEarnStEthMock: REarnStEthMock = <REarnStEthMock>(
      //   await REarnMockFactory.deploy(symbol + ' Token', symbol, stEth.address)
      // )

      // Redeploy plugin using the new REarnStEthMock mock
      const newREarnCollateral: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>await (
        await ethers.getContractFactory('RibbonEarnStEthCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        await rEarnStEthCollateral.chainlinkFeed(),
        rEarnStEthMock.address,
        await rEarnStEthCollateral.maxTradeVolume(),
        await rEarnStEthCollateral.oracleTimeout(),
        await rEarnStEthCollateral.targetName(),
        await rEarnStEthCollateral.delayUntilDefault(),
        await rEarnStEthCollateral.defaultThreshold(),
        await rEarnStEthCollateral.chainlinkFeedFallback(),
        await rEarnStEthCollateral.volatilityBuffer()
      )

      // Check initial state
      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newREarnCollateral.whenDefault()).to.equal(MAX_UINT256)
      await newREarnCollateral.refresh()
      expect(await newREarnCollateral.prevReferencePrice()).to.eq(ninteyEightPercent('1'))

      // Decrease price per share, will disable collateral immediately
      await rEarnStEthMock.setPricePerShare(ninteyEightPercent('1').sub('1'))

      // Force updates - Should update whenDefault and status
      await expect(newREarnCollateral.refresh())
        .to.emit(newREarnCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newREarnCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newREarnCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidREarnCollateral: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>(
        await RibbonEarnCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await rEarnStEthCollateral.erc20(),
          await rEarnStEthCollateral.maxTradeVolume(),
          await rEarnStEthCollateral.oracleTimeout(),
          await rEarnStEthCollateral.targetName(),
          await rEarnStEthCollateral.delayUntilDefault(),
          await rEarnStEthCollateral.defaultThreshold(),
          await rEarnStEthCollateral.chainlinkFeedFallback(),
          await rEarnStEthCollateral.volatilityBuffer()
        )
      )

      const invalidREarnCollateral2: RibbonEarnStEthCollateral = <RibbonEarnStEthCollateral>(
        await RibbonEarnCollateralFactory.deploy(
          fp('1'),
          await rEarnStEthCollateral.chainlinkFeed(),
          await rEarnStEthCollateral.erc20(),
          await rEarnStEthCollateral.maxTradeVolume(),
          await rEarnStEthCollateral.oracleTimeout(),
          await rEarnStEthCollateral.targetName(),
          await rEarnStEthCollateral.delayUntilDefault(),
          await rEarnStEthCollateral.defaultThreshold(),
          invalidChainlinkFeed.address,
          await rEarnStEthCollateral.volatilityBuffer()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidREarnCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidREarnCollateral.status()).to.equal(CollateralStatus.SOUND)
      await expect(invalidREarnCollateral2.refresh()).to.be.revertedWith('')
      expect(await invalidREarnCollateral2.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidREarnCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidREarnCollateral.status()).to.equal(CollateralStatus.SOUND)
      await expect(invalidREarnCollateral2.refresh()).to.be.revertedWith('')
      expect(await invalidREarnCollateral2.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

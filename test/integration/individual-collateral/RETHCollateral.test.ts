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
  CTokenFiatCollateral,
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
  RETHCollateral,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderRETH = '0xEADB3840596cabF312F2bC88A4Bb0b93A4E1FF5F'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`RETHCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let reth: ERC20Mock
  let rethCollateral: RETHCollateral
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

  const defaultAllowedDropBasisPoints = 50 // 500/10000 = 0.005 = 0.5%
  const delayUntilDefault = bn('86400') // 24h

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let RETHCollateralFactory: ContractFactory
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
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    // Get required contracts for reth
    // RETH token
    reth = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.rETH || '')
    )

    // Deploy rETH collateral plugin
    RETHCollateralFactory = await ethers.getContractFactory('RETHCollateral', {
      // libraries: { OracleLib: oracleLib.address },
    })
    rethCollateral = <RETHCollateral>(
      await RETHCollateralFactory.deploy(
        fp('0.02'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        reth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultAllowedDropBasisPoints,
        delayUntilDefault,
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // rETH 
    initialBal = bn('8000e18')
    await whileImpersonating(holderRETH, async (rethSigner) => {
      await reth.connect(rethSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [rethCollateral.address],
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
      // rETH (RETHCollateral)
      expect(await rethCollateral.isCollateral()).to.equal(true)
      expect(await rethCollateral.erc20()).to.equal(reth.address)
      expect(await reth.decimals()).to.equal(18)
      expect(await rethCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await rethCollateral.refPerTok()).to.be.closeTo(fp('1.080'), fp('1.000'))
      expect(await rethCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await rethCollateral.pricePerTarget()).to.be.closeTo(fp('1000'), fp('5000'))
      expect(await rethCollateral.maxRefPerTok()).to.equal(await rethCollateral.actualRefPerTok())
      // expect(await rethCollateral.refPerTok()).to.equal(await rethCollateral.maxRefPerTok().then(async (val) => val.mul(await rethCollateral.marginRatio()).div(10000)))
      expect(await rethCollateral.strictPrice()).to.be.closeTo(fp('1000'), fp('5000'))

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(reth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(rethCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(rethCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(reth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(fp('2000'), fp('1000'))

      // Check RToken price
      const issueAmount: BigNumber = bn('5000e18')
      await reth.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('2000'), fp('1000'))
    })

    // Validate constructor arguments
    // Note: Adapt it to your plugin constructor validations
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        RETHCollateralFactory.deploy(
          fp('0.02'),
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          reth.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          bn(10001),
          delayUntilDefault
        )
      ).to.be.revertedWith('Allowed refPerTok drop out of range')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('5000e18')

    // Issuance and redemption, making the collateral appreciate over time
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await reth.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1cDai: BigNumber = await reth.balanceOf(addr1.address)

      // Check rates and prices
      const rethPrice1: BigNumber = await rethCollateral.strictPrice() // reth in UoA
      const rethRefPerTok1: BigNumber = await rethCollateral.refPerTok() // reth in ref

      expect(rethPrice1).to.be.closeTo(fp('2000'), fp('1000'))
      expect(rethRefPerTok1).to.be.closeTo(fp('1.080'), fp('1.000'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount.mul('2000'), issueAmount.mul('1000')) // approx 10M in value

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const rethPrice2: BigNumber = await rethCollateral.strictPrice() // reth in UoA
      const rethRefPerTok2: BigNumber = await rethCollateral.refPerTok() // reth in ref

      // Check rates and price increase
      expect(rethPrice2).to.be.gt(rethPrice1)
      expect(rethRefPerTok2).to.be.gt(rethRefPerTok1)

      // Still close to the original values
      expect(rethPrice2).to.be.closeTo(fp('2000'), fp('1000'))
      expect(rethRefPerTok2).to.be.closeTo(fp('1.080'), fp('1.000'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks slightly, causing refPerTok() to increase
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh rethCollateral manually (required)
      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const rethPrice3: BigNumber = await rethCollateral.strictPrice() // reth in UoA
      const rethRefPerTok3: BigNumber = await rethCollateral.refPerTok() // reth in ref

      // Check rates and price increase
      expect(rethPrice3).to.be.gt(rethPrice2)
      expect(rethRefPerTok3).to.be.gt(rethRefPerTok2)

      // Need to adjust ranges
      expect(rethPrice3).to.be.closeTo(fp('2000'), fp('1000'))
      expect(rethRefPerTok3).to.be.closeTo(fp('1.080'), fp('1.000'))

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
      const newBalanceAddr1cDai: BigNumber = await reth.balanceOf(addr1.address)

      // Check received tokens represent ~10K in value at current prices
      expect(newBalanceAddr1cDai.sub(balanceAddr1cDai)).to.be.closeTo(bn('303570e8'), bn('8e7')) // ~0.03294 * 303571 ~= 10K (100% of basket)

      // Check remainders in Backing Manager
      expect(await reth.balanceOf(backingManager.address)).to.be.closeTo(bn(150663e8), bn('5e7')) // ~= 4962.8 usd in value

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
      const MIN_ISSUANCE_PER_BLOCK = bn('5000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Trying to claim should not revert
      await expect(backingManager.claimRewards()).to.not.reverted

      // Provide approvals for issuances
      await reth.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.not.reverted

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.not.reverted
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // Compound
      await expect(rethCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await rethCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('0.02'))

      // Refresh should mark status IFFY
      await rethCollateral.refresh()
      expect(await rethCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Reth Collateral with no price
      const nonpriceRethCollateral: RETHCollateral = <RETHCollateral>await (
        await ethers.getContractFactory('RETHCollateral', {
          // libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        NO_PRICE_DATA_FEED,
        reth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultAllowedDropBasisPoints,
        delayUntilDefault,
      )

      // CTokens - Collateral with no price info should revert
      await expect(nonpriceRethCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceRethCollateral.refresh()).to.be.reverted
      expect(await nonpriceRethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceRethCollateral: RETHCollateral = <RETHCollateral>await (
        await ethers.getContractFactory('RETHCollateral', {
          // libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        mockChainlinkFeed.address,
        reth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultAllowedDropBasisPoints,
        delayUntilDefault,
      )

      await setOraclePrice(invalidpriceRethCollateral.address, bn(0))

      // Reverts with zero price
      await expect(invalidpriceRethCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceRethCollateral.refresh()
      expect(await invalidpriceRethCollateral.status()).to.equal(CollateralStatus.IFFY)
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
      const newRethCollateral: RETHCollateral = <RETHCollateral>await (
        await ethers.getContractFactory('RETHCollateral', {
          // libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        mockChainlinkFeed.address,
        reth.address,
        await rethCollateral.maxTradeVolume(),
        await rethCollateral.oracleTimeout(),
        await rethCollateral.targetName(),
        10000 - await rethCollateral.marginRatio(),
        await rethCollateral.delayUntilDefault(),
      )

      // Check initial state
      expect(await newRethCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newRethCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePrice(newRethCollateral.address, bn('8e7')) // -20%

      // Force updates - Should update whenDefault and status
      await expect(newRethCollateral.refresh())
        .to.emit(newRethCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newRethCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newRethCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newRethCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // CToken
      const prevWhenDefault: BigNumber = await newRethCollateral.whenDefault()
      await expect(newRethCollateral.refresh()).to.not.emit(
        newRethCollateral,
        'CollateralStatusChanged'
      )
      expect(await newRethCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newRethCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a CToken mock to be able to change the rate

      // Redeploy plugin using the new cDai mock
      const newRethCollateral: RETHCollateral = <RETHCollateral>await (
        await ethers.getContractFactory('RETHCollateral', {
          // libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('0.02'),
        await rethCollateral.chainlinkFeed(),
        reth.address,
        await rethCollateral.maxTradeVolume(),
        await rethCollateral.oracleTimeout(),
        await rethCollateral.targetName(),
        10000 - await rethCollateral.marginRatio(),
        await rethCollateral.delayUntilDefault(),
      )

      // Check initial state
      expect(await newRethCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newRethCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Force updates - Should update whenDefault and status for Atokens/CTokens
      await expect(newRethCollateral.refresh())
        .to.emit(newRethCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newRethCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newRethCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
      )

      const invalidCTokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>(
        await RETHCollateralFactory.deploy(
          fp('0.02'),
          invalidChainlinkFeed.address,
          await rethCollateral.erc20(),
          await rethCollateral.maxTradeVolume(),
          await rethCollateral.oracleTimeout(),
          await rethCollateral.targetName(),
          10000 - await rethCollateral.marginRatio(),
          await rethCollateral.delayUntilDefault(),
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

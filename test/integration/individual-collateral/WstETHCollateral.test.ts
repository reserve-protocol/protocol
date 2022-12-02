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
  OracleLib,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  WstETHMock,
  WstETHCollateral,
  WstETHCollateral__factory,
} from '../../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const holder = '0x10cd5fbe1b404b7e19ef964b63939907bdaf42e2'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`WstETHCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let wstETH: WstETHMock
  let wstETHCollateral: WstETHCollateral

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

  let wstEthCollateralFactory: WstETHCollateral__factory
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

    // Setup required token contracts
    // wstETH token
    wstETH = <WstETHMock>(
      await ethers.getContractAt('WstETHMock', networkConfig[chainId].tokens.wstETH || '')
    )

    // Deploy wstETH collateral plugin
    wstEthCollateralFactory = await ethers.getContractFactory('WstETHCollateral', {})
    wstETHCollateral = <WstETHCollateral>(
      await wstEthCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.stETH as string,
        wstETH.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultThreshold,
        delayUntilDefault
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
      primaryBasket: [wstETHCollateral.address],
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

    initialBal = fp('10')
    await whileImpersonating(holder, async (signer) => {
      await wstETH.connect(signer).transfer(addr1.address, initialBal) // toBNDecimals(initialBal, 18))
    })
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      // WstETHCollateral
      expect(await wstETHCollateral.isCollateral()).to.equal(true)
      expect(await wstETHCollateral.erc20()).to.equal(wstETH.address)
      expect(await wstETH.decimals()).to.equal(18)
      expect(await wstETHCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
      expect(await wstETHCollateral.refPerTok()).to.be.closeTo(fp('1.07'), fp('0.1'))
      expect(await wstETHCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await wstETHCollateral.pricePerTarget()).to.equal(fp('1819.70237279')) // for pined block 14916729
      expect(await wstETHCollateral.prevReferencePrice()).to.be.closeTo(
        await wstETHCollateral.refPerTok(),
        fp('0.01')
      )
      expect(await wstETHCollateral.strictPrice()).to.be.closeTo(fp('1954'), fp('1'))
      expect(await wstETHCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      expect(await wstETHCollateral.defaultThreshold()).to.equal(defaultThreshold)
      expect(await wstETHCollateral.delayUntilDefault()).to.equal(delayUntilDefault)
      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(wstETH.address)
      expect(ERC20s.length).to.equal(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(wstETHCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(wstETHCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(wstETH.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const isFallback = (await basketHandler.price(true))[0]
      expect(isFallback).to.equal(false)

      // Check RToken price
      const issueAmount: BigNumber = bn('20')

      await wstETH.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1819'), fp('1'))
    })

    // describe('Issuance/Appreciation/Redemption', () => {
    //   const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    //   // Issuance and redemption, making the collateral appreciate over time
    //   it('Should issue, redeem, and handle appreciation rates correctly', async () => {
    //     const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

    //     // Provide approvals for issuances
    //     await wstETH.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

    //     // Issue rTokens
    //     await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

    //     // Check RTokens issued to user
    //     expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

    //     // Store Balances after issuance
    //     const balanceAddr1cbEth: BigNumber = await wstETH.balanceOf(addr1.address)

    //     // Check rates and prices
    //     const cbEthPrice1: BigNumber = await WstETHCollateral.strictPrice() // ~ 1859.17 USD
    //     const cbEthRefPerTok1: BigNumber = await WstETHCollateral.refPerTok() // ~ 1859.17 USD

    //     expect(cbEthPrice1).to.be.closeTo(fp('1859.17'), fp('100'))
    //     expect(cbEthRefPerTok1).to.be.gt(fp('1'))

    //     // Check total asset value
    //     const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
    //       rToken.address
    //     )
    //     expect(totalAssetValue1).to.be.closeTo(issueAmount.mul(1860), fp('10000')) // ~  approx 2000K in value

    //     // Advance time and blocks slightly, causing refPerTok() to increase
    //     await advanceTime(10000)
    //     await advanceBlocks(10000)

    //     // change exchange rate for this block
    //     const oracle = await wstETH.oracle()
    //     await whileImpersonating(oracle, async (oracle) => {
    //       await wstETH.connect(oracle).updateExchangeRate(fp('1.037'))
    //     })

    //     // Refresh WstETHCollateral manually (required)
    //     await WstETHCollateral.refresh()
    //     expect(await WstETHCollateral.status()).to.equal(CollateralStatus.SOUND)

    //     // Check rates and prices - Have changed, slight inrease
    //     const cbEthPrice2: BigNumber = await WstETHCollateral.strictPrice() // ~1.0354 cents
    //     const cbEthRefPerTok2: BigNumber = await WstETHCollateral.refPerTok() // ~1.0354 cents

    //     // Advance time and blocks by 30 days, causing loan to go into WARNING
    //     await advanceTime(2592000)
    //     await advanceBlocks(2592000)

    //     // Refresh cpToken manually (required)
    //     await WstETHCollateral.refresh()
    //     // expect(await WstETHCollateral.status()).to.equal(CollateralStatus.IFFY)

    //     // Check rates and increase
    //     expect(cbEthRefPerTok2).to.be.gt(cbEthRefPerTok1)

    //     // Still close to the original values
    //     expect(cbEthPrice2).to.be.closeTo(fp('1928.82'), fp('10')) // 1860 * 1.037 = 1928.82 USD ~ 2k
    //     expect(cbEthRefPerTok2).to.be.closeTo(fp('1.035'), fp('0.03'))

    //     // Check total asset value increased
    //     const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
    //       rToken.address
    //     )
    //     expect(totalAssetValue2).to.be.gt(totalAssetValue1)

    //     // Refresh cpToken - everything should be fine now
    //     await WstETHCollateral.refresh()
    //     expect(await WstETHCollateral.status()).to.equal(CollateralStatus.SOUND)

    //     // Redeem Rtokens with the updated rates
    //     await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

    //     // Check funds were transferred
    //     expect(await rToken.balanceOf(addr1.address)).to.equal(0)
    //     expect(await rToken.totalSupply()).to.equal(0)

    //     // Check balances - Fewer cpTokens should have been sent to the user
    //     const newBalanceAddr1cbEth: BigNumber = await wstETH.balanceOf(addr1.address)

    //     // Check received tokens represent ~10K in value at current prices
    //     expect(newBalanceAddr1cbEth.sub(balanceAddr1cbEth)).to.be.closeTo(fp('10000'), fp('1000')) // ~1.037 * 9.643 ~= 10K (100% of basket)

    //     // Check remainders in Backing Manager
    //     expect(await wstETH.balanceOf(backingManager.address)).to.be.closeTo(fp('320'), fp('1')) // ~=  320  ceth

    //     //  Check total asset value (remainder)
    //     expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
    //       fp('617222'), // ~= 320 eth * usd/eth * wstETH /eth = 617222 USD
    //       fp('1000')
    //     )
    //   })

    //   it('Should mark collateral as DISABLED if the wstETH excahngeRate decreases', async () => {
    //     await WstETHCollateral.refresh()
    //     expect(await WstETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    //     // Advance time by another 100 days, causing loan to go into DEFAULT

    //     // manualy update exchange rate to a lower value
    //     const oracle = await wstETH.oracle()
    //     await whileImpersonating(oracle, async (oracle) => {
    //       await wstETH.connect(oracle).updateExchangeRate(fp('1'))
    //     })
    //     await advanceTime(8640000)
    //     await advanceBlocks(8640000)

    //     await WstETHCollateral.refresh()
    //     expect(await WstETHCollateral.status()).to.equal(CollateralStatus.DISABLED)
    //   })
    // })

    // // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
    // // claiming calls throughout the protocol are handled correctly and do not revert.
    // describe('Rewards', () => {
    //   it('Should be able to claim rewards (if applicable)', async () => {
    //     // Only checking to see that claim call does not revert
    //     await expectEvents(backingManager.claimRewards(), [])
    //   })
    // })

    // describe('Price Handling', () => {
    //   it('Should handle invalid/stale Price', async () => {
    //     // Reverts with a feed with zero price
    //     const invalidpriceCbEthCollateral: WstETHCollateral = <WstETHCollateral>await (
    //       await ethers.getContractFactory('WstETHCollateral', {
    //         libraries: { OracleLib: oracleLib.address },
    //       })
    //     ).deploy(
    //       fp('1'),
    //       mockChainlinkFeed.address,
    //       wstETH.address,
    //       config.rTokenMaxTradeVolume,
    //       ORACLE_TIMEOUT,
    //       ethers.utils.formatBytes32String('ETH'),
    //       delayUntilDefault
    //     )
    //     await setOraclePrice(invalidpriceCbEthCollateral.address, bn(0))

    //     // Reverts with zero price
    //     await expect(invalidpriceCbEthCollateral.strictPrice()).to.be.revertedWith(
    //       'PriceOutsideRange()'
    //     )

    //     // Refresh should mark status IFFY
    //     await invalidpriceCbEthCollateral.refresh()
    //     expect(await invalidpriceCbEthCollateral.status()).to.equal(CollateralStatus.IFFY)

    //     // Reverts with stale price
    //     await advanceTime(ORACLE_TIMEOUT.toString())
    //     await expect(WstETHCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

    //     // Fallback price is returned
    //     const [isFallback, price] = await WstETHCollateral.price(true)
    //     expect(isFallback).to.equal(true)
    //     expect(price).to.equal(fp('1'))

    //     // Refresh should mark status DISABLED
    //     await WstETHCollateral.refresh()
    //     expect(await WstETHCollateral.status()).to.equal(CollateralStatus.IFFY)
    //     await advanceBlocks(100000)
    //     await WstETHCollateral.refresh()
    //     expect(await WstETHCollateral.status()).to.equal(CollateralStatus.DISABLED)

    //     const nonpriceCbEthCollateral: WstETHCollateral = <WstETHCollateral>await (
    //       await ethers.getContractFactory('WstETHCollateral', {
    //         libraries: { OracleLib: oracleLib.address },
    //       })
    //     ).deploy(
    //       fp('1'),
    //       NO_PRICE_DATA_FEED,
    //       wstETH.address,
    //       config.rTokenMaxTradeVolume,
    //       ORACLE_TIMEOUT,
    //       ethers.utils.formatBytes32String('ETH'),
    //       delayUntilDefault
    //     )

    //     // Collateral with no price info should revert
    //     await expect(nonpriceCbEthCollateral.strictPrice()).to.be.reverted

    //     expect(await nonpriceCbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
    //   })
    // })

    // // Note: Here the idea is to test all possible statuses and check all possible paths to default
    // // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
    // // hard default = SOUND -> DISABLED due to an invariant violation
    // // This may require to deploy some mocks to be able to force some of these situations
    // describe('Collateral Status', () => {
    //   // Test for soft default
    //   it.skip('No Updates status in case of soft default because there is no soft reset', async () => {
    //     // Redeploy plugin using a Chainlink mock feed where we can change the price
    //     const newcbEthCollateral: WstETHCollateral = <WstETHCollateral>await (
    //       await ethers.getContractFactory('WstETHCollateral', {
    //         libraries: { OracleLib: oracleLib.address },
    //       })
    //     ).deploy(
    //       fp('1'),
    //       mockChainlinkFeed.address,
    //       await WstETHCollateral.erc20(),
    //       await WstETHCollateral.maxTradeVolume(),
    //       await WstETHCollateral.oracleTimeout(),
    //       await WstETHCollateral.targetName(),
    //       await WstETHCollateral.delayUntilDefault()
    //     )

    //     // Check initial state
    //     expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
    //     expect(await newcbEthCollateral.whenDefault()).to.equal(MAX_UINT256)

    //     // Depeg one of the underlying tokens - Reducing price 20%
    //     await setOraclePrice(newcbEthCollateral.address, fp('8e7')) // -20%

    //     // Force updates - Should update whenDefault and status
    //     await expect(newcbEthCollateral.refresh())
    //       .to.emit(newcbEthCollateral, 'DefaultStatusChanged')
    //       .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
    //     expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.IFFY)

    //     const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
    //       delayUntilDefault
    //     )
    //     expect(await newcbEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

    //     // Move time forward past delayUntilDefault
    //     await advanceTime(Number(delayUntilDefault))
    //     expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)

    //     // Nothing changes if attempt to refresh after default
    //     const prevWhenDefault: BigNumber = await newcbEthCollateral.whenDefault()
    //     await expect(newcbEthCollateral.refresh()).to.not.emit(
    //       newcbEthCollateral,
    //       'DefaultStatusChanged'
    //     )
    //     expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
    //     expect(await newcbEthCollateral.whenDefault()).to.equal(prevWhenDefault)
    //   })

    //   // Test for hard default
    //   it('Updates status in case of hard default', async () => {
    //     // Note: In this case requires to use a wstETH mock to be able to change the rate
    //     // to hard default
    //     const cbEthOracle = (await ethers.getSigners())[3]
    //     const CbEthMockFactory = await ethers.getContractFactory('WstETHMock')
    //     const WstETHMock: WstETHMock = <WstETHMock>(
    //       await CbEthMockFactory.deploy(cbEthOracle.address, fp('1'))
    //     )
    //     // Set initial exchange rate to the new wstETH Mock
    //     await WstETHMock.connect(cbEthOracle).updateExchangeRate(fp('1.02'))

    //     // Redeploy plugin using the new wstETH mock
    //     const newcbEthCollateral: WstETHCollateral = <WstETHCollateral>await (
    //       await ethers.getContractFactory('WstETHCollateral', {
    //         libraries: { OracleLib: oracleLib.address },
    //       })
    //     ).deploy(
    //       fp('1'),
    //       await WstETHCollateral.chainlinkFeed(),
    //       WstETHMock.address,
    //       await WstETHCollateral.maxTradeVolume(),
    //       await WstETHCollateral.oracleTimeout(),
    //       await WstETHCollateral.targetName(),
    //       await WstETHCollateral.delayUntilDefault()
    //     )

    //     // Check initial state
    //     expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
    //     expect(await newcbEthCollateral.whenDefault()).to.equal(MAX_UINT256)

    //     // Decrease rate for wstETH, will disable collateral immediately
    //     await WstETHMock.connect(cbEthOracle).updateExchangeRate(fp('1.01'))

    //     // Force updates - Should update whenDefault and status
    //     await expect(newcbEthCollateral.refresh())
    //       .to.emit(newcbEthCollateral, 'DefaultStatusChanged')
    //       .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

    //     expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
    //     const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
    //     expect(await newcbEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    //   })

    //   it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
    //     const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
    //       'InvalidMockV3Aggregator'
    //     )
    //     const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
    //       await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
    //     )

    //     const invalidCbEthCollateral: WstETHCollateral = <WstETHCollateral>(
    //       await wstEthCollateralFactory.deploy(
    //         fp('1'),
    //         invalidChainlinkFeed.address,
    //         await WstETHCollateral.erc20(),
    //         await WstETHCollateral.maxTradeVolume(),
    //         await WstETHCollateral.oracleTimeout(),
    //         await WstETHCollateral.targetName(),
    //         await WstETHCollateral.delayUntilDefault()
    //       )
    //     )

    //     // Reverting with no reason
    //     await invalidChainlinkFeed.setSimplyRevert(true)
    //     await expect(invalidCbEthCollateral.refresh()).to.be.revertedWith('')
    //     expect(await invalidCbEthCollateral.status()).to.equal(CollateralStatus.SOUND)

    //     // Runnning out of gas (same error)
    //     await invalidChainlinkFeed.setSimplyRevert(false)
    //     await expect(invalidCbEthCollateral.refresh()).to.be.revertedWith('')
    //     expect(await invalidCbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
    //   })
    // })
  })
})

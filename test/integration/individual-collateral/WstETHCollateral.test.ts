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
  WstETHMock,
  WstETHCollateral,
  WstETHCollateral__factory,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const holder = '0x10cd5fbe1b404b7e19ef964b63939907bdaf42e2'

const describeFork = useEnv('FORK') ? describe : describe.skip

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
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, govParams } = await loadFixture(
      defaultFixture
    ))

    // Setup required token contracts
    // wstETH token
    wstETH = <WstETHMock>(
      await ethers.getContractAt('WstETHMock', networkConfig[chainId].tokens.WSTETH || '')
    )

    // Deploy wstETH collateral plugin
    wstEthCollateralFactory = await ethers.getContractFactory('WstETHCollateral')
    wstETHCollateral = <WstETHCollateral>(
      await wstEthCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        networkConfig[chainId].chainlinkFeeds.STETH as string,
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
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, bn('1800e18'))

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
      expect(await wstETHCollateral.pricePerTarget()).to.equal(fp('1859.17')) // for pined block 14916729
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

    describe('Issuance/Appreciation/Redemption', () => {
      const MIN_ISSUANCE_PER_BLOCK = bn('1e18')

      // Issuance and redemption, making the collateral appreciate over time
      it('Should issue, redeem, and handle appreciation rates correctly', async () => {
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

        // Provide approvals for issuances
        await wstETH.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        // Store Balances after issuance
        const balanceAddr1WstEth: BigNumber = await wstETH.balanceOf(addr1.address)

        // Check rates and prices
        const wstEthPrice1: BigNumber = await wstETHCollateral.strictPrice() // ~ 1954 USD
        const wstEthRefPerTok1: BigNumber = await wstETHCollateral.refPerTok() // ~ 1.07 USD

        expect(wstEthPrice1).to.be.closeTo(fp('1954'), fp('10'))
        expect(wstEthRefPerTok1).to.be.gt(fp('1'))

        // Check total asset value
        const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue1).to.be.closeTo(issueAmount.mul(1819), fp('100')) // ~  approx 2k in value

        // Advance time and blocks slightly, causing refPerTok() to increase
        await advanceTime(10_000)
        await advanceBlocks(10_000)

        // Refresh wstETHCollateral manually (required)
        await wstETHCollateral.refresh()
        expect(await wstETHCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Check rates and prices - They should be the same as before
        // Because oracle and stETH contract didn't change
        const wstEthRefPerTok2: BigNumber = await wstETHCollateral.refPerTok()
        const wstEthPrice2: BigNumber = await wstETHCollateral.strictPrice()

        // Check rates and price be same
        expect(wstEthPrice2).to.be.eq(wstEthPrice1)
        expect(wstEthRefPerTok2).to.be.eq(wstEthRefPerTok1)

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

        // Check balances - Fewer wstETH should have been sent to the user
        const newbalanceAddr1WstEth: BigNumber = await wstETH.balanceOf(addr1.address)

        // Check received tokens represent ~1K in value at current prices
        expect(newbalanceAddr1WstEth.sub(balanceAddr1WstEth)).to.be.closeTo(fp('1'), fp('0.1'))

        // Check remainders in Backing Manager
        expect(await wstETH.balanceOf(backingManager.address)).to.be.eq(fp('0'))

        //  Check total asset value (remainder)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.eq(fp('0'))
      })
    })

    //   it('Should mark collateral as DISABLED if the wstETH exchangeRate decreases', async () => {
    //     await wstETHCollateral.refresh()
    //     expect(await wstETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    //     // Advance time by another 100 days, causing loan to go into DEFAULT

    //     // manualy update exchange rate to a lower value
    //     const oracle = await wstETH.oracle()
    //     await whileImpersonating(oracle, async (oracle) => {
    //       await wstETH.connect(oracle).updateExchangeRate(fp('1'))
    //     })
    //     await advanceTime(8640000)
    //     await advanceBlocks(8640000)

    //     await wstETHCollateral.refresh()
    //     expect(await wstETHCollateral.status()).to.equal(CollateralStatus.DISABLED)
    //   })
    // })

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
        const invalidpriceCbEthCollateral: WstETHCollateral = <WstETHCollateral>(
          await (
            await ethers.getContractFactory('WstETHCollateral')
          ).deploy(
            fp('1'),
            mockChainlinkFeed.address,
            mockChainlinkFeed.address,
            wstETH.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('ETH'),
            defaultThreshold,
            delayUntilDefault
          )
        )
        await setOraclePrice(invalidpriceCbEthCollateral.address, bn(0))

        // Reverts with zero price
        await expect(invalidpriceCbEthCollateral.strictPrice()).to.be.revertedWith(
          'PriceOutsideRange()'
        )

        // Refresh should mark status IFFY
        await invalidpriceCbEthCollateral.refresh()
        expect(await invalidpriceCbEthCollateral.status()).to.equal(CollateralStatus.IFFY)

        // Reverts with stale price
        await advanceTime(ORACLE_TIMEOUT.toString())
        await expect(wstETHCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

        // Fallback price is returned
        const [isFallback, price] = await wstETHCollateral.price(true)
        expect(isFallback).to.equal(true)
        expect(price).to.equal(fp('1'))

        // Refresh should mark status DISABLED
        await wstETHCollateral.refresh()
        expect(await wstETHCollateral.status()).to.equal(CollateralStatus.IFFY)
        await advanceBlocks(delayUntilDefault.mul(60))
        await wstETHCollateral.refresh()
        expect(await wstETHCollateral.status()).to.equal(CollateralStatus.DISABLED)

        const nonpriceWstEthCollateral: WstETHCollateral = <WstETHCollateral>(
          await (
            await ethers.getContractFactory('WstETHCollateral')
          ).deploy(
            fp('1'),
            NO_PRICE_DATA_FEED,
            NO_PRICE_DATA_FEED,
            wstETH.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('ETH'),
            defaultThreshold,
            delayUntilDefault
          )
        )

        // Collateral with no price info should revert
        await expect(nonpriceWstEthCollateral.strictPrice()).to.be.reverted

        expect(await nonpriceWstEthCollateral.status()).to.equal(CollateralStatus.SOUND)
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
        const mockStETHChainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
          await MockV3AggregatorFactory.deploy(18, fp('2000')) // wstETH price ~= 2140 = 2000 * 1.07
        )

        const mockETHChainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
          await MockV3AggregatorFactory.deploy(18, fp('2000'))
        )

        const newWstEthCollateral: WstETHCollateral = <WstETHCollateral>(
          await (
            await ethers.getContractFactory('WstETHCollateral')
          ).deploy(
            fp('1'),
            mockETHChainlinkFeed.address,
            mockStETHChainlinkFeed.address,
            await wstETHCollateral.erc20(),
            await wstETHCollateral.maxTradeVolume(),
            await wstETHCollateral.oracleTimeout(),
            await wstETHCollateral.targetName(),
            await wstETHCollateral.defaultThreshold(),
            await wstETHCollateral.delayUntilDefault()
          )
        )

        // Check initial state
        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newWstEthCollateral.whenDefault()).to.equal(MAX_UINT256)

        // Reducing price of stETH less than 5%, should be sound
        const v3Aggregator = await ethers.getContractAt(
          'MockV3Aggregator',
          mockStETHChainlinkFeed.address
        )
        await v3Aggregator.updateAnswer(fp('1901')) // 2000 * 0.95 + 1

        await expect(newWstEthCollateral.refresh()).not.emit(
          newWstEthCollateral,
          'CollateralStatusChanged'
        )
        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newWstEthCollateral.whenDefault()).to.equal(MAX_UINT256)

        // Reducing price of stETH more than 5%, should be iffy
        await v3Aggregator.updateAnswer(fp('1899')) // 2000 * 0.95 - 1
        // Force updates - Should update whenDefault and status
        await expect(newWstEthCollateral.refresh())
          .to.emit(newWstEthCollateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)

        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.IFFY)

        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
          delayUntilDefault
        )
        expect(await newWstEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

        // Increasing price of stETH back to normal range, should be sound
        await v3Aggregator.updateAnswer(fp('2000'))
        // Force updates - Should update whenDefault and status
        await expect(newWstEthCollateral.refresh())
          .to.emit(newWstEthCollateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)

        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Reducing price of stETH more than 5%, should be iffy
        await v3Aggregator.updateAnswer(fp('1899')) // 2000 * 0.95 - 1
        await expect(newWstEthCollateral.refresh())
          .to.emit(newWstEthCollateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)

        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.IFFY)

        // Move time forward past delayUntilDefault
        await advanceTime(Number(delayUntilDefault))
        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.DISABLED)

        // Nothing changes if attempt to refresh after default
        const prevWhenDefault: BigNumber = await newWstEthCollateral.whenDefault()
        await expect(newWstEthCollateral.refresh()).to.not.emit(
          newWstEthCollateral,
          'CollateralStatusChanged'
        )
        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
        expect(await newWstEthCollateral.whenDefault()).to.equal(prevWhenDefault)
      })

      // Test for hard default
      it('Updates status in case of hard default', async () => {
        // Note: In this case requires to use a wstETH mock to be able to change the rate
        // to hard default
        const wstEthOracle = (await ethers.getSigners())[3]
        const WstEthMockFactory = await ethers.getContractFactory('WstETHMock')
        const wstETHMock: WstETHMock = <WstETHMock>await WstEthMockFactory.deploy()

        // Set initial exchange rate to the new wstETH Mock
        await wstETHMock.connect(wstEthOracle).setExchangeRate(fp('1'))

        // Redeploy plugin using the new wstETH mock
        const newWstEthCollateral: WstETHCollateral = <WstETHCollateral>(
          await (
            await ethers.getContractFactory('WstETHCollateral')
          ).deploy(
            fp('1'),
            await wstETHCollateral.chainlinkFeed(),
            await wstETHCollateral.chainlinkFeed(),
            wstETHMock.address,
            await wstETHCollateral.maxTradeVolume(),
            await wstETHCollateral.oracleTimeout(),
            await wstETHCollateral.targetName(),
            await wstETHCollateral.defaultThreshold(),
            await wstETHCollateral.delayUntilDefault()
          )
        )

        // Check initial state
        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await newWstEthCollateral.whenDefault()).to.equal(MAX_UINT256)

        // Decrease rate for wstETH, will disable collateral immediately
        await wstETHMock.connect(wstEthOracle).setExchangeRate(fp('0.9'))

        // Force updates - Should update whenDefault and status
        await expect(newWstEthCollateral.refresh())
          .to.emit(newWstEthCollateral, 'CollateralStatusChanged')
          .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

        expect(await newWstEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
        const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
        expect(await newWstEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
      })

      it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
        const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
          'InvalidMockV3Aggregator'
        )
        const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
          await InvalidMockV3AggregatorFactory.deploy(18, fp('1800'))
        )

        const invalidWstETHCollateral: WstETHCollateral = <WstETHCollateral>(
          await wstEthCollateralFactory.deploy(
            fp('1'),
            invalidChainlinkFeed.address,
            invalidChainlinkFeed.address,
            await wstETHCollateral.erc20(),
            await wstETHCollateral.maxTradeVolume(),
            await wstETHCollateral.oracleTimeout(),
            await wstETHCollateral.targetName(),
            await wstETHCollateral.defaultThreshold(),
            await wstETHCollateral.delayUntilDefault()
          )
        )

        // Reverting with no reason
        await invalidChainlinkFeed.setSimplyRevert(true)
        await expect(invalidWstETHCollateral.refresh()).to.be.revertedWith('')
        expect(await invalidWstETHCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Runnning out of gas (same error)
        await invalidChainlinkFeed.setSimplyRevert(false)
        await expect(invalidWstETHCollateral.refresh()).to.be.revertedWith('')
        expect(await invalidWstETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      })
    })
  })
})

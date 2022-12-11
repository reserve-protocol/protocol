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
import { advanceTime, getLatestBlockTimestamp } from '../../utils/time'
import { setOraclePrice } from '../../utils/oracles'
import {
  Asset,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FacadeWrite,
  IAssetRegistry,
  IBasketHandler,
  Isteth,
  Iwsteth,
  InvalidMockV3Aggregator,
  MockV3Aggregator,
  OracleLib,
  RTokenAsset,
  TestIBackingManager,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  WSTETHCollateral,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const lidoOracle = '0x442af784A788A5bd6F42A01Ebe9F287a871243fb'
const holderWSTETH = '0x10CD5fbe1b404B7E19Ef964B63939907bdaf42E2'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`WSTETHCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let steth: Isteth
  let wsteth: Iwsteth
  let wstethCollateral: WSTETHCollateral
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

  const defaultRelativeThreshold = fp('0.85') // 85%
  const delayUntilDefault = bn('86400') // 24h
  // values at block 14916729
  const initialWSTETHRate = fp('1.073989189138505489')
  const initialSTETH_ETHOracle = fp('0.9784915986004254')
  const initialEthPrice = fp('1859.17')
  const initialWSTETHPrice = initialSTETH_ETHOracle
    .mul(initialEthPrice)
    .mul(initialWSTETHRate)
    .div(fp('1'))
    .div(fp('1'))

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let wstethCollateralFactory: ContractFactory
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

    // Get lido contracts
    wsteth = <Iwsteth>(
      await ethers.getContractAt('Iwsteth', networkConfig[chainId].tokens.WSTETH || '')
    )
    steth = <Isteth>await ethers.getContractAt('Isteth', networkConfig[chainId].tokens.STETH || '')

    // Deploy WSTETH collateral plugin
    wstethCollateralFactory = await ethers.getContractFactory('WSTETHCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    wstethCollateral = <WSTETHCollateral>(
      await wstethCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        networkConfig[chainId].chainlinkFeeds.STETH as string,
        wsteth.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('ETH'),
        defaultRelativeThreshold,
        delayUntilDefault
      )
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // wsteth
    initialBal = fp('5000')
    await whileImpersonating(holderWSTETH, async (wstethSigner) => {
      await wsteth.connect(wstethSigner).transfer(addr1.address, initialBal)
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
      primaryBasket: [wstethCollateral.address],
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
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, initialEthPrice)
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // Check Collateral plugin
      // wsteth (WSTETHCollateral)
      expect(await wstethCollateral.isCollateral()).to.equal(true)
      expect(await wstethCollateral.erc20()).to.equal(wsteth.address)
      expect(await wstethCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
      expect(await wstethCollateral.refPerTok()).to.be.closeTo(initialWSTETHRate, bn('10'))
      expect(await wstethCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await wstethCollateral.pricePerTarget()).to.be.closeTo(initialEthPrice, fp('1'))
      expect(await wstethCollateral.prevReferencePrice()).to.equal(
        await wstethCollateral.refPerTok()
      )
      expect(await wstethCollateral.strictPrice()).to.be.closeTo(initialWSTETHPrice, fp('1'))
      expect(await wstethCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(wsteth.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(wstethCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(wstethCollateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(wsteth.address)
      expect(backing.length).to.equal(1)

      // Check other values
      expect(await basketHandler.nonce()).to.be.gt(bn(0))
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
      const [isFallback, price] = await basketHandler.price(true)
      expect(isFallback).to.equal(false)
      expect(price).to.be.closeTo(
        initialWSTETHPrice.mul(fp('1')).div(initialWSTETHRate),
        fp('0.01')
      )

      // Check RToken price
      const issueAmount: BigNumber = initialBal.div(initialEthPrice)
      await wsteth.connect(addr1).approve(rToken.address, issueAmount.mul(100))
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(
        initialWSTETHPrice.mul(fp('1')).div(initialWSTETHRate),
        fp('0.01')
      )
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    // Issuance and redemption, making the collateral appreciate over time
    it('modifying refPerTok', async () => {
      const issueAmount: BigNumber = fp('1000')

      // Provide approvals for issuances
      await wsteth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      const preBalanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Check rate
      const wstethRefPerTok1: BigNumber = await wstethCollateral.refPerTok() // 1.0739891891385054
      expect(wstethRefPerTok1).to.be.closeTo(initialWSTETHRate, fp('0.0001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(
        issueAmount.mul(initialWSTETHPrice.mul(fp('1')).div(initialWSTETHRate)).div(bn('1e18')),
        fp('10')
      )

      const [, beaconValidators, beaconBalance] = await steth.getBeaconStat()
      const beaconBalanceHigher: BigNumber = beaconBalance.add(fp('320'))
      const beaconBalanceHighest: BigNumber = beaconBalance.add(fp('32000'))

      // An oracle contract can update the lido validators beacon balance. By impersonating that oracle we can
      // manipulate the eth/steth ratio and exchange rate while using real steth contracts instead of resorting to mocks
      await whileImpersonating(lidoOracle, async (lidoSigner) => {
        await steth.connect(lidoSigner).handleOracleReport(beaconValidators, beaconBalanceHigher)
      })

      await wstethCollateral.refresh()
      expect(await wstethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rate Has changed, slight increase
      const wstethRefPerTok2: BigNumber = await wstethCollateral.refPerTok() // 1.0740625959146515

      // Check rate increase
      expect(wstethRefPerTok2).to.be.gt(wstethRefPerTok1)

      // Still close to the original value
      expect(wstethRefPerTok2).to.be.closeTo(wstethRefPerTok1, fp('0.02'))

      // increase wsteth to eth exchange rate significantly
      await whileImpersonating(lidoOracle, async (lidoSigner) => {
        await steth.connect(lidoSigner).handleOracleReport(beaconValidators, beaconBalanceHighest)
      })

      await wstethCollateral.refresh()
      expect(await wstethCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rate changed significantly
      const wstethRefPerTok3: BigNumber = await wstethCollateral.refPerTok() // 1.0813298115666956

      // Check rate
      expect(wstethRefPerTok3).to.be.gt(wstethRefPerTok2)

      // Need to adjust ranges
      expect(wstethRefPerTok3).to.be.closeTo(fp('1.081329811566695719'), fp('0.001'))

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - less wsteth should have been sent to the user
      const newBalanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Check received tokens represent same value deposited
      const input = preBalanceAddr1wsteth.sub(balanceAddr1wsteth)
      const valueIncrease = wstethRefPerTok3.mul(bn('1e18')).div(wstethRefPerTok1)
      const fairOut = input.mul(bn('1e18')).div(valueIncrease)
      expect(newBalanceAddr1wsteth.sub(balanceAddr1wsteth)).to.be.closeTo(fairOut, bn('8e7'))

      // Check remainders in Backing Manager
      expect(await wsteth.balanceOf(backingManager.address)).to.be.closeTo(
        input.sub(fairOut),
        bn('5e7')
      )
    })

    it('modifying eth/usd oracle', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newWSTETHCollateral: WSTETHCollateral = <WSTETHCollateral>await (
        await ethers.getContractFactory('WSTETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        mockChainlinkFeed.address,
        networkConfig[chainId].chainlinkFeeds.STETH as string,
        await wstethCollateral.erc20(),
        await wstethCollateral.maxTradeVolume(),
        await wstethCollateral.oracleTimeout(),
        await wstethCollateral.targetName(),
        await wstethCollateral.defaultRelativeThreshold(),
        await wstethCollateral.delayUntilDefault()
      )

      // After creating the new collateral with mocked oracle we use it in the facade so we can test totalAssetValue
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
        primaryBasket: [newWSTETHCollateral.address],
        weights: [fp('1')],
        backups: [],
        beneficiaries: [],
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

      // Check initial state
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newWSTETHCollateral.whenDefault()).to.equal(MAX_UINT256)

      const issueAmount: BigNumber = fp('1000')

      // Provide approvals for issuances
      await wsteth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      const preBalanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Check rates and prices
      const wstethPrice1: BigNumber = await newWSTETHCollateral.strictPrice() // 1953.7820431202576
      const wstethRefPerTok1: BigNumber = await newWSTETHCollateral.refPerTok() // 1.0739891891385054

      expect(wstethPrice1).to.be.closeTo(initialWSTETHPrice, fp('1'))
      expect(wstethRefPerTok1).to.be.closeTo(initialWSTETHRate, fp('0.0001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(
        issueAmount.mul(initialWSTETHPrice.mul(fp('1')).div(initialWSTETHRate)).div(bn('1e18')),
        fp('10')
      )

      // increase eth/usd oracle price
      await setOraclePrice(newWSTETHCollateral.address, fp('1877.7617')) // +1%

      await newWSTETHCollateral.refresh()
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const wstethPrice2: BigNumber = await newWSTETHCollateral.strictPrice() // 1973.3198635514602
      const wstethRefPerTok2: BigNumber = await newWSTETHCollateral.refPerTok() // 1.0739891891385054

      // Check rates and price increase
      expect(wstethPrice2).to.be.gt(wstethPrice1)
      expect(wstethRefPerTok2).to.be.eq(wstethRefPerTok1)

      // Still close to the original values
      expect(wstethPrice2).to.be.closeTo(wstethPrice1, fp('21'))
      expect(wstethRefPerTok2).to.be.closeTo(wstethRefPerTok1, fp('0.02'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // increase eth/usd oracle price significantly
      await setOraclePrice(newWSTETHCollateral.address, fp('2045.0870000000002')) // +10%

      await newWSTETHCollateral.refresh()
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const wstethPrice3: BigNumber = await newWSTETHCollateral.strictPrice() // 2149.1602474322835
      const wstethRefPerTok3: BigNumber = await newWSTETHCollateral.refPerTok() // 1.0739891891385054

      // Check rates and price increase
      expect(wstethPrice3).to.be.gt(wstethPrice2)
      expect(wstethRefPerTok3).to.be.eq(wstethRefPerTok2)

      // Need to adjust ranges
      expect(wstethPrice3).to.be.closeTo(fp('2149.160'), fp('0.001'))

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

      // Check balances - less wsteth should have been sent to the user
      const newBalanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Check received tokens represent same value deposited
      const input = preBalanceAddr1wsteth.sub(balanceAddr1wsteth)
      const valueIncrease = wstethRefPerTok3.mul(bn('1e18')).div(wstethRefPerTok1)
      const fairOut = input.mul(bn('1e18')).div(valueIncrease)
      expect(newBalanceAddr1wsteth.sub(balanceAddr1wsteth)).to.be.closeTo(fairOut, bn('8e7'))

      // Check remainders in Backing Manager
      expect(await wsteth.balanceOf(backingManager.address)).to.be.closeTo(
        input.sub(fairOut),
        bn('5e7')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        input.sub(fairOut).mul(wstethRefPerTok3).mul(initialEthPrice).div(bn('1e36')),
        fp('0.5')
      )
    })

    it('modifying eth/wsteth oracle', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the price
      const newWSTETHCollateral: WSTETHCollateral = <WSTETHCollateral>await (
        await ethers.getContractFactory('WSTETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        mockChainlinkFeed.address,
        await wstethCollateral.erc20(),
        await wstethCollateral.maxTradeVolume(),
        await wstethCollateral.oracleTimeout(),
        await wstethCollateral.targetName(),
        await wstethCollateral.defaultRelativeThreshold(),
        await wstethCollateral.delayUntilDefault()
      )

      // After creating the new collateral with mocked oracle we use it in the facade so we can test totalAssetValue
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
        primaryBasket: [newWSTETHCollateral.address],
        weights: [fp('1')],
        backups: [],
        beneficiaries: [],
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

      await mockChainlinkFeed.updateAnswer(fp('0.9784915986004254'))

      // Check initial state
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newWSTETHCollateral.whenDefault()).to.equal(MAX_UINT256)

      const issueAmount: BigNumber = fp('1000')

      // Provide approvals for issuances
      await wsteth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      const preBalanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Check rates and prices
      const wstethPrice1: BigNumber = await newWSTETHCollateral.strictPrice() // 1953.7820431202576
      const wstethRefPerTok1: BigNumber = await newWSTETHCollateral.refPerTok() // 1.0739891891385054

      expect(wstethPrice1).to.be.closeTo(initialWSTETHPrice, fp('1'))
      expect(wstethRefPerTok1).to.be.closeTo(initialWSTETHRate, fp('0.0001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(
        issueAmount.mul(initialWSTETHPrice.mul(fp('1')).div(initialWSTETHRate)).div(bn('1e18')),
        fp('10')
      )

      // increase eth/usd oracle price
      await mockChainlinkFeed.updateAnswer(fp('0.9882765145864297')) // +1%

      await newWSTETHCollateral.refresh()
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed, slight increase
      const wstethPrice2: BigNumber = await newWSTETHCollateral.strictPrice() // 1973.3198635514602
      const wstethRefPerTok2: BigNumber = await newWSTETHCollateral.refPerTok() // 1.0739891891385054

      // Check rates and price increase
      expect(wstethPrice2).to.be.gt(wstethPrice1)
      expect(wstethRefPerTok2).to.be.eq(wstethRefPerTok1)

      // Still close to the original values
      expect(wstethPrice2).to.be.closeTo(wstethPrice1, fp('21'))
      expect(wstethRefPerTok2).to.be.closeTo(wstethRefPerTok1, fp('0.02'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // increase eth/usd oracle price significantly
      await mockChainlinkFeed.updateAnswer(fp('1.076340758460468')) // +10%

      await newWSTETHCollateral.refresh()
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices - Have changed significantly
      const wstethPrice3: BigNumber = await newWSTETHCollateral.strictPrice() // 2149.1602474322835
      const wstethRefPerTok3: BigNumber = await newWSTETHCollateral.refPerTok() // 1.0739891891385054

      // Check rates and price increase
      expect(wstethPrice3).to.be.gt(wstethPrice2)
      expect(wstethRefPerTok3).to.be.eq(wstethRefPerTok2)

      // Need to adjust ranges
      expect(wstethPrice3).to.be.closeTo(fp('2149.160'), fp('0.01'))

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

      // Check balances - less wsteth should have been sent to the user
      const newBalanceAddr1wsteth: BigNumber = await wsteth.balanceOf(addr1.address)

      // Check received tokens represent same value deposited
      const input = preBalanceAddr1wsteth.sub(balanceAddr1wsteth)
      const valueIncrease = wstethRefPerTok3.mul(bn('1e18')).div(wstethRefPerTok1)
      const fairOut = input.mul(bn('1e18')).div(valueIncrease)
      expect(newBalanceAddr1wsteth.sub(balanceAddr1wsteth)).to.be.closeTo(fairOut, bn('8e7'))

      // Check remainders in Backing Manager
      expect(await wsteth.balanceOf(backingManager.address)).to.be.closeTo(
        input.sub(fairOut),
        bn('5e7')
      )

      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        input.sub(fairOut).mul(wstethRefPerTok3).mul(initialEthPrice).div(bn('1e36')),
        fp('0.5')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const issueAmount: BigNumber = fp('1000')

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: ['0x' + '00'.repeat(20), 0],
          emitted: true,
        },
      ])

      // Provide approvals for issuances
      await wsteth.connect(addr1).approve(rToken.address, issueAmount.mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      await expect(wstethCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await wstethCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await wstethCollateral.refresh()
      expect(await wstethCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Remaining iffy long enough should tranasition state to disabled
      await advanceTime(delayUntilDefault.add(bn('1')).toString())
      await wstethCollateral.refresh()
      expect(await wstethCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  describe('Collateral Status', () => {
    it('Updates status in case of soft default', async () => {
      // Redeploy plugin using a Chainlink mock eth/wsteth feed where we can change the price
      const newWSTETHCollateral: WSTETHCollateral = <WSTETHCollateral>await (
        await ethers.getContractFactory('WSTETHCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        mockChainlinkFeed.address,
        await wstethCollateral.erc20(),
        await wstethCollateral.maxTradeVolume(),
        await wstethCollateral.oracleTimeout(),
        await wstethCollateral.targetName(),
        await wstethCollateral.defaultRelativeThreshold(),
        await wstethCollateral.delayUntilDefault()
      )

      await mockChainlinkFeed.updateAnswer(fp('0.961218431'))

      // Check initial state
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newWSTETHCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Simulate market price of wsteth dropping to 70% of eth
      await mockChainlinkFeed.updateAnswer(fp('0.7'))

      // Force updates - Should update whenDefault and status
      await expect(newWSTETHCollateral.refresh())
        .to.emit(newWSTETHCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newWSTETHCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      const prevWhenDefault: BigNumber = await newWSTETHCollateral.whenDefault()
      await expect(newWSTETHCollateral.refresh()).to.not.emit(
        newWSTETHCollateral,
        'CollateralStatusChanged'
      )
      expect(await newWSTETHCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newWSTETHCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Check initial state
      await wstethCollateral.refresh()
      expect(await wstethCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await wstethCollateral.whenDefault()).to.equal(MAX_UINT256)

      // decrease wsteth to eth exchange rate so refPerTok decreases
      const [, beaconValidators, beaconBalance] = await steth.getBeaconStat()
      const beaconBalanceLower: BigNumber = beaconBalance.sub(fp('320'))
      await whileImpersonating(lidoOracle, async (lidoSigner) => {
        await steth.connect(lidoSigner).handleOracleReport(beaconValidators, beaconBalanceLower)
      })

      // Force updates
      await expect(wstethCollateral.refresh())
        .to.emit(wstethCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await wstethCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await wstethCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
    })

    it('Reverts if eth/usd oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1000e8'))
      )

      const invalidWSTETHCollateral: WSTETHCollateral = <WSTETHCollateral>(
        await wstethCollateralFactory.deploy(
          fp('1'),
          invalidChainlinkFeed.address,
          await wstethCollateral.ETH_STETHChainlinkFeed(),
          await wstethCollateral.erc20(),
          await wstethCollateral.maxTradeVolume(),
          await wstethCollateral.oracleTimeout(),
          await wstethCollateral.targetName(),
          await wstethCollateral.defaultRelativeThreshold(),
          await wstethCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidWSTETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidWSTETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    })

    it('Reverts if eth wsteth/eth oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(8, bn('1000e8'))
      )

      const invalidWSTETHCollateral: WSTETHCollateral = <WSTETHCollateral>(
        await wstethCollateralFactory.deploy(
          fp('1'),
          await wstethCollateral.USD_ETHChainlinkFeed(),
          invalidChainlinkFeed.address,
          await wstethCollateral.erc20(),
          await wstethCollateral.maxTradeVolume(),
          await wstethCollateral.oracleTimeout(),
          await wstethCollateral.targetName(),
          await wstethCollateral.defaultRelativeThreshold(),
          await wstethCollateral.delayUntilDefault()
        )
      )

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidWSTETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidWSTETHCollateral.refresh()).to.be.revertedWith('')
      expect(await invalidWSTETHCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

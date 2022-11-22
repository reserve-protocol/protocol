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
  ComptrollerMock,
  CTokenMock,
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
  NTokenCollateral,
  NTokenERC20ProxyMock,
} from '../../../typechain'
import { NotionalProxy } from '@typechain/NotionalProxy'

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = process.env.FORK ? describe : describe.skip

const HOLDER_nUSDC = '0x02479bfc7dce53a02e26fe7baea45a0852cb0909'

describeFork(`NTokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let notionalProxy: NotionalProxy
  let nUsdc: NTokenERC20ProxyMock
  let nUsdcCollateral: NTokenCollateral
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

  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let NTokenCollateralFactory: ContractFactory
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

    initialBal = bn('2000000e18')

    // NOTE token
    noteToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.NOTE || '')
    )

    // nUSDC live token
    nUsdc = <NTokenERC20ProxyMock>(
      await ethers.getContractAt('NTokenERC20ProxyMock', networkConfig[chainId].tokens.nUSDC || '')
    )

    // Notional Proxy
    notionalProxy = <NotionalProxy>(
      await ethers.getContractAt('NotionalProxyMock', networkConfig[chainId].NOTIONAL_PROXY || '')
    )

    // Create NOTE asset
    noteAsset = <Asset>await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.COMP || '', // ???
      noteToken.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT
    )

    // Deploy nUsdc collateral plugin
    NTokenCollateralFactory = await ethers.getContractFactory('NTokenCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    nUsdcCollateral = <NTokenCollateral>await NTokenCollateralFactory.deploy(
      fp('1'),
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      nUsdc.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      delayUntilDefault,
      notionalProxy.address,
      defaultThreshold,
      fp('0.01') // 1%
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
      expect(await noteAsset.strictPrice()).to.be.closeTo(fp('58'), fp('0.5')) // TODO : change when price feed
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
        NTokenCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          nUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          ethers.constants.AddressZero,
          defaultThreshold,
          fp('0.01') // 1%
        )
      ).to.be.revertedWith('Notional proxy address missing')

      // Allowed refPerTok drop too high
      await expect(
        NTokenCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          nUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold,
          fp('1') // 100%
        )
      ).to.be.revertedWith('Allowed refPerTok drop out of range')

      // Negative drop on refPerTok
      await expect(
        NTokenCollateralFactory.deploy(
          fp('1'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          nUsdc.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          delayUntilDefault,
          notionalProxy.address,
          defaultThreshold,
          fp('-0.01') // negative value
        )
      ).to.be.reverted
    })
  })
})

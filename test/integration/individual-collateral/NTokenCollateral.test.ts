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

describeFork(`NTokenFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let notionalProxy: NotionalProxy
  let nUsdcMock: NTokenERC20ProxyMock
  let nUsdcLive: NTokenERC20ProxyMock
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

    // NOTE token
    noteToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.NOTE || '')
    )

    // nUSDC mock token
    nUsdcMock = <NTokenERC20ProxyMock>(
      await (await ethers.getContractFactory('NTokenERC20ProxyMock')).deploy('nUSDCMock', 'NMOCK')
    )
    await nUsdcMock.mint(addr1.address, '1')

    // nUSDC live token
    nUsdcLive = <NTokenERC20ProxyMock>(
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
    nUsdcCollateral = <NTokenCollateral>(
      await NTokenCollateralFactory.deploy(
        fp('1'),
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        nUsdcMock.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        delayUntilDefault,
        notionalProxy.address,
        defaultThreshold
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
      await nUsdcMock.setUnderlyingValue('1')

      // Check Rewards asset NOTE
      expect(await noteAsset.isCollateral()).to.equal(false)
      expect(await noteAsset.erc20()).to.equal(noteToken.address)
      expect(await noteAsset.erc20()).to.equal(networkConfig[chainId].tokens.NOTE)
      expect(await noteToken.decimals()).to.equal(8)
      expect(await noteAsset.strictPrice()).to.be.closeTo(fp('58'), fp('0.5')) // Close to $58 USD - June 2022
      await expect(noteAsset.claimRewards()).to.not.emit(noteAsset, 'RewardsClaimed')
      expect(await noteAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check nUSDC Collateral plugin
      expect(await nUsdcCollateral.isCollateral()).to.equal(true)
      expect(await nUsdcCollateral.erc20Decimals()).to.equal(await nUsdcMock.decimals())
      expect(await nUsdcCollateral.erc20()).to.equal(nUsdcMock.address)
      expect(await nUsdcMock.decimals()).to.equal(await nUsdcLive.decimals())
      expect(await nUsdcCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await nUsdcCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await nUsdcCollateral.pricePerTarget()).to.equal(fp('1'))
      expect(await nUsdcCollateral.refPerTok()).to.equal(fp('1'))
      expect(await nUsdcCollateral.strictPrice()).to.be.closeTo(fp('1'), fp('0.05')) // close to $1
      expect(await nUsdcCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check claim data
      await expect(nUsdcCollateral.claimRewards())
        .to.emit(nUsdcCollateral, 'RewardsClaimed')
        .withArgs(noteToken.address, 0)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })
  })
})

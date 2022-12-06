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
import { setOraclePriceUniV2 } from '../../utils/oracles'
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
  UniV2Collateral,
  UniswapV2MockFactory,
  UniswapV2MockRouter02,
  UniswapV2MockPair,
  UniV2Collateral__factory,
  UniV2Asset,
  InvalidPairMock,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderDAI = '0x16B34Ce9A6a6F7FC2DD25Ba59bf7308E7B38E186'
const holderUSDC = '0xAe2D4617c862309A3d75A0fFB358c7a5009c673F'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`UniswapV2Collateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress

  // Tokens/Assets
  let dai: ERC20Mock //dai for tokenA
  let usdc: ERC20Mock //usdc for tokenB
  let UniV2Asset: UniV2Asset
  let UniV2PairMock: UniswapV2MockPair
  let UniV2RouterMock: UniswapV2MockRouter02
  let UniV2FactoryMock: UniswapV2MockFactory
  let UniV2Collateral: UniV2Collateral
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
    minTradeVolume: fp('1e3'), // $1k
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

  let initialBalDai: BigNumber
  let initialBalUsdc: BigNumber
  let stakedDai: BigNumber
  let stakedDaiLow: BigNumber
  let stakedUsdc: BigNumber
  let stakedUsdcLow: BigNumber
  let initialLPs: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let UniV2CollateralFactory: UniV2Collateral__factory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeedA: MockV3Aggregator
  let mockChainlinkFeedB: MockV3Aggregator

  let InvalidPairV2: InvalidPairMock

  before(async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, addr3] = await ethers.getSigners()
    ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
      await loadFixture(defaultFixture))

    dai = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI || '')
    )

    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )

    // Get UniV2 Factory
    UniV2FactoryMock = await ethers.getContractAt(
      'UniswapV2MockFactory',
      networkConfig[chainId].UNISWAP_V2_FACTORY || ''
    )

    // Get pair for DAI/USDC
    const pairAddress = await UniV2FactoryMock.getPair(dai.address, usdc.address)
    UniV2PairMock = await ethers.getContractAt('UniswapV2MockPair', pairAddress)
    // Get UniV2 Router02 contract
    UniV2RouterMock = await ethers.getContractAt(
      'UniswapV2MockRouter02',
      networkConfig[chainId].UNISWAP_V2_ROUTE02 || ''
    )

    //Get asset
    UniV2Asset = await (
      await ethers.getContractFactory('UniV2Asset')
    ).deploy(
      UniV2PairMock.address,
      UniV2RouterMock.address,
      fp('2'),
      config.rTokenMaxTradeVolume,
      delayUntilDefault,
      networkConfig[chainId].chainlinkFeeds.DAI as string,
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      ORACLE_TIMEOUT
    )
    // Get Collateral
    UniV2CollateralFactory = await ethers.getContractFactory('UniV2Collateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    UniV2Collateral = await UniV2CollateralFactory.deploy(
      UniV2PairMock.address,
      UniV2RouterMock.address,
      fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
      config.rTokenMaxTradeVolume,
      delayUntilDefault,
      networkConfig[chainId].chainlinkFeeds.DAI as string,
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      fp('1'),
      fp('1'),
      defaultThreshold,
      ORACLE_TIMEOUT
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    // DAI and USDC
    initialBalDai = fp('2e6') // 2M DAI
    await whileImpersonating(holderDAI, async (daiSigner) => {
      await dai.connect(daiSigner).transfer(addr1.address, initialBalDai)
    })

    initialBalUsdc = bn('2e12') // 2M Usdc
    await whileImpersonating(holderUSDC, async (daiSigner) => {
      await usdc.connect(daiSigner).transfer(addr1.address, initialBalUsdc)
    })
    const deadLine = Date.now() + 24 * 3600
    stakedDai = fp('2e6')
    stakedDaiLow = fp('1.99e6')
    stakedUsdc = bn('2e12')
    stakedUsdcLow = bn('1.99e12')
    // aprove router02
    await dai.connect(addr1).approve(UniV2RouterMock.address, initialBalDai)
    await usdc.connect(addr1).approve(UniV2RouterMock.address, initialBalUsdc)
    // add liquidity
    await UniV2RouterMock.connect(addr1).addLiquidity(
      dai.address,
      usdc.address,
      stakedDai,
      stakedUsdc,
      stakedDaiLow,
      stakedUsdcLow,
      addr1.address,
      bn(deadLine)
    )

    initialLPs = await UniV2PairMock.balanceOf(addr1.address)

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [], //[UniV2Asset.address],
      primaryBasket: [UniV2Collateral.address],
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
    mockChainlinkFeedA = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, bn('1e18'))
    mockChainlinkFeedB = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))

    // SetUp Mock pairV2 for some tests
    InvalidPairV2 = await (
      await ethers.getContractFactory('InvalidPairMock')
    ).deploy(dai.address, usdc.address)
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // check addr1 balance
      expect(await dai.balanceOf(addr1.address)).to.closeTo(
        initialBalDai.sub(stakedDai),
        stakedDai.div(bn('10'))
      ) // delta = 10%
      expect(await usdc.balanceOf(addr1.address)).to.closeTo(
        initialBalUsdc.sub(stakedUsdc),
        stakedUsdc.div(bn('10'))
      ) // delta = 10%
      expect(await UniV2PairMock.balanceOf(addr1.address)).to.equal(initialLPs)

      // Check UNIV2 Asset
      expect(await UniV2Asset.isCollateral()).to.equal(false)
      expect(await UniV2Asset.erc20()).to.equal(UniV2PairMock.address)
      expect((await UniV2Asset.erc20()).toLowerCase()).to.equal(
        networkConfig[chainId].tokens.UNIV2_DAI_USDC
      )
      expect(await UniV2PairMock.decimals()).to.equal(18)
      expect(await UniV2Asset.strictPrice()).to.be.closeTo(fp('2251989'), fp('0.5')) // Close to $2251989 USD per LPs- June 2022
      await expect(UniV2Asset.claimRewards()).to.not.emit(UniV2Asset, 'RewardsClaimed')
      expect(await UniV2Asset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check Collateral plugin
      // UniV2Collateral
      expect(await UniV2Collateral.isCollateral()).to.equal(true)
      expect(await UniV2Collateral.erc20()).to.equal(UniV2PairMock.address)
      expect(await UniV2PairMock.decimals()).to.equal(18)
      expect(await UniV2Collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(await UniV2Collateral.refPerTok()).to.closeTo(fp('1125769'), fp('0.5')) // june 2022 ~1125769,3
      expect(await UniV2Collateral.targetPerRef()).to.equal(fp('2')) // 2 sqrt(1e18 * 1e18) dai and usdc pegged to 1USD
      expect(await UniV2Collateral.pricePerTarget()).to.equal(fp('1'))
      expect(await UniV2Collateral.prevReferencePrice()).to.equal(await UniV2Collateral.refPerTok())
      expect(await UniV2Collateral.strictPrice()).to.be.closeTo(fp('2251989'), fp('1')) // same as asset Close to $2251989 USD per LPs- June 2022

      // Check claim data
      await expect(UniV2Collateral.claimRewards())
        .to.emit(UniV2Collateral, 'RewardsClaimed')
        .withArgs(UniV2PairMock.address, 0)
      expect(await UniV2Collateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Should setup contracts
      expect(main.address).to.not.equal(ZERO_ADDRESS)
    })

    // Check assets/collaterals in the Asset Registry
    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(UniV2PairMock.address)
      expect(ERC20s.length).to.eql(3)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(UniV2Collateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(UniV2Collateral.address)
    })

    // Check RToken basket
    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(UniV2PairMock.address)
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
      const issueAmount: BigNumber = fp('2000')
      await UniV2PairMock.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    // Validate constructor arguments
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          UniV2RouterMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          bn('0'),
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith(`[UNIV2COL DEPLOY ERROR]: defaultThreshold zero`)

      await expect(
        UniV2CollateralFactory.deploy(
          ZERO_ADDRESS,
          UniV2RouterMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: missing PairV2')

      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          ZERO_ADDRESS,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: missing router')

      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          UniV2RouterMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          ZERO_ADDRESS,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: missing chainlink feed for token A')

      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          UniV2RouterMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          ZERO_ADDRESS,
          fp('1'),
          fp('1'),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: missing chainlink feed for token B')

      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          UniV2RouterMock.address,
          fp('2'),
          bn('0'),
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: invalid max trade volume')

      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          UniV2RouterMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          bn('0'),
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: delayUntilDefault zero')

      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          UniV2RouterMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          defaultThreshold,
          bn('0')
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: oracleTimeout zero')

      await expect(
        UniV2CollateralFactory.deploy(
          UniV2PairMock.address,
          UniV2RouterMock.address,
          bn('0'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.DAI as string,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          fp('1'),
          fp('1'),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: fallback price zero')
    })
  })

  describe('Issuance/Appreciation/Redemption', () => {
    const MIN_ISSUANCE_PER_BLOCK = fp('1e4')

    // Issuance and redemption, making the collateral appreciate over trasactions
    it('Should issue, redeem, and handle appreciation rates correctly', async () => {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

      // Provide approvals for issuances
      await UniV2PairMock.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      // await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      await expect(await rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Store Balances after issuance
      const balanceAddr1LPs: BigNumber = await UniV2PairMock.balanceOf(addr1.address)

      // Check rates and prices
      const UniV2Price1: BigNumber = await UniV2Collateral.strictPrice()
      const UniV2RefPerTok1: BigNumber = await UniV2Collateral.refPerTok()

      expect(UniV2Price1).to.be.closeTo(fp('2251988'), fp('1')) // ~2251988 USD per LP 6/6/2022
      expect(UniV2RefPerTok1).to.closeTo(fp('1125769'), fp('0.5')) // refPertok initial ~ 1125769.30 6/6/2022

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('5')) // approx 10K in value

      await advanceTime(10000)
      await advanceBlocks(10000)

      // make some small DAI->USDC swap causing refPerTok() to increase
      // Setup balances for addr2 - Transfer from Mainnet holder
      // DAI and USDC then make some swaps
      const initialUserDai = fp('10000') // 10000 DAI
      const amountOutMinUsdc = bn('9950e6') // Usdc is 6 decimals
      const deadLine = Date.now() + 24 * 3600
      expect(await dai.balanceOf(addr2.address)).to.equal(fp('0'))
      await whileImpersonating(holderDAI, async (daiSigner) => {
        await dai.connect(daiSigner).transfer(addr2.address, initialUserDai)
      })

      expect(await dai.balanceOf(addr2.address)).to.equal(initialUserDai)
      await dai.connect(addr2).approve(UniV2RouterMock.address, initialUserDai)
      await UniV2RouterMock.connect(addr2).swapExactTokensForTokens(
        initialUserDai,
        amountOutMinUsdc,
        [dai.address, usdc.address],
        addr2.address,
        deadLine
      )

      expect(await dai.balanceOf(addr2.address)).to.equal(fp('0'))
      expect(await usdc.balanceOf(addr2.address)).to.closeTo(bn('10000e6'), bn('50e6')) // close to 10000 Usdc

      await UniV2Collateral.refresh()
      expect(await UniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices
      const UniV2Price2: BigNumber = await UniV2Collateral.strictPrice()
      const UniV2RefPerTok2: BigNumber = await UniV2Collateral.refPerTok()

      // Check rates and price increase
      expect(UniV2Price2).to.be.gt(UniV2Price1)
      expect(UniV2RefPerTok2).to.be.gt(UniV2RefPerTok1)

      // Still close to the original values
      expect(UniV2Price2).to.be.closeTo(fp('2251988'), fp('2'))
      expect(UniV2RefPerTok2).to.closeTo(fp('1125769'), fp('1'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // make some huge USDC-> DAI swap causing refPerTok() to increase
      // Setup balances for addr3 - Transfer from Mainnet holder
      // DAI and USDC then make some swap
      const initialUserUsdc = bn('1000000e6') // 1.000.000 Usdc (6 decimals)
      const amountOutMinDai = fp('900000') // 9950 Dai min (18 decimals)
      expect(await usdc.balanceOf(addr3.address)).to.equal(bn('0'))
      await whileImpersonating(holderUSDC, async (usdcSigner) => {
        await usdc.connect(usdcSigner).transfer(addr3.address, initialUserUsdc)
      })

      expect(await usdc.balanceOf(addr3.address)).to.equal(initialUserUsdc)
      await usdc.connect(addr3).approve(UniV2RouterMock.address, initialUserUsdc)
      await UniV2RouterMock.connect(addr3).swapExactTokensForTokens(
        initialUserUsdc,
        amountOutMinDai,
        [usdc.address, dai.address],
        addr3.address,
        deadLine
      )

      expect(await usdc.balanceOf(addr3.address)).to.equal(fp('0'))
      expect(await dai.balanceOf(addr3.address)).to.closeTo(fp('1000000'), fp('50000')) // close to 1000000 Dai

      await UniV2Collateral.refresh()
      expect(await UniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices
      const UniV2Price3: BigNumber = await UniV2Collateral.strictPrice()
      const UniV2RefPerTok3: BigNumber = await UniV2Collateral.refPerTok()

      // Check rates and price increase
      expect(UniV2Price3).to.be.gt(UniV2Price2)
      expect(UniV2RefPerTok3).to.be.gt(UniV2RefPerTok2)

      // Check rates and prices - Have changed significantly
      expect(UniV2Price3).to.be.closeTo(fp('2252357'), fp('0.5')) // ~ 2252356.88 USD/LPs
      expect(UniV2RefPerTok3).to.closeTo(fp('1125769'), fp('50'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      await UniV2Collateral.refresh()
      expect(await UniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer UniV2Tokens should have been sent to the user
      const newBalanceAddr1LPs: BigNumber = await UniV2PairMock.balanceOf(addr1.address)

      // Check received tokens represent ~2K in value at current prices
      expect(newBalanceAddr1LPs.sub(balanceAddr1LPs)).to.be.closeTo(bn('44413e11'), bn('5e10')) // 2252357 USD/Lps  * 0.044412 Lps = ~10K USD
      // Check remainders in Backing Manager
      expect(await UniV2PairMock.balanceOf(backingManager.address)).to.be.closeTo(
        bn('10765011e4'),
        bn('1e3')
      ) //  10765011e4 * 2252379 USD/Lps = 0.24 USD
      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('0.24'), // ~= 0.24 usd (from above)
        fp('0.005')
      )
    })
  })

  // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
  // claiming calls throughout the protocol are handled correctly and do not revert.
  // UniswapV2 as no reward claims lPs removal gives earned fees
  // We just check that claimRewards() doesn't revert
  describe('Rewards', () => {
    it('Should be able to claim rewards (if applicable)', async () => {
      const MIN_ISSUANCE_PER_BLOCK = fp('1e4')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [UniV2PairMock.address, bn(0)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await UniV2PairMock.balanceOf(backingManager.address)).to.equal(0)

      // Provide approvals for issuances
      await UniV2PairMock.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Claim rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // move time ands blocks
      await advanceTime(3600)
      await advanceBlocks(1000)

      // Some swap
      // make some small DAI->USDC swap causing refPerTok() to increase
      // Setup balances for addr2 - Transfer from Mainnet holder
      // DAI and USDC then make some swaps
      const initialUserDai = fp('10000') // 10000 DAI
      const amountOutMinUsdc = bn('9950e6') // Usdc is 6 decimals
      const deadLine = Date.now() + 24 * 3600
      expect(await dai.balanceOf(addr2.address)).to.equal(fp('0'))
      await whileImpersonating(holderDAI, async (daiSigner) => {
        await dai.connect(daiSigner).transfer(addr2.address, initialUserDai)
      })

      expect(await dai.balanceOf(addr2.address)).to.equal(initialUserDai)
      await dai.connect(addr2).approve(UniV2RouterMock.address, initialUserDai)
      await UniV2RouterMock.connect(addr2).swapExactTokensForTokens(
        initialUserDai,
        amountOutMinUsdc,
        [dai.address, usdc.address],
        addr2.address,
        deadLine
      )

      expect(await dai.balanceOf(addr2.address)).to.equal(fp('0'))
      expect(await usdc.balanceOf(addr2.address)).to.closeTo(bn('10000e6'), bn('50e6')) // close to 10000 Usdc

      await UniV2Collateral.refresh()
      expect(await UniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Still Claim rewards ok
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // stalled
      await expect(UniV2Collateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await UniV2Collateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('2'))

      // Refresh should mark status IFFY
      await UniV2Collateral.refresh()
      expect(await UniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      // UniV2Tokens Collateral with no price
      const nonpriceUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        NO_PRICE_DATA_FEED,
        networkConfig[chainId].chainlinkFeeds.USDC as string,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // UniV2 - Collateral with no price info should revert
      await expect(nonpriceUniV2Collateral.strictPrice()).to.be.revertedWith('')

      // Refresh should also revert - status is not modified
      await expect(nonpriceUniV2Collateral.refresh()).to.be.reverted
      expect(await nonpriceUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      await setOraclePriceUniV2({ univ2Addr: invalidpriceUniV2Collateral.address, priceA: bn(0) })

      // Reverts with zero price A
      await expect(invalidpriceUniV2Collateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceUniV2Collateral.refresh()
      expect(await invalidpriceUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      await setOraclePriceUniV2({ univ2Addr: invalidpriceUniV2Collateral.address, priceB: bn(0) })

      // Reverts with zero price B
      await expect(invalidpriceUniV2Collateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceUniV2Collateral.refresh()
      expect(await invalidpriceUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      await setOraclePriceUniV2({
        univ2Addr: invalidpriceUniV2Collateral.address,
        priceA: bn(0),
        priceB: bn(0),
      })

      // Reverts with zero price A and B
      await expect(invalidpriceUniV2Collateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceUniV2Collateral.refresh()
      expect(await invalidpriceUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      // back to valid prices

      await setOraclePriceUniV2({
        univ2Addr: invalidpriceUniV2Collateral.address,
        priceA: bn('1e18'),
        priceB: bn('1e6'),
      })

      // Reverts with zero price A and B
      await expect(invalidpriceUniV2Collateral.strictPrice()).to.not.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status back to SOUND
      await invalidpriceUniV2Collateral.refresh()
      expect(await invalidpriceUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // soft default = SOUND -> IFFY -> SOUND due to misbehavior end
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for soft default
    it('Updates status in case of soft default on price A', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePriceUniV2({ univ2Addr: newUniV2Collateral.address, priceA: bn('8e17') }) // -20% on dai price

      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // UniV2Token
      const prevWhenDefault: BigNumber = await newUniV2Collateral.whenDefault()
      await expect(newUniV2Collateral.refresh()).to.not.emit(
        newUniV2Collateral,
        'DefaultStatusChanged'
      )
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUniV2Collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Updates status in case of soft default on price B', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePriceUniV2({ univ2Addr: newUniV2Collateral.address, priceB: bn('8e5') }) // -20% on usdc price

      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // UniV2Token
      const prevWhenDefault: BigNumber = await newUniV2Collateral.whenDefault()
      await expect(newUniV2Collateral.refresh()).to.not.emit(
        newUniV2Collateral,
        'DefaultStatusChanged'
      )
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUniV2Collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Updates status in case of soft default on price A and B', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePriceUniV2({
        univ2Addr: newUniV2Collateral.address,
        priceA: bn('8e17'),
        priceB: bn('1.2e6'),
      }) // -20% dai +20% usdc
      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // UniV2Token
      const prevWhenDefault: BigNumber = await newUniV2Collateral.whenDefault()
      await expect(newUniV2Collateral.refresh()).to.not.emit(
        newUniV2Collateral,
        'DefaultStatusChanged'
      )
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUniV2Collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Updates status in case of soft default on ratio', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      // and an invalidPair

      //at first valid ratio 1:1
      await InvalidPairV2.setReserves(bn('1e18'), bn('1e6'), bn('1e18'))
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        InvalidPairV2.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 5% and increasing 5%
      await setOraclePriceUniV2({
        univ2Addr: newUniV2Collateral.address,
        priceA: bn('9.5e17'),
        priceB: bn('1.05e6'),
      }) // -5% on dai and usdc price

      // Force updates - Should not update whenDefault and status
      await expect(newUniV2Collateral.refresh()).to.not.emit(
        newUniV2Collateral,
        'DefaultStatusChanged'
      )
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // set invalid reserves +20% on ratio
      await InvalidPairV2.setReserves(bn('1e18'), bn('1.2e6'), bn('1e18'))

      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // UniV2Token
      const prevWhenDefault: BigNumber = await newUniV2Collateral.whenDefault()
      await expect(newUniV2Collateral.refresh()).to.not.emit(
        newUniV2Collateral,
        'DefaultStatusChanged'
      )
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUniV2Collateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Can revert to SOUND status in case of soft default on price A ', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePriceUniV2({ univ2Addr: newUniV2Collateral.address, priceA: bn('8e17') }) // -20% on dai price

      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward before delayUntilDefault
      await advanceTime(Number(delayUntilDefault) - 10)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      await setOraclePriceUniV2({ univ2Addr: newUniV2Collateral.address, priceA: bn('1e18') }) // back to normal
      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)
    })

    it('Can revert to SOUND status in case of soft default on price B', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePriceUniV2({ univ2Addr: newUniV2Collateral.address, priceB: bn('8e5') }) // -20% on usdc price

      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward before delayUntilDefault
      await advanceTime(Number(delayUntilDefault) - 10)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      await setOraclePriceUniV2({ univ2Addr: newUniV2Collateral.address, priceB: bn('1e6') }) // back to normal
      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)
    })

    it('Can revert to SOUND status in case of soft default on price A and B', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 20%
      await setOraclePriceUniV2({
        univ2Addr: newUniV2Collateral.address,
        priceA: bn('8e17'),
        priceB: bn('1.2e6'),
      }) // -20% dai +20% usdc
      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward before delayUntilDefault
      await advanceTime(Number(delayUntilDefault) - 10)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      await setOraclePriceUniV2({
        univ2Addr: newUniV2Collateral.address,
        priceA: bn('1e18'),
        priceB: bn('1e6'),
      }) // back to normal
      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)
    })

    it('Can revert to SOUND status in case of soft default on ratio', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      // and an invalidPair

      //at first valid ratio 1:1
      await InvalidPairV2.setReserves(bn('1e18'), bn('1e6'), bn('1e18'))
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        InvalidPairV2.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Depeg one of the underlying tokens - Reducing price 5% and increasing 5%
      await setOraclePriceUniV2({
        univ2Addr: newUniV2Collateral.address,
        priceA: bn('9.5e17'),
        priceB: bn('1.05e6'),
      }) // -5% on dai and usdc price

      // Force updates - Should not update whenDefault and status
      await expect(newUniV2Collateral.refresh()).to.not.emit(
        newUniV2Collateral,
        'DefaultStatusChanged'
      )
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // set invalid reserves +20% on ratio
      await InvalidPairV2.setReserves(bn('1e18'), bn('1.2e6'), bn('1e18'))

      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward before delayUntilDefault
      await advanceTime(Number(delayUntilDefault) - 10)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.IFFY)

      await InvalidPairV2.setReserves(bn('1e18'), bn('1e6'), bn('9e17')) // back to normal adapt L for price increase
      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)
    })

    // Test for hard default
    it('Updates status in case of hard default', async () => {
      // Note: In this case requires to use a InvalidPairV2 mock to be able to change the rate
      //at first valid ratio 1:1
      await InvalidPairV2.setReserves(bn('1e18'), bn('1e6'), bn('1e18'))
      const newUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        InvalidPairV2.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2Collateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for sqrt(x*y)/L = sqrt(1*1)/2 = 0.5 < 1
      await InvalidPairV2.setReserves(bn('1e18'), bn('1e6'), bn('2e18'))

      // Force updates - Should update whenDefault and status
      await expect(newUniV2Collateral.refresh())
        .to.emit(newUniV2Collateral, 'DefaultStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newUniV2Collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      //Cannot go back sqrt(x*y)/L = sqrt(2*2)/1 = 2 > 1
      await InvalidPairV2.setReserves(bn('2e18'), bn('2e6'), bn('1e18'))
      await expect(newUniV2Collateral.refresh()).to.not.emit(
        newUniV2Collateral,
        'DefaultStatusChanged'
      )

      expect(await newUniV2Collateral.status()).to.equal(CollateralStatus.DISABLED)
    })

    it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeedA: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(18, bn('1e18'))
      )

      const invalidChainlinkFeedB: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
      )

      const invalidUniV2Collateral: UniV2Collateral = <UniV2Collateral>await (
        await ethers.getContractFactory('UniV2Collateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        UniV2RouterMock.address,
        fp('2'), // dai and usdc pegged to USD => fallback = 2sqrt(pApB)=2
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        invalidChainlinkFeedA.address,
        invalidChainlinkFeedB.address,
        fp('1'),
        fp('1'),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Reverting with no reason
      await invalidChainlinkFeedA.setSimplyRevert(true)
      await expect(invalidUniV2Collateral.refresh()).to.be.revertedWith('')
      expect(await invalidUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeedA.setSimplyRevert(false)
      await expect(invalidUniV2Collateral.refresh()).to.be.revertedWith('')
      expect(await invalidUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverting with no reason
      await invalidChainlinkFeedB.setSimplyRevert(true)
      await expect(invalidUniV2Collateral.refresh()).to.be.revertedWith('')
      expect(await invalidUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeedB.setSimplyRevert(false)
      await expect(invalidUniV2Collateral.refresh()).to.be.revertedWith('')
      expect(await invalidUniV2Collateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })
})

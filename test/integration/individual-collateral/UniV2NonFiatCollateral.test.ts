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
  UniswapV2MockFactory,
  UniswapV2MockRouter02,
  UniswapV2MockPair,
  UniV2Asset,
  InvalidPairMock,
  UniV2NonFiatCollateral,
  UniV2NonFiatCollateral__factory,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
// not needed UniV2 router works with eth directly
// const holderWETH = '0xf04a5cc80b1e94c69b48f5ee68a08cd2f09a7c3e'
const holderUSDC = '0xAe2D4617c862309A3d75A0fFB358c7a5009c673F'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork(`UniswapV2NonFiatCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress

  // Tokens/Assets
  let usdc: ERC20Mock //usdc for tokenA
  let weth: ERC20Mock //weth for tokenB
  let UniV2Asset: UniV2Asset
  let UniV2PairMock: UniswapV2MockPair
  let UniV2RouterMock: UniswapV2MockRouter02
  let UniV2FactoryMock: UniswapV2MockFactory
  let UniV2NonFiatCollateral: UniV2NonFiatCollateral
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

  let initialBalEth: BigNumber
  let initialBalUsdc: BigNumber
  let amountEth: BigNumber
  let amountEthLow: BigNumber
  let amountUsdc: BigNumber
  let amountUsdcLow: BigNumber
  let initialLPs: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  let UniV2NonFiatCollateralFactory: UniV2NonFiatCollateral__factory
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeedA: MockV3Aggregator
  let mockChainlinkFeedB: MockV3Aggregator

  let InvalidPairV2: InvalidPairMock

  let initialPrice: BigNumber
  let initialRefPerTock: BigNumber
  let initialPricePertarget: BigNumber
  let unitName: string

  async function getPrice(UniV2PairMock: UniswapV2MockPair): Promise<BigNumber> {
    const [resA0, resB0] = await UniV2PairMock.getReserves()
    const initialTotalSuply = await UniV2PairMock.totalSupply()
    const MockV3AggregatorA = await ethers.getContractAt(
      'MockV3Aggregator',
      networkConfig[chainId].chainlinkFeeds.USDC || ''
    )
    const pa = Number(await MockV3AggregatorA.latestAnswer()) / 10 ** 8
    const MockV3AggregatorB = await ethers.getContractAt(
      'MockV3Aggregator',
      networkConfig[chainId].chainlinkFeeds.ETH || ''
    )
    const pb = Number(await MockV3AggregatorB.latestAnswer()) / 10 ** 8
    return bn(
      Math.round(
        (pa * Number(resA0) * 10 ** (18 - 6) + pb * Number(resB0)) / Number(initialTotalSuply)
      )
    )
  }

  async function getRefPertok(UniV2PairMock: UniswapV2MockPair): Promise<BigNumber> {
    const [resA0, resB0] = await UniV2PairMock.getReserves()
    const initialTotalSuply = await UniV2PairMock.totalSupply()
    return bn(
      Math.round(
        Math.sqrt(Number(resA0) * Number(resB0) * 10 ** (18 - 6)) / Number(initialTotalSuply)
      )
    )
  }

  async function getPricePerTarget(UniV2PairMock: UniswapV2MockPair): Promise<BigNumber> {
    const [resA0, resB0] = await UniV2PairMock.getReserves()
    const MockV3AggregatorA = await ethers.getContractAt(
      'MockV3Aggregator',
      networkConfig[chainId].chainlinkFeeds.USDC || ''
    )
    const pa = Number(await MockV3AggregatorA.latestAnswer()) / 10 ** 8
    const MockV3AggregatorB = await ethers.getContractAt(
      'MockV3Aggregator',
      networkConfig[chainId].chainlinkFeeds.ETH || ''
    )
    const pb = Number(await MockV3AggregatorB.latestAnswer()) / 10 ** 8
    const p =
      (pa * Number(resA0) * 10 ** (18 - 6) + pb * Number(resB0)) /
      Math.sqrt(Number(resA0) * Number(resB0) * 10 ** (18 - 6))
    const bn_p = `${p}e18`
    return bn(bn_p)
  }

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

    weth = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.WETH || '')
    )

    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )
    // Get UniV2 Factory
    UniV2FactoryMock = await ethers.getContractAt(
      'UniswapV2MockFactory',
      networkConfig[chainId].UNISWAP_V2_FACTORY || ''
    )
    // Get pair for USDC/ETH
    const pairAddress = await UniV2FactoryMock.getPair(usdc.address, weth.address)
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
      fp('1'),
      config.rTokenMaxTradeVolume,
      delayUntilDefault,
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      networkConfig[chainId].chainlinkFeeds.WETH as string,
      ORACLE_TIMEOUT
    )
    // Get Collateral
    UniV2NonFiatCollateralFactory = await ethers.getContractFactory('UniV2NonFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    unitName = 'UNIV2SQRT' + 'USDC' + 'ETH' //UNIV2SQRT USDC ETH

    UniV2NonFiatCollateral = await UniV2NonFiatCollateralFactory.deploy(
      UniV2PairMock.address,
      fp('1'),
      config.rTokenMaxTradeVolume,
      delayUntilDefault,
      networkConfig[chainId].chainlinkFeeds.USDC as string,
      networkConfig[chainId].chainlinkFeeds.WETH as string,
      ethers.utils.formatBytes32String(unitName),
      defaultThreshold,
      ORACLE_TIMEOUT
    )

    // Setup balances for addr1 - Transfer from Mainnet holder
    initialBalUsdc = bn('2e12') // 2M Usdc
    await whileImpersonating(holderUSDC, async (usdcSigner) => {
      await usdc.connect(usdcSigner).transfer(addr1.address, initialBalUsdc)
    })

    initialBalEth = await ethers.provider.getBalance(addr1.address)
    const deadLine = Date.now() + 24 * 3600
    // 6 june 2022 ~ 1 800 USDC per ETH
    // 1000 eth => ~ 1.8 M USDC min
    amountEth = fp('1000')
    amountEthLow = fp('900')
    amountUsdc = bn('2e12')
    amountUsdcLow = bn('1.8e12')
    // aprove router02
    await usdc.connect(addr1).approve(UniV2RouterMock.address, initialBalUsdc)

    // add liquidity
    await UniV2RouterMock.connect(addr1).addLiquidityETH(
      usdc.address,
      amountUsdc,
      amountUsdcLow,
      amountEthLow,
      addr1.address,
      bn(deadLine),
      { value: amountEth }
    )

    initialLPs = await UniV2PairMock.balanceOf(addr1.address)
    // get initial price
    initialPrice = await getPrice(UniV2PairMock)
    initialRefPerTock = await getRefPertok(UniV2PairMock)
    initialPricePertarget = await getPricePerTarget(UniV2PairMock)

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
      primaryBasket: [UniV2NonFiatCollateral.address],
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
    mockChainlinkFeedA = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6')) //USDC 6 dec
    mockChainlinkFeedB = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(18, fp('1850')) //ETH 18 decimals => price 1ETH ~ 1.85K USD 06/06/2022

    // SetUp Mock pairV2 for some tests
    InvalidPairV2 = await (
      await ethers.getContractFactory('InvalidPairMock')
    ).deploy(usdc.address, weth.address)
  })

  describe('Deployment', () => {
    // Check the initial state
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      // check addr1 balance
      expect(await ethers.provider.getBalance(addr1.address)).to.closeTo(
        initialBalEth.sub(amountEth),
        amountEth.div(bn('10'))
      ) // delta = 10%
      expect(await usdc.balanceOf(addr1.address)).to.closeTo(
        initialBalUsdc.sub(amountUsdc),
        amountUsdc.div(bn('10'))
      ) // delta = 10%
      expect(await UniV2PairMock.balanceOf(addr1.address)).to.equal(initialLPs)

      // Check UNIV2 Asset
      expect(await UniV2Asset.isCollateral()).to.equal(false)
      expect(await UniV2Asset.erc20()).to.equal(UniV2PairMock.address)
      expect((await UniV2Asset.erc20()).toLowerCase()).to.equal(
        networkConfig[chainId].tokens.UNIV2_USDC_ETH
      )
      expect(await UniV2PairMock.decimals()).to.equal(18)
      expect(await UniV2Asset.strictPrice()).to.be.closeTo(fp(initialPrice), fp('0.5')) // Close to 169035150 USD per LPs- June 2022
      await expect(UniV2Asset.claimRewards()).to.not.emit(UniV2Asset, 'RewardsClaimed')
      expect(await UniV2Asset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Check Collateral plugin
      // UniV2Collateral
      expect(await UniV2NonFiatCollateral.isCollateral()).to.equal(true)
      expect(await UniV2NonFiatCollateral.erc20()).to.equal(UniV2PairMock.address)
      expect(await UniV2PairMock.decimals()).to.equal(18)
      expect(await UniV2NonFiatCollateral.targetName()).to.equal(
        ethers.utils.formatBytes32String('UNIV2SQRTUSDCETH')
      )
      expect(await UniV2NonFiatCollateral.refPerTok()).to.closeTo(fp(initialRefPerTock), fp('0.5')) // june 2022 ~ 1959750
      expect(await UniV2NonFiatCollateral.targetPerRef()).to.equal(fp('1'))
      expect(await UniV2NonFiatCollateral.pricePerTarget()).to.closeTo(
        initialPricePertarget,
        fp('1e-5')
      )
      expect(await UniV2NonFiatCollateral.prevReferencePrice()).to.equal(
        await UniV2NonFiatCollateral.refPerTok()
      )
      expect(await UniV2NonFiatCollateral.strictPrice()).to.be.closeTo(fp(initialPrice), fp('0.5')) // same as asset Close to $2251989 USD per LPs- June 2022

      // Check claim data
      await expect(UniV2NonFiatCollateral.claimRewards())
        .to.emit(UniV2NonFiatCollateral, 'RewardsClaimed')
        .withArgs(UniV2PairMock.address, 0)
      expect(await UniV2NonFiatCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

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
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(UniV2NonFiatCollateral.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[2])).to.equal(UniV2NonFiatCollateral.address)
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
      expect(price).to.be.closeTo(initialPricePertarget, fp('0.015')) // uses pricePertarget

      // Check RToken price
      const issueAmount: BigNumber = fp('2000')
      await UniV2PairMock.connect(addr1).approve(rToken.address, issueAmount)
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(initialPricePertarget, fp('0.015'))
    })

    // Validate constructor arguments
    it('Should validate constructor arguments correctly', async () => {
      // Default threshold
      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          UniV2PairMock.address,
          fp('1'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          networkConfig[chainId].chainlinkFeeds.ETH as string,
          ethers.utils.formatBytes32String(unitName),
          bn('0'),
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith(`[UNIV2COL DEPLOY ERROR]: defaultThreshold zero`)

      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          ZERO_ADDRESS,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          networkConfig[chainId].chainlinkFeeds.WETH as string,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: missing PairV2')

      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          UniV2PairMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          ZERO_ADDRESS,
          networkConfig[chainId].chainlinkFeeds.WETH as string,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: missing chainlink feed for token A')

      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          UniV2PairMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          ZERO_ADDRESS,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: missing chainlink feed for token B')

      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          UniV2PairMock.address,
          fp('2'),
          bn('0'),
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          networkConfig[chainId].chainlinkFeeds.WETH as string,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: invalid max trade volume')

      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          UniV2PairMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          bn('0'),
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          networkConfig[chainId].chainlinkFeeds.WETH as string,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: delayUntilDefault zero')

      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          UniV2PairMock.address,
          fp('2'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          networkConfig[chainId].chainlinkFeeds.WETH as string,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          bn('0')
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: oracleTimeout zero')

      await expect(
        UniV2NonFiatCollateralFactory.deploy(
          UniV2PairMock.address,
          bn('0'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          networkConfig[chainId].chainlinkFeeds.USDC as string,
          networkConfig[chainId].chainlinkFeeds.WETH as string,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      ).to.be.revertedWith('[UNIV2A DEPLOY ERROR]: fallback price zero')
    })
  })

  describe('RefPerTok non decreasing checks', () => {
    it('Adding/Removing liquidy should not change refPerTock', async () => {
      // Initial refPerTok
      const UniV2RefPerTok1: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok1).to.be.closeTo(fp(initialRefPerTock), fp('0.5'))
      expect(await UniV2PairMock.balanceOf(addr2.address)).to.equal(fp('0'))

      // add liquidity
      const usdcAddr2 = bn('2e12') // 2M Usdc
      await whileImpersonating(holderUSDC, async (signer) => {
        await usdc.connect(signer).transfer(addr2.address, usdcAddr2)
      })
      const deadLine = Date.now() + 24 * 3600
      const amountEthAddr2 = fp('1000') // 1000 ETH ~ 1.8M$ 6/6/2022
      const amountEthLowAddr2 = fp('1.99')
      const amountUsdcAddr2 = bn('1.9e12')
      const amountUsdcLowAddr2 = bn('1.8e12')
      // aprove router02
      await usdc.connect(addr2).approve(UniV2RouterMock.address, usdcAddr2)
      // add liquidity
      await UniV2RouterMock.connect(addr2).addLiquidityETH(
        usdc.address,
        amountUsdcAddr2,
        amountUsdcLowAddr2,
        amountEthLowAddr2,
        addr2.address,
        bn(deadLine),
        { value: amountEthAddr2 }
      )

      // refresh
      await UniV2NonFiatCollateral.refresh()
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      const newLiqAddr2 = await UniV2PairMock.balanceOf(addr2.address)
      expect(newLiqAddr2).to.be.gt(fp('0'))

      const UniV2RefPerTok2: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok2).to.be.closeTo(fp(initialRefPerTock), fp('0.5'))
      await UniV2PairMock.connect(addr2).approve(UniV2RouterMock.address, newLiqAddr2)
      //Remove liquidity
      await UniV2RouterMock.connect(addr2).removeLiquidityETH(
        usdc.address,
        newLiqAddr2,
        amountUsdcLowAddr2,
        amountEthLowAddr2,
        addr2.address,
        bn(deadLine)
      )

      // refresh
      await UniV2NonFiatCollateral.refresh()
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      expect(await UniV2PairMock.balanceOf(addr2.address)).to.equal(fp('0'))

      const UniV2RefPerTok3: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok3).to.be.closeTo(fp(initialRefPerTock), fp('0.5'))
    })

    it('Swap Eth to tokens should increase refPerTock', async () => {
      // Initial refPerTok
      const UniV2RefPerTok1: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok1).to.be.closeTo(fp(initialRefPerTock), fp('0.5'))
      expect(await UniV2PairMock.balanceOf(addr2.address)).to.equal(fp('0'))

      // add Usdc
      const usdcAddr2 = bn('2e12') // 2M usdc
      const ethAddr2 = fp('1000')
      const deadLine = Date.now() + 24 * 3600
      const usdcLowAddr2 = bn('1.8e12')

      const ethBalAddr2 = await ethers.provider.getBalance(addr2.address)
      expect(ethBalAddr2).to.gt(ethAddr2)
      expect(await usdc.balanceOf(addr2.address)).to.equal(bn('0'))

      //Make a swap
      await UniV2RouterMock.connect(addr2).swapExactETHForTokens(
        usdcLowAddr2,
        [weth.address, usdc.address],
        addr2.address,
        deadLine,
        { value: ethAddr2 }
      )
      const usdcAddr2Bal = await usdc.balanceOf(addr2.address)

      expect(usdcAddr2Bal).to.be.gt(usdcLowAddr2)
      expect(usdcAddr2Bal).to.be.closeTo(usdcAddr2, bn('1e12')) // ~10%
      const newEthBalAddr2 = await ethers.provider.getBalance(addr2.address)
      expect(ethBalAddr2.sub(newEthBalAddr2)).to.closeTo(ethAddr2, ethAddr2.div(bn('100'))) // ~ delta 1%

      // refresh
      await UniV2NonFiatCollateral.refresh()
      // 1000 eth => 1.8M USDC is a huge swap. Pluggin status can be IFFY but not disabled
      expect(await UniV2NonFiatCollateral.status()).to.not.equal(CollateralStatus.DISABLED)

      // refPertok increases
      const UniV2RefPerTok2: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok2).to.be.gt(fp(initialRefPerTock))
      expect(UniV2RefPerTok2).to.be.gt(UniV2RefPerTok1)
      //huge swap huge increase in refPerTock, more than 50 {ref} june 2022
      expect(UniV2RefPerTok2).to.be.not.closeTo(UniV2RefPerTok1, fp('50'))
      expect(UniV2RefPerTok2).to.be.closeTo(UniV2RefPerTok1, fp('100'))
    })

    it('Swap token to Eth should increase refPerTock', async () => {
      // Initial refPerTok
      const UniV2RefPerTok1: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok1).to.be.closeTo(fp(initialRefPerTock), fp('0.5'))
      expect(await UniV2PairMock.balanceOf(addr2.address)).to.equal(fp('0'))

      // add USDC
      const usdcAddr2 = bn('2e12') // 2M usdc
      await whileImpersonating(holderUSDC, async (usdcSigner) => {
        await usdc.connect(usdcSigner).transfer(addr2.address, usdcAddr2)
      })

      const deadLine = Date.now() + 24 * 3600
      const ethLowAddr2 = fp('1000') // at least 1000 eth ~1.8M USD june 2022

      expect(await usdc.balanceOf(addr2.address)).to.equal(usdcAddr2)
      const ethBalAddr2 = await ethers.provider.getBalance(addr2.address)

      // aprove router02
      await usdc.connect(addr2).approve(UniV2RouterMock.address, usdcAddr2)

      //Make a swap
      await UniV2RouterMock.connect(addr2).swapExactTokensForETH(
        usdcAddr2,
        ethLowAddr2,
        [usdc.address, weth.address],
        addr2.address,
        deadLine
      )
      const newEthAddr2Bal = await ethers.provider.getBalance(addr2.address)
      expect(newEthAddr2Bal.sub(ethBalAddr2)).to.be.gt(ethLowAddr2)
      expect(newEthAddr2Bal.sub(ethBalAddr2)).to.be.closeTo(ethLowAddr2, fp('1000')) // close to 1000 eth
      expect(await usdc.balanceOf(addr2.address)).to.equal(bn('0'))

      // refresh
      await UniV2NonFiatCollateral.refresh()
      // 2M USDC=>eth is a huge swap. Pluggin status can be IFFY but not disabled
      expect(await UniV2NonFiatCollateral.status()).to.not.equal(CollateralStatus.DISABLED)

      // refPertok increases
      const UniV2RefPerTok2: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok2).to.be.gt(fp(initialRefPerTock))
      expect(UniV2RefPerTok2).to.be.gt(UniV2RefPerTok1)
      //huge swap huge increase in refPerTock, more than 50 {ref} june 2022
      expect(UniV2RefPerTok2).to.be.not.closeTo(UniV2RefPerTok1, fp('50'))
      expect(UniV2RefPerTok2).to.be.closeTo(UniV2RefPerTok1, fp('100'))
    })

    it('Swap tokens in and out should only increase refPerTock', async () => {
      // Initial refPerTok
      const UniV2RefPerTok1: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok1).to.be.closeTo(fp(initialRefPerTock), fp('0.5'))
      expect(await UniV2PairMock.balanceOf(addr2.address)).to.equal(fp('0'))

      const deadLine = Date.now() + 24 * 3600
      const usdcLowAddr2 = bn('1.8e12')
      const amountEth = fp('1000') // 1000 eth ~ 1.8 M USDC 06/06/2022

      let ethBalAddr2 = await ethers.provider.getBalance(addr2.address)

      //Make a swap
      await UniV2RouterMock.connect(addr2).swapExactETHForTokens(
        usdcLowAddr2,
        [weth.address, usdc.address],
        addr2.address,
        deadLine,
        { value: amountEth }
      )

      const usdcAddr2 = await usdc.balanceOf(addr2.address)
      let newEthBalAddr2 = await ethers.provider.getBalance(addr2.address)
      expect(usdcAddr2).to.be.gt(usdcLowAddr2)
      expect(usdcAddr2).to.be.closeTo(bn('1.8e12'), bn('1e11')) // ~5% slip
      expect(ethBalAddr2.sub(newEthBalAddr2)).to.closeTo(amountEth, amountEth.div(bn('1000'))) // ~0.1%

      const ethLowAddr2 = fp('990')
      await usdc.connect(addr2).approve(UniV2RouterMock.address, usdcAddr2)
      ethBalAddr2 = await ethers.provider.getBalance(addr2.address)

      //Make a swap
      await UniV2RouterMock.connect(addr2).swapExactTokensForETH(
        usdcAddr2,
        ethLowAddr2,
        [usdc.address, weth.address],
        addr2.address,
        deadLine
      )

      newEthBalAddr2 = await ethers.provider.getBalance(addr2.address)
      expect(newEthBalAddr2).to.be.gt(ethBalAddr2)
      expect(newEthBalAddr2.sub(ethBalAddr2)).to.be.closeTo(amountEth, fp('6')) // ~0.6% slip total
      expect(await usdc.balanceOf(addr2.address)).to.equal(bn('0'))

      // refresh
      await UniV2NonFiatCollateral.refresh()
      // 2M in and out is a huge swap but pluggin status should be SOUND
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // refPertok increases
      const UniV2RefPerTok2: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2RefPerTok2).to.be.gt(fp(initialRefPerTock))
      expect(UniV2RefPerTok2).to.be.gt(UniV2RefPerTok1)
      //huge swap huge increase in refPerTock, more than 2*50 = 100 {ref} june 2022
      expect(UniV2RefPerTok2).to.be.not.closeTo(UniV2RefPerTok1, fp('100'))
      expect(UniV2RefPerTok2).to.be.closeTo(UniV2RefPerTok1, fp('200'))
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
      const UniV2Price1: BigNumber = await UniV2NonFiatCollateral.strictPrice()
      const UniV2RefPerTok1: BigNumber = await UniV2NonFiatCollateral.refPerTok()
      expect(UniV2Price1).to.be.closeTo(fp(initialPrice), fp('0.5'))
      expect(UniV2RefPerTok1).to.closeTo(fp(initialRefPerTock), fp('0.5'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      const expectedTotalval = (await getPricePerTarget(UniV2PairMock)).mul(bn('1e4'))
      expect(totalAssetValue1).to.be.closeTo(expectedTotalval, fp('0.1')) // approx 10K * pPerTaget
      // ~ 10K *86.2534 ~ 86253.4$ in value

      await advanceTime(10000)
      await advanceBlocks(10000)

      // make some small ETH->USDC swap causing refPerTok() to increase
      // Setup balances for addr2 - Transfer from Mainnet holder
      // USDC then make some swaps
      const amountEthAddr2 = fp('10') // 10 Eth
      const amountOutMinUsdc = bn('1.85e10') // 18.5 K USD
      const deadLine = Date.now() + 24 * 3600
      const ethBalAddr2 = await ethers.provider.getBalance(addr2.address)
      expect(ethBalAddr2).to.gt(amountEthAddr2)

      // Swap ETH for USDC
      await UniV2RouterMock.connect(addr2).swapExactETHForTokens(
        amountOutMinUsdc,
        [weth.address, usdc.address],
        addr2.address,
        deadLine,
        { value: amountEthAddr2 }
      )

      const newEthBalAddr2 = await ethers.provider.getBalance(addr2.address)
      expect(ethBalAddr2.sub(newEthBalAddr2)).to.closeTo(amountEthAddr2, fp('0.001'))
      expect(await usdc.balanceOf(addr2.address)).to.closeTo(amountOutMinUsdc, bn('5e8')) // close to 1.85 K Usdc

      await UniV2NonFiatCollateral.refresh()
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices
      const UniV2Price2: BigNumber = await UniV2NonFiatCollateral.strictPrice()
      const UniV2RefPerTok2: BigNumber = await UniV2NonFiatCollateral.refPerTok()

      // Check rates and price increase
      expect(UniV2Price2).to.be.gt(UniV2Price1)
      expect(UniV2RefPerTok2).to.be.gt(UniV2RefPerTok1)

      // Still close to the original values
      expect(UniV2Price2).to.be.closeTo(fp(initialPrice), fp(initialPrice).div(bn(10000))) // within 0.01%
      expect(UniV2RefPerTok2).to.closeTo(fp(initialRefPerTock), fp(initialRefPerTock).div(1000)) // within 0.1%

      await UniV2NonFiatCollateral.refresh()
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // make some huge USDC-> ETH swap causing refPerTok() to increase
      // Setup balances for addr3 - Transfer from Mainnet holder
      // USDC then make some swap
      const initialUserUsdc = bn('1.9e12') // 2M Usdc (6 decimals)
      const amountOutMinETH = fp('990') // 1000 eth in value
      expect(await usdc.balanceOf(addr3.address)).to.equal(bn('0'))
      await whileImpersonating(holderUSDC, async (usdcSigner) => {
        await usdc.connect(usdcSigner).transfer(addr3.address, initialUserUsdc)
      })

      expect(await usdc.balanceOf(addr3.address)).to.equal(initialUserUsdc)
      const ethBalAddr3 = await ethers.provider.getBalance(addr3.address)

      await usdc.connect(addr3).approve(UniV2RouterMock.address, initialUserUsdc)
      await UniV2RouterMock.connect(addr3).swapExactTokensForETH(
        initialUserUsdc,
        amountOutMinETH,
        [usdc.address, weth.address],
        addr3.address,
        deadLine
      )

      expect(await usdc.balanceOf(addr3.address)).to.equal(fp('0'))
      const newEthBalAddr3 = await ethers.provider.getBalance(addr3.address)
      expect(newEthBalAddr3.sub(ethBalAddr3)).to.closeTo(fp('1000'), fp('1000').div(100)) // close to 1K Eth ~ 1%

      await UniV2NonFiatCollateral.refresh()
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Check rates and prices
      const UniV2Price3: BigNumber = await UniV2NonFiatCollateral.strictPrice()
      const UniV2RefPerTok3: BigNumber = await UniV2NonFiatCollateral.refPerTok()

      // Check rates and price increase
      expect(UniV2Price3).to.be.gt(UniV2Price2)
      expect(UniV2RefPerTok3).to.be.gt(UniV2RefPerTok2)

      // Check rates and prices - Have changed significantly
      expect(UniV2Price3).to.not.closeTo(fp(initialPrice), fp(initialPrice).div(10000)) // not close 0.01%
      expect(UniV2Price3).to.be.closeTo(fp(initialPrice), fp(initialPrice).div(100)) // at least 1% away
      expect(UniV2RefPerTok3).to.not.closeTo(fp(initialRefPerTock), fp('10')) // not close
      expect(UniV2RefPerTok3).to.closeTo(fp(initialRefPerTock), fp('1000'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
        rToken.address
      )
      expect(totalAssetValue3).to.be.gt(totalAssetValue2)

      await UniV2NonFiatCollateral.refresh()
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Redeem Rtokens with the updated rates
      await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

      // Check funds were transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Check balances - Fewer UniV2Tokens should have been sent to the user
      const newBalanceAddr1LPs: BigNumber = await UniV2PairMock.balanceOf(addr1.address)

      // Check received tokens represent ~2K in value at current prices
      expect(newBalanceAddr1LPs.sub(balanceAddr1LPs)).to.be.closeTo(bn('51021e11'), bn('5e11'))
      // Check remainders in Backing Manager
      expect(await UniV2PairMock.balanceOf(backingManager.address)).to.be.closeTo(
        bn('17498865e4'),
        bn('1e3')
      )
      //  17498865e4 * 169084168 USD/Lps / 10**18 =  29,59 €
      //  Check total asset value (remainder)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('29.59'), // ~= 29.58 usd (from above)
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
      // make some small ETH->USDC swap causing refPerTok() to increase
      const swapEth = fp('10') // 10 rth
      const amountOutMinUsdc = bn('18500e6') // 10 eth * 1.85 K = 18 500 Usdc
      const deadLine = Date.now() + 24 * 3600
      const ethBalAddr2 = await ethers.provider.getBalance(addr2.address)

      expect(ethBalAddr2).to.gt(swapEth)
      await UniV2RouterMock.connect(addr2).swapExactETHForTokens(
        amountOutMinUsdc,
        [weth.address, usdc.address],
        addr2.address,
        deadLine,
        { value: swapEth }
      )
      const newEthBalAddr2 = await ethers.provider.getBalance(addr2.address)
      expect(ethBalAddr2.sub(newEthBalAddr2)).to.closeTo(swapEth, fp('0.001'))
      expect(await usdc.balanceOf(addr2.address)).to.closeTo(amountOutMinUsdc, bn('50e6')) // close to 10000 Usdc

      await UniV2NonFiatCollateral.refresh()
      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Still Claim rewards ok
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')
    })
  })

  describe('Price Handling', () => {
    it('Should handle invalid/stale Price', async () => {
      // Reverts with stale price
      await advanceTime(ORACLE_TIMEOUT.toString())

      // stalled
      await expect(UniV2NonFiatCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

      // Fallback price is returned
      const [isFallback, price] = await UniV2NonFiatCollateral.price(true)
      expect(isFallback).to.equal(true)
      expect(price).to.equal(fp('1'))

      // Refresh should mark status IFFY
      await UniV2NonFiatCollateral.refresh()

      expect(await UniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      // UniV2Tokens Collateral with no price
      const nonpriceUniV2NonFiatCollateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>await (
        await ethers.getContractFactory('UniV2NonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        fp('1'),
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        NO_PRICE_DATA_FEED,
        networkConfig[chainId].chainlinkFeeds.ETH as string,
        ethers.utils.formatBytes32String(unitName),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // UniV2 - Collateral with no price info should revert
      await expect(nonpriceUniV2NonFiatCollateral.strictPrice()).to.be.reverted

      // Refresh should also revert - status is not modified
      await expect(nonpriceUniV2NonFiatCollateral.refresh()).to.be.reverted
      expect(await nonpriceUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Reverts with a feed with zero price
      const invalidpriceUniV2NonFiatCollateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>(
        await (
          await ethers.getContractFactory('UniV2NonFiatCollateral', {
            libraries: { OracleLib: oracleLib.address },
          })
        ).deploy(
          UniV2PairMock.address,
          fp('1'),
          config.rTokenMaxTradeVolume,
          delayUntilDefault,
          mockChainlinkFeedA.address,
          mockChainlinkFeedB.address,
          ethers.utils.formatBytes32String(unitName),
          defaultThreshold,
          ORACLE_TIMEOUT
        )
      )

      await setOraclePriceUniV2({
        univ2Addr: invalidpriceUniV2NonFiatCollateral.address,
        priceA: bn(0),
      })

      // Reverts with zero price A
      await expect(invalidpriceUniV2NonFiatCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceUniV2NonFiatCollateral.refresh()
      expect(await invalidpriceUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      await setOraclePriceUniV2({
        univ2Addr: invalidpriceUniV2NonFiatCollateral.address,
        priceB: bn(0),
      })

      // Reverts with zero price B
      await expect(invalidpriceUniV2NonFiatCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceUniV2NonFiatCollateral.refresh()
      expect(await invalidpriceUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      await setOraclePriceUniV2({
        univ2Addr: invalidpriceUniV2NonFiatCollateral.address,
        priceA: bn(0),
        priceB: bn(0),
      })

      // Reverts with zero price A and B
      await expect(invalidpriceUniV2NonFiatCollateral.strictPrice()).to.be.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status IFFY
      await invalidpriceUniV2NonFiatCollateral.refresh()
      expect(await invalidpriceUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      // back to valid prices
      await setOraclePriceUniV2({
        univ2Addr: invalidpriceUniV2NonFiatCollateral.address,
        priceA: bn('1e6'),
        priceB: fp('1850'),
      })

      // Reverts with zero price A and B
      await expect(invalidpriceUniV2NonFiatCollateral.strictPrice()).to.not.revertedWith(
        'PriceOutsideRange()'
      )

      // Refresh should mark status back to SOUND
      await invalidpriceUniV2NonFiatCollateral.refresh()
      expect(await invalidpriceUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  })

  // Note: Here the idea is to test all possible statuses and check all possible paths to default
  // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
  // soft default = SOUND -> IFFY -> SOUND due to misbehavior end
  // hard default = SOUND -> DISABLED due to an invariant violation
  // This may require to deploy some mocks to be able to force some of these situations
  describe('Collateral Status', () => {
    // Test for soft default
    it('Updates status in case of soft default on price A / price B to ratio ', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2NonFiatCollateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>await (
        await ethers.getContractFactory('UniV2NonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        fp('1'),
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        ethers.utils.formatBytes32String(unitName),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Modify prices so ratio soft defaults
      await setOraclePriceUniV2({
        univ2Addr: newUniV2NonFiatCollateral.address,
        priceA: bn('1e6'),
        priceB: fp('1200'),
      })

      // Force updates - Should update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh())
        .to.emit(newUniV2NonFiatCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // UniV2Token
      const prevWhenDefault: BigNumber = await newUniV2NonFiatCollateral.whenDefault()
      await expect(newUniV2NonFiatCollateral.refresh()).to.not.emit(
        newUniV2NonFiatCollateral,
        'CollateralStatusChanged'
      )
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Updates status in case of soft default on ratio', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      // and an invalidPair

      //at first valid ratio 1:1850
      await InvalidPairV2.setReserves(bn('1850e6'), fp('1'), bn('1e18'))
      const newUniV2NonFiatCollateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>await (
        await ethers.getContractFactory('UniV2NonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        InvalidPairV2.address,
        fp('1'),
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        ethers.utils.formatBytes32String(unitName),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Set prices
      await setOraclePriceUniV2({
        univ2Addr: newUniV2NonFiatCollateral.address,
        priceA: bn('1e6'),
        priceB: fp('1850'),
      })

      // Force updates - Should not update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh()).to.not.emit(
        newUniV2NonFiatCollateral,
        'CollateralStatusChanged'
      )
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // set invalid reserves ratio, modify L so refPerTock still increases
      await InvalidPairV2.setReserves(bn('1200e6'), fp('1'), bn('1e17'))

      // Force updates - Should update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh())
        .to.emit(newUniV2NonFiatCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward past delayUntilDefault
      await advanceTime(Number(delayUntilDefault))
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.DISABLED)

      // Nothing changes if attempt to refresh after default
      // UniV2Token
      const prevWhenDefault: BigNumber = await newUniV2NonFiatCollateral.whenDefault()
      await expect(newUniV2NonFiatCollateral.refresh()).to.not.emit(
        newUniV2NonFiatCollateral,
        'CollateralStatusChanged'
      )
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.DISABLED)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(prevWhenDefault)
    })

    it('Can revert to SOUND status in case of soft default on price A and B', async () => {
      //at first valid ratio 1:1850
      await InvalidPairV2.setReserves(bn('1850e6'), fp('1'), bn('1e18'))

      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      const newUniV2NonFiatCollateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>await (
        await ethers.getContractFactory('UniV2NonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        InvalidPairV2.address,
        fp('1'),
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        ethers.utils.formatBytes32String(unitName),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // correct prices
      await setOraclePriceUniV2({
        univ2Addr: newUniV2NonFiatCollateral.address,
        priceA: bn('1e6'),
        priceB: fp('1850'),
      })

      // Check initial state
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)

      // change prices
      await setOraclePriceUniV2({
        univ2Addr: newUniV2NonFiatCollateral.address,
        priceA: bn('1.2e6'),
        priceB: fp('1200'),
      })
      // Force updates - Should update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh())
        .to.emit(newUniV2NonFiatCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward before delayUntilDefault
      await advanceTime(Number(delayUntilDefault) - 10)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      // back to correct prices
      await setOraclePriceUniV2({
        univ2Addr: newUniV2NonFiatCollateral.address,
        priceA: bn('1e6'),
        priceB: fp('1850'),
      })
      // back to normal
      // Force updates - Should update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh())
        .to.emit(newUniV2NonFiatCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)
    })

    it('Can revert to SOUND status in case of soft default on ratio', async () => {
      // Redeploy plugin using a Chainlink mock feed where we can change the priceA and priceB
      // and an invalidPair

      //at first valid ratio 1:1
      await InvalidPairV2.setReserves(bn('1850e6'), fp('1'), bn('1e18'))
      const newUniV2NonFiatCollateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>await (
        await ethers.getContractFactory('UniV2NonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        InvalidPairV2.address,
        fp('1'),
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        ethers.utils.formatBytes32String(unitName),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Force updates - Should not update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh()).to.not.emit(
        newUniV2NonFiatCollateral,
        'CollateralStatusChanged'
      )
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

      // change prices
      await setOraclePriceUniV2({
        univ2Addr: newUniV2NonFiatCollateral.address,
        priceA: bn('1.2e6'),
        priceB: fp('1200'),
      })

      // Force updates - Should update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh())
        .to.emit(newUniV2NonFiatCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
        delayUntilDefault
      )
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      // Move time forward before delayUntilDefault
      await advanceTime(Number(delayUntilDefault) - 10)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.IFFY)

      // back to good ratio adpat L for non decreasing
      await InvalidPairV2.setReserves(bn('1200e6'), fp('1.2'), bn('9e10'))
      // Force updates - Should update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh())
        .to.emit(newUniV2NonFiatCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.IFFY, CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)
    })

    // Test for hard default
    it('Updates status in case of hard default and persist in hard default state', async () => {
      // Note: In this case requires to use a InvalidPairV2 mock to be able to change the rate
      //at first valid ratio 1850:1
      await InvalidPairV2.setReserves(bn('1850e6'), fp('1'), bn('1e18'))
      const newUniV2NonFiatCollateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>await (
        await ethers.getContractFactory('UniV2NonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        InvalidPairV2.address,
        fp('1'),
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        mockChainlinkFeedA.address,
        mockChainlinkFeedB.address,
        ethers.utils.formatBytes32String(unitName),
        defaultThreshold,
        ORACLE_TIMEOUT
      )

      // Check initial state
      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)

      // Decrease rate for sqrt(x*y)/L = sqrt(1850*1)/2  < sqrt(1850*1)/1
      await InvalidPairV2.setReserves(bn('1850e6'), fp('1'), bn('2e18'))

      // Force updates - Should update whenDefault and status
      await expect(newUniV2NonFiatCollateral.refresh())
        .to.emit(newUniV2NonFiatCollateral, 'CollateralStatusChanged')
        .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.DISABLED)
      const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
      expect(await newUniV2NonFiatCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

      //Cannot go back sqrt(x*y)/L = sqrt(2000*1)/1 > sqrt(1850*1)/2
      await InvalidPairV2.setReserves(bn('2000e6'), fp('1'), bn('1e18'))
      await expect(newUniV2NonFiatCollateral.refresh()).to.not.emit(
        newUniV2NonFiatCollateral,
        'CollateralStatusChanged'
      )

      expect(await newUniV2NonFiatCollateral.status()).to.equal(CollateralStatus.DISABLED)
    })

    it('Reverts if any oracle reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeedA: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
      )

      const invalidChainlinkFeedB: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(18, fp('1'))
      )

      const invalidUniV2Collateral: UniV2NonFiatCollateral = <UniV2NonFiatCollateral>await (
        await ethers.getContractFactory('UniV2NonFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        UniV2PairMock.address,
        fp('1'),
        config.rTokenMaxTradeVolume,
        delayUntilDefault,
        invalidChainlinkFeedA.address,
        invalidChainlinkFeedB.address,
        ethers.utils.formatBytes32String(unitName),
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

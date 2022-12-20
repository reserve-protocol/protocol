import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { useEnv } from '#/utils/env'
import { expect } from 'chai'
import { ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import {
  IConfig,
  IGovParams,
  IRTokenConfig,
  IRTokenSetup,
  IRevenueShare,
  networkConfig,
} from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import {
  Asset,
  CTokenFiatCollateral,
  CTokenMarket,
  ComptrollerMock,
  ERC20Mock,
  FacadeRead,
  FacadeWrite,
  MockV3Aggregator,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  RTokenMaker,
  FiatCollateral,
  ZeroExMarket,
  IAssetRegistry,
  IBasketHandler,
  RTokenAsset,
  TestIBackingManager,
  FacadeTest,
  ICToken,
} from '../../../typechain'
import { ORACLE_ERROR, ORACLE_TIMEOUT, PRICE_TIMEOUT } from '../../fixtures'
import { whileImpersonating } from '../../utils/impersonation'
import { defaultFixture } from './fixtures'
import { get0xSwap } from '../utils'
import { expectInIndirectReceipt } from '#/common/events'

const abi = ethers.utils.defaultAbiCoder
const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderDAI = '0x075e72a5edf65f0a5f44699c7654c1a76941ddc8'

// const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK_LATEST') ? describe : describe.skip
const PROTO_IMPL = useEnv('PROTO_IMPL')

describeFork(`RTokenMaker for RTokenP${PROTO_IMPL}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let dai: ERC20Mock
  let daiCollateral: FiatCollateral
  let cDai: ICToken
  let cDaiCollateral: CTokenFiatCollateral
  let compToken: ERC20Mock
  let compAsset: Asset
  let comptroller: ComptrollerMock
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

  type MarketCall = Parameters<typeof RTokenMaker.prototype.issue>[4][0]
  let rTokenMaker: RTokenMaker
  let cTokenMarket: CTokenMarket
  let zeroExMarket: ZeroExMarket

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

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let chainId: number

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

    rTokenMaker = <RTokenMaker>await (await ethers.getContractFactory('RTokenMaker')).deploy()
    cTokenMarket = <CTokenMarket>await (await ethers.getContractFactory('CTokenMarket')).deploy()
    zeroExMarket = <ZeroExMarket>await (await ethers.getContractFactory('ZeroExMarket')).deploy()

    await rTokenMaker
      .connect(owner)
      .setApprovedTargets([cTokenMarket.address, zeroExMarket.address], [true, true])

    // Get required contracts for cDAI
    // COMP token
    compToken = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.COMP || '')
    )
    // Compound Comptroller
    comptroller = await ethers.getContractAt(
      'ComptrollerMock',
      networkConfig[chainId].COMPTROLLER || ''
    )

    // Create COMP asset
    compAsset = <Asset>(
      await (
        await ethers.getContractFactory('Asset')
      ).deploy(
        PRICE_TIMEOUT,
        networkConfig[chainId].chainlinkFeeds.COMP || '',
        ORACLE_ERROR,
        compToken.address,
        config.rTokenMaxTradeVolume,
        ORACLE_TIMEOUT
      )
    )

    // DAI token
    dai = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI || '')
    )
    // Deploy collateral plugins
    daiCollateral = <FiatCollateral>await (
      await ethers.getContractFactory('FiatCollateral')
    ).deploy({
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
      oracleError: ORACLE_ERROR,
      erc20: dai.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold,
      delayUntilDefault,
    })
    await whileImpersonating(holderDAI, async (daiSigner) => {
      await dai.connect(daiSigner).transfer(addr1.address, bn('200000e18'))
    })

    // cDAI token
    cDai = <ICToken>await ethers.getContractAt('ICToken', networkConfig[chainId].tokens.cDAI || '')
    cDaiCollateral = <CTokenFiatCollateral>await (
      await ethers.getContractFactory('CTokenFiatCollateral')
    ).deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
        oracleError: ORACLE_ERROR,
        erc20: cDai.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      comptroller.address
    )

    // Set parameters
    const rTokenConfig: IRTokenConfig = {
      name: 'rCDAI',
      symbol: 'rCDAI',
      mandate: 'mandate',
      params: config,
    }

    // Set primary basket
    const rTokenSetup: IRTokenSetup = {
      assets: [compAsset.address],
      primaryBasket: [daiCollateral.address, cDaiCollateral.address],
      weights: [fp('0.2'), fp('0.8')],
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  })

  describe('issue', () => {
    it('will not make calls to unauthorized targets', async () => {
      const amountIn = bn('10000e18')
      await dai.connect(addr1).approve(rTokenMaker.address, amountIn)

      const minAmountOut = amountIn.mul(9999).div(10000)
      await expect(
        rTokenMaker
          .connect(addr1)
          .issue(addr1.address, dai.address, amountIn, rToken.address, minAmountOut, [
            {
              fromToken: dai.address,
              amountIn: bn('8000e18'),
              toToken: cDai.address,
              minAmountOut: bn('8000e18'),
              target: '0x4242424242424242424242424242424242424242',
              value: 0,
              data: '0x',
            },
          ])
      ).to.be.revertedWith('TargetNotApproved')
    })

    it('will revert upon insufficient input', async () => {
      await expect(
        rTokenMaker.connect(addr1).issue(addr1.address, dai.address, 0, rToken.address, 0, [
          {
            fromToken: dai.address,
            amountIn: 0,
            toToken: cDai.address,
            minAmountOut: 0,
            value: 0,
            target: cTokenMarket.address,
            data: '0x',
          },
        ])
      ).to.be.revertedWith('InsufficientInput')
    })

    it('will revert upon insufficient output of a market call', async () => {
      const amountIn = bn('10000e18')
      await dai.connect(addr1).approve(rTokenMaker.address, amountIn)

      const [, [daiShares, cDaiShares]] = await facade.callStatic.basketBreakdown(rToken.address)
      const totalShares = daiShares.add(cDaiShares)

      const minAmountOut = amountIn.add(42)
      await expect(
        rTokenMaker
          .connect(addr1)
          .issue(addr1.address, dai.address, amountIn, rToken.address, minAmountOut, [
            {
              fromToken: dai.address,
              amountIn: amountIn.mul(cDaiShares).div(totalShares),
              toToken: cDai.address,
              minAmountOut: amountIn.mul(cDaiShares).div(totalShares).add(42),
              value: 0,
              target: cTokenMarket.address,
              data: '0x',
            },
          ])
      ).to.be.revertedWith('InsufficientOutput')
    })

    it('will revert upon insufficient output of the issuance', async () => {
      const amountIn = bn('10000e18')
      await dai.connect(addr1).approve(rTokenMaker.address, amountIn)

      const [, [daiShares, cDaiShares]] = await facade.callStatic.basketBreakdown(rToken.address)
      const totalShares = daiShares.add(cDaiShares)

      const minAmountOut = amountIn.add(42)
      await expect(
        rTokenMaker
          .connect(addr1)
          .issue(addr1.address, dai.address, amountIn, rToken.address, minAmountOut, [
            {
              fromToken: dai.address,
              amountIn: amountIn.mul(cDaiShares).div(totalShares),
              toToken: cDai.address,
              minAmountOut: 0,
              value: 0,
              target: cTokenMarket.address,
              data: '0x',
            },
          ])
      ).to.be.revertedWith('InsufficientOutput')
    })

    it('can zap in DAI', async () => {
      const amountIn = bn('10000e18')
      await dai.connect(addr1).approve(rTokenMaker.address, amountIn)

      const [, [daiShares, cDaiShares]] = await facade.callStatic.basketBreakdown(rToken.address)
      const totalShares = daiShares.add(cDaiShares)

      const minAmountOut = amountIn.mul(99999).div(100000)
      await rTokenMaker
        .connect(addr1)
        .issue(addr1.address, dai.address, amountIn, rToken.address, minAmountOut, [
          {
            target: cTokenMarket.address,
            value: 0,
            data: '0x',
            fromToken: dai.address,
            amountIn: amountIn.mul(cDaiShares).div(totalShares),
            toToken: cDai.address,
            minAmountOut: 0,
          },
        ])

      expect(await rToken.balanceOf(addr1.address)).to.be.above(minAmountOut)
    })

    it('can zap in ETH', async () => {
      const amountIn = bn('1e18')

      const [, [daiShares, cDaiShares]] = await facade.callStatic.basketBreakdown(rToken.address)
      const totalShares = daiShares.add(cDaiShares)

      const quote = await get0xSwap('quote', {
        sellToken: 'ETH',
        sellAmount: amountIn.toString(),
        buyToken: 'DAI',
        slippagePercentage: 0.03,
        takerAddress: rTokenMaker.address,
      })

      const minRTokenOut = bn(quote.buyAmount).mul(99999).div(100000)

      await rTokenMaker.connect(addr1).issue(
        addr1.address,
        await rTokenMaker.ETH(),
        amountIn,
        rToken.address,
        minRTokenOut,
        [
          {
            target: zeroExMarket.address,
            value: quote.value,
            fromToken: quote.sellTokenAddress,
            amountIn: amountIn,
            toToken: dai.address,
            minAmountOut: bn(quote.buyAmount),
            data: quote.data,
          },
          {
            target: cTokenMarket.address,
            value: 0,
            fromToken: dai.address,
            amountIn: bn(quote.buyAmount).mul(cDaiShares).div(totalShares),
            toToken: cDai.address,
            minAmountOut: 0,
            data: '0x',
          },
        ],
        { value: quote.value }
      )
    })
  })

  describe('redeem', () => {
    const daiAmountIn = bn('10000e18') // instant issuance
    const rTokenAmount = daiAmountIn.mul(99999).div(100000)

    beforeEach(async () => {
      const [, [daiShares, cDaiShares]] = await facade.callStatic.basketBreakdown(rToken.address)
      const totalShares = daiShares.add(cDaiShares)

      await dai.connect(addr1).approve(rTokenMaker.address, daiAmountIn)

      await rTokenMaker
        .connect(addr1)
        .issue(addr1.address, dai.address, daiAmountIn, rToken.address, rTokenAmount, [
          {
            fromToken: dai.address,
            amountIn: daiAmountIn.mul(cDaiShares).div(totalShares),
            toToken: cDai.address,
            minAmountOut: 0,
            value: 0,
            target: cTokenMarket.address,
            data: '0x',
          },
        ])

      await rToken.connect(addr1).approve(rTokenMaker.address, rTokenAmount)
    })
  })
})

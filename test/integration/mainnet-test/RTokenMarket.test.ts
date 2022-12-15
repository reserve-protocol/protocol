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
  CTokenMock,
  ComptrollerMock,
  ERC20Mock,
  FacadeRead,
  FacadeWrite,
  MockV3Aggregator,
  TestIDeployer,
  TestIMain,
  TestIRToken,
  RTokenMarket,
  FiatCollateral,
  ZeroExMarket,
} from '../../../typechain'
import { ORACLE_ERROR, PRICE_TIMEOUT } from '../../fixtures'
import { whileImpersonating } from '../../utils/impersonation'
import { ORACLE_TIMEOUT, defaultFixture } from '../assets/fixtures'
import { get0xSwap } from '../utils'

const abi = ethers.utils.defaultAbiCoder
const createFixtureLoader = waffle.createFixtureLoader

// Holder address in Mainnet
const holderCDAI = '0x01ec5e7e03e2835bb2d1ae8d2edded298780129c'
const holderDAI = '0x075e72a5edf65f0a5f44699c7654c1a76941ddc8'

// const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = useEnv('FORK') ? describe : describe.skip

describeFork('RTokenMarket', function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Tokens/Assets
  let dai: ERC20Mock
  let daiCollateral: FiatCollateral
  let cDai: CTokenMock
  let cDaiCollateral: CTokenFiatCollateral
  let compToken: ERC20Mock
  let compAsset: Asset
  let comptroller: ComptrollerMock

  // Core Contracts
  let main: TestIMain
  let rToken: TestIRToken

  let deployer: TestIDeployer
  let facade: FacadeRead
  let facadeWrite: FacadeWrite
  let govParams: IGovParams

  let rTokenMarket: RTokenMarket
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
    ;({ deployer, facade, facadeWrite, govParams } = await loadFixture(defaultFixture))

    rTokenMarket = <RTokenMarket>(
      await (await ethers.getContractFactory('RTokenMarket')).deploy(facade.address)
    )
    cTokenMarket = <CTokenMarket>await (await ethers.getContractFactory('CTokenMarket')).deploy()
    zeroExMarket = <ZeroExMarket>await (await ethers.getContractFactory('ZeroExMarket')).deploy()

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
      market: zeroExMarket.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold,
      delayUntilDefault,
    })
    await whileImpersonating(holderDAI, async (daiSigner) => {
      await dai.connect(daiSigner).transfer(addr1.address, bn('2000000e18'))
    })

    // cDAI token
    cDai = <CTokenMock>(
      await ethers.getContractAt('CTokenMock', networkConfig[chainId].tokens.cDAI || '')
    )
    cDaiCollateral = <CTokenFiatCollateral>await (
      await ethers.getContractFactory('CTokenFiatCollateral')
    ).deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI as string,
        oracleError: ORACLE_ERROR,
        erc20: cDai.address,
        market: cTokenMarket.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
      },
      comptroller.address
    )
    await whileImpersonating(holderCDAI, async (cdaiSigner) => {
      await cDai.connect(cdaiSigner).transfer(addr1.address, toBNDecimals(bn('2000000e18'), 8))
    })

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
    await (await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)).wait()

    // Get core contracts
    rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())

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

  describe('enter', () => {
    it('can enter with DAI', async () => {
      const amountIn = bn('10000e18')
      const rTokenAmount = amountIn
      const [, [daiShares, cDaiShares]] = await facade.callStatic.basketBreakdown(rToken.address)
      const totalShares = daiShares.add(cDaiShares)

      const swapAmountIns = [daiShares, cDaiShares].map((shares) =>
        amountIn.mul(shares).div(totalShares)
      )
      const swapCallDatas = ['', ''] // no 0x swaps
      const swapCallData = abi.encode(['uint256[]', 'bytes[]'], [swapAmountIns, swapCallDatas])

      await dai.connect(addr1).approve(rTokenMarket.address, rTokenAmount)
      await rTokenMarket
        .connect(addr1)
        .enter(
          dai.address,
          rTokenAmount,
          rToken.address,
          rTokenAmount,
          ZERO_ADDRESS,
          swapCallData,
          addr1.address
        )

      expect(await rToken.balanceOf(addr1.address)).to.eq(rTokenAmount)
    })

    it('can enter with ETH', async () => {
      const amountIn = bn('10e18') // 10 ETH

      const [, [daiShares, cDaiShares]] = await facade.callStatic.basketBreakdown(rToken.address)
      const totalShares = daiShares.add(cDaiShares)

      const swapAmountIns = [daiShares, cDaiShares].map((shares) =>
        amountIn.mul(shares).div(totalShares)
      )

      const swapCallDatas = await Promise.all(
        swapAmountIns.map((amount) =>
          get0xSwap('quote', {
            buyToken: 'DAI',
            sellToken: 'ETH',
            sellAmount: amount.toNumber(),
          })
        )
      )
      const swapCallData = abi.encode(['uint256[]', 'bytes[]'], [swapAmountIns, swapCallDatas])

      await rTokenMarket
        .connect(addr1)
        .enter(
          ZERO_ADDRESS,
          amountIn,
          rToken.address,
          1,
          swapCallDatas[0].to,
          swapCallData,
          addr1.address
        )

      expect(await rToken.balanceOf(addr1.address)).to.be.greaterThan(1)
    })
  })

  describe('exit', () => {
    it('can exit to DAI')

    it('can exit to ETH')
  })
})

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, BigNumberish, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { Collateral, IMPLEMENTATION } from '../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from './fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, MAX_ORACLE_TIMEOUT, networkConfig } from '../../common/configuration'
import { CollateralStatus, ZERO_ADDRESS, BN_SCALE_FACTOR } from '../../common/constants'
import { expectEvents } from '../../common/events'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import { advanceBlocks, advanceTime } from '../utils/time'
import { whileImpersonating } from '../utils/impersonation'
import { setOraclePrice } from '../utils/oracles'
import forkBlockNumber from './fork-block-numbers'
import {
  Asset,
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  CTokenNonFiatCollateral,
  CTokenSelfReferentialCollateral,
  ERC20Mock,
  EURFiatCollateral,
  FacadeRead,
  FacadeTest,
  FiatCollateral,
  IAToken,
  IERC20,
  IAssetRegistry,
  IBasketHandler,
  OracleLib,
  MockV3Aggregator,
  NonFiatCollateral,
  RTokenAsset,
  SelfReferentialCollateral,
  StaticATokenLM,
  TestIBackingManager,
  TestIMain,
  TestIRToken,
  USDCMock,
  WETH9,
  UniswapV3Wrapper,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
// DAI, cDAI, and aDAI Holders
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderCDAI = '0x01ec5e7e03e2835bb2d1ae8d2edded298780129c'
const holderADAI = '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296'
const holderUSDT = '0xf977814e90da44bfa03b6295a0616a897441acec'

// Complex Basket holders
const holderWBTC = '0xbf72da2bd84c5170618fbe5914b0eca9638d5eb5'
const holdercWBTC = '0x7132ad0a72b5ba50bdaa005fad19caae029ae699'
const holderWETH = '0xf04a5cc80b1e94c69b48f5ee68a08cd2f09a7c3e'
const holdercETH = '0x10d88638be3c26f3a47d861b8b5641508501035d'
const holderEURT = '0x5754284f345afc66a98fbb0a0afe71e0f007b949'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

let owner: SignerWithAddress

const describeFork = process.env.FORK ? describe : describe.skip

const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const point1Pct = (value: BigNumber): BigNumber => {
  return value.div(1000)
}



describeFork(`Asset Plugins - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Assets
  let collateral: Collateral[]

  let compToken: ERC20Mock
  let compAsset: Asset
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock
  let aaveAsset: Asset

  // Tokens and Assets
  let dai: ERC20Mock
  let usdc: USDCMock
  let usdt: ERC20Mock
  let busd: ERC20Mock
  let usdp: ERC20Mock
  let tusd: ERC20Mock

  let aDai: IAToken
  let aUsdc: IAToken
  let aUsdt: IAToken
  let aBusd: IAToken
  let aUsdp: IAToken
  let stataDai: StaticATokenLM
  let stataUsdc: StaticATokenLM
  let stataUsdt: StaticATokenLM
  let stataBusd: StaticATokenLM
  let stataUsdp: StaticATokenLM

  let cDai: CTokenMock
  let cUsdc: CTokenMock
  let cUsdt: CTokenMock
  let cUsdp: CTokenMock

  let wbtc: ERC20Mock
  let cWBTC: CTokenMock
  let weth: ERC20Mock
  let cETH: CTokenMock
  let eurt: ERC20Mock

  let daiCollateral: FiatCollateral
  let usdcCollateral: FiatCollateral
  let usdtCollateral: FiatCollateral
  let busdCollateral: FiatCollateral
  let usdpCollateral: FiatCollateral
  let tusdCollateral: FiatCollateral

  let aDaiCollateral: ATokenFiatCollateral
  let aUsdcCollateral: ATokenFiatCollateral
  let aUsdtCollateral: ATokenFiatCollateral
  let aBusdCollateral: ATokenFiatCollateral
  let aUsdpCollateral: ATokenFiatCollateral

  let cDaiCollateral: CTokenFiatCollateral
  let cUsdcCollateral: CTokenFiatCollateral
  let cUsdtCollateral: CTokenFiatCollateral
  let cUsdpCollateral: CTokenFiatCollateral

  let wbtcCollateral: NonFiatCollateral
  let cWBTCCollateral: CTokenNonFiatCollateral
  let wethCollateral: SelfReferentialCollateral
  let cETHCollateral: CTokenSelfReferentialCollateral
  let eurtCollateral: EURFiatCollateral

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let main: TestIMain
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let config: IConfig
  let oracleLib: OracleLib

  // Factories
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  let initialBal: BigNumber
  let initialBalBtcEth: BigNumber
  let basket: Collateral[]
  let erc20s: IERC20[]

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let chainId: number

  describe('Assets/Collateral', () => {
    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[owner, addr1, addr2] = await ethers.getSigners()
        ; ({
          rsr,
          rsrAsset,
          compToken,
          aaveToken,
          compAsset,
          aaveAsset,
          compoundMock,
          erc20s,
          collateral,
          basket,
          main,
          assetRegistry,
          backingManager,
          basketHandler,
          rToken,
          rTokenAsset,
          facade,
          facadeTest,
          config,
          oracleLib,
        } = await loadFixture(defaultFixture))

      // Get tokens
      dai = <ERC20Mock>erc20s[0] // DAI
      usdc = <ERC20Mock>erc20s[1] // USDC
      usdt = <ERC20Mock>erc20s[2] // USDT
      busd = <ERC20Mock>erc20s[3] // BUSD
      usdp = <ERC20Mock>erc20s[4] // USDP
      tusd = <ERC20Mock>erc20s[5] // TUSD
      cDai = <CTokenMock>erc20s[6] // cDAI
      cUsdc = <CTokenMock>erc20s[7] // cUSDC
      cUsdt = <CTokenMock>erc20s[8] // cUSDT
      cUsdp = <CTokenMock>erc20s[9] // cUSDT
      stataDai = <StaticATokenLM>erc20s[10] // static aDAI
      stataUsdc = <StaticATokenLM>erc20s[11] // static aUSDC
      stataUsdt = <StaticATokenLM>erc20s[12] // static aUSDT
      stataBusd = <StaticATokenLM>erc20s[13] // static aBUSD
      stataUsdp = <StaticATokenLM>erc20s[14] // static aUSDP
      wbtc = <ERC20Mock>erc20s[15] // wBTC
      cWBTC = <CTokenMock>erc20s[16] // cWBTC
      weth = <ERC20Mock>erc20s[17] // wETH
      cETH = <CTokenMock>erc20s[18] // cETH
      eurt = <ERC20Mock>erc20s[19] // eurt

      // Get plain aTokens
      aDai = <IAToken>(
        await ethers.getContractAt(
          'contracts/plugins/aave/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aDAI || ''
        )
      )

      aUsdc = <IAToken>(
        await ethers.getContractAt(
          'contracts/plugins/aave/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aUSDC || ''
        )
      )
      aUsdt = <IAToken>(
        await ethers.getContractAt(
          'contracts/plugins/aave/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aUSDT || ''
        )
      )
      aBusd = <IAToken>(
        await ethers.getContractAt(
          'contracts/plugins/aave/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aBUSD || ''
        )
      )

      aUsdp = <IAToken>(
        await ethers.getContractAt(
          'contracts/plugins/aave/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aUSDP || ''
        )
      )
      // Get collaterals
      daiCollateral = <FiatCollateral>collateral[0] // DAI
      usdcCollateral = <FiatCollateral>collateral[1] // USDC
      usdtCollateral = <FiatCollateral>collateral[2] // USDT
      busdCollateral = <FiatCollateral>collateral[3] // BUSD
      usdpCollateral = <FiatCollateral>collateral[4] // USDP
      tusdCollateral = <FiatCollateral>collateral[5] // TUSD
      cDaiCollateral = <CTokenFiatCollateral>collateral[6] // cDAI
      cUsdcCollateral = <CTokenFiatCollateral>collateral[7] // cUSDC
      cUsdtCollateral = <CTokenFiatCollateral>collateral[8] // cUSDT
      cUsdpCollateral = <CTokenFiatCollateral>collateral[9] // cUSDP
      aDaiCollateral = <ATokenFiatCollateral>collateral[10] // aDAI
      aUsdcCollateral = <ATokenFiatCollateral>collateral[11] // aUSDC
      aUsdtCollateral = <ATokenFiatCollateral>collateral[12] // aUSDT
      aBusdCollateral = <ATokenFiatCollateral>collateral[13] // aBUSD
      aUsdpCollateral = <ATokenFiatCollateral>collateral[14] // aUSDP
      wbtcCollateral = <NonFiatCollateral>collateral[15] // wBTC
      cWBTCCollateral = <CTokenNonFiatCollateral>collateral[16] // cWBTC
      wethCollateral = <SelfReferentialCollateral>collateral[17] // wETH
      cETHCollateral = <CTokenSelfReferentialCollateral>collateral[18] // cETH
      eurtCollateral = <EURFiatCollateral>collateral[19] // EURT

      // Get assets and tokens for default basket
      daiCollateral = <FiatCollateral>basket[0]
      aDaiCollateral = <ATokenFiatCollateral>basket[1]
      cDaiCollateral = <CTokenFiatCollateral>basket[2]

      dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await daiCollateral.erc20())
      stataDai = <StaticATokenLM>(
        await ethers.getContractAt('StaticATokenLM', await aDaiCollateral.erc20())
      )
      cDai = <CTokenMock>await ethers.getContractAt('CTokenMock', await cDaiCollateral.erc20())

      // Get plain aToken
      aDai = <IAToken>(
        await ethers.getContractAt(
          'contracts/plugins/aave/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aDAI || ''
        )
      )

      // Setup balances for addr1 - Transfer from Mainnet holders DAI, cDAI and aDAI (for default basket)
      // DAI
      initialBal = bn('20000e18')
      await whileImpersonating(holderDAI, async (daiSigner) => {
        await dai.connect(daiSigner).transfer(addr1.address, initialBal)
      })
      // aDAI
      await whileImpersonating(holderADAI, async (adaiSigner) => {
        // Wrap ADAI into static ADAI
        await aDai.connect(adaiSigner).transfer(addr1.address, initialBal)
        await aDai.connect(addr1).approve(stataDai.address, initialBal)
        await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, false)
      })
      // cDAI
      await whileImpersonating(holderCDAI, async (cdaiSigner) => {
        await cDai.connect(cdaiSigner).transfer(addr1.address, toBNDecimals(initialBal, 8).mul(100))
      })

      // Setup balances for USDT
      await whileImpersonating(holderUSDT, async (usdtSigner) => {
        await usdt.connect(usdtSigner).transfer(addr1.address, toBNDecimals(initialBal, 6))
      })

      // Setup balances for complex basket
      initialBalBtcEth = bn('10e18')
      // WBTC
      await whileImpersonating(holderWBTC, async (wbtcSigner) => {
        await wbtc.connect(wbtcSigner).transfer(addr1.address, toBNDecimals(initialBalBtcEth, 8))
      })

      // cWBTC
      await whileImpersonating(holdercWBTC, async (cwbtcSigner) => {
        await cWBTC
          .connect(cwbtcSigner)
          .transfer(addr1.address, toBNDecimals(initialBalBtcEth, 8).mul(1000))
      })

      // WETH
      await whileImpersonating(holderWETH, async (wethSigner) => {
        await weth.connect(wethSigner).transfer(addr1.address, initialBalBtcEth)
      })

      //  cWETH
      await whileImpersonating(holdercETH, async (cethSigner) => {
        await cETH
          .connect(cethSigner)
          .transfer(addr1.address, toBNDecimals(initialBalBtcEth, 8).mul(1000))
      })

      //EURT
      await whileImpersonating(holderEURT, async (eurtSigner) => {
        await eurt
          .connect(eurtSigner)
          .transfer(addr1.address, toBNDecimals(initialBalBtcEth, 6).mul(1000))
      })

      // Setup factories
      MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    })

    it('Huy passed', async () => {

      // USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      // USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',  

      type TMintParams = {
        token0: string;
        token1: string;
        fee: BigNumberish;
        tickLower: BigNumberish;
        tickUpper: BigNumberish;
        amount0Desired: BigNumberish;
        amount1Desired: BigNumberish;
        amount0Min: BigNumberish;
        amount1Min: BigNumberish;
        recipient: string;
        deadline: BigNumberish;
      }

      let mintParams: TMintParams = {
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        fee: 500,
        tickLower: 2,
        tickUpper: 300,
        amount0Desired: 200,
        amount1Desired: 100,
        amount0Min: 0,
        amount1Min: 0,
        recipient: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // rewrite in constructor
        deadline: 0 //rewrite in constructor
      }

      const nonpriceAsset: UniswapV3Wrapper = <UniswapV3Wrapper>(
        await (
          await ethers.getContractFactory('UniswapV3Wrapper')
        ).deploy(
          mintParams,
          "Huy",
          "HUY"
        )
      )
    })


  })
})

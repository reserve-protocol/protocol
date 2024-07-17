import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import {
  Collateral,
  IMPLEMENTATION,
  ORACLE_ERROR,
  DECAY_DELAY,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from '../fixtures'
import { defaultFixtureNoBasket } from './fixtures'
import { getChainId } from '../../common/blockchain-utils'
import { IConfig, MAX_ORACLE_TIMEOUT, networkConfig } from '../../common/configuration'
import { CollateralStatus, BN_SCALE_FACTOR } from '../../common/constants'
import { expectEvents } from '../../common/events'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import { advanceBlocks, advanceTime } from '../utils/time'
import { whileImpersonating } from '../utils/impersonation'
import {
  expectDecayedPrice,
  expectExactPrice,
  expectPrice,
  expectRTokenPrice,
  expectUnpriced,
  setOraclePrice,
} from '../utils/oracles'
import forkBlockNumber from './fork-block-numbers'
import {
  Asset,
  ATokenFiatCollateral,
  CTokenFiatCollateral,
  CTokenMock,
  CTokenNonFiatCollateral,
  CTokenSelfReferentialCollateral,
  ERC20Mock,
  EURFiatCollateral,
  FacadeTest,
  FiatCollateral,
  IAToken,
  IERC20,
  IAssetRegistry,
  MockV3Aggregator,
  NonFiatCollateral,
  RTokenAsset,
  SelfReferentialCollateral,
  StaticATokenLM,
  TestIBackingManager,
  TestIBasketHandler,
  TestIFacade,
  TestIMain,
  TestIRToken,
  USDCMock,
  WETH9,
} from '../../typechain'
import { useEnv } from '#/utils/env'

// Relevant addresses (Mainnet)
// DAI, cDAI, and aDAI Holders
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderCDAI = '0x01ec5e7e03e2835bb2d1ae8d2edded298780129c'
const holderADAI = '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296'
const holderUSDT = '0xf977814e90da44bfa03b6295a0616a897441acec'

// Complex Basket holders
const holderWBTC = '0xbf72da2bd84c5170618fbe5914b0eca9638d5eb5'
const holdercWBTC = '0xe84A061897afc2e7fF5FB7e3686717C528617487'
const holderWETH = '0xf04a5cc80b1e94c69b48f5ee68a08cd2f09a7c3e'
const holdercETH = '0x10d88638be3c26f3a47d861b8b5641508501035d'
const holderEURT = '0x5754284f345afc66a98fbb0a0afe71e0f007b949'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

let owner: SignerWithAddress

const describeFork = useEnv('FORK') ? describe : describe.skip

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
  let wethCollateral: FiatCollateral
  let cETHCollateral: CTokenSelfReferentialCollateral
  let eurtCollateral: EURFiatCollateral

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let main: TestIMain
  let facade: TestIFacade
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler
  let config: IConfig

  // Factories
  let MockV3AggregatorFactory: ContractFactory
  let mockChainlinkFeed: MockV3Aggregator

  let initialBal: BigNumber
  let initialBalBtcEth: BigNumber
  let basket: Collateral[]
  let erc20s: IERC20[]

  let chainId: number

  // Setup test environment
  const setup = async (blockNumber: number) => {
    // Use Mainnet fork
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
            blockNumber: blockNumber,
          },
        },
      ],
    })
  }

  describe('Assets/Collateral', () => {
    before(async () => {
      await setup(forkBlockNumber['asset-plugins'])

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[owner, addr1, addr2] = await ethers.getSigners()
      ;({
        rsr,
        rsrAsset,
        compToken,
        aaveToken,
        compAsset,
        aaveAsset,
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
      } = await loadFixture(defaultFixtureNoBasket))

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
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aDAI || ''
        )
      )

      aUsdc = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aUSDC || ''
        )
      )
      aUsdt = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aUSDT || ''
        )
      )
      aBusd = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aBUSD || ''
        )
      )

      aUsdp = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
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
      wethCollateral = <FiatCollateral>collateral[17] // wETH
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

      // Get plain aToken
      aDai = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
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
      mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e10'))
    })

    context('Setup and validation', () => {
      beforeEach(async () => {
        // Setup basket
        await basketHandler
          .connect(owner)
          .setPrimeBasket(
            [dai.address, stataDai.address, cDai.address],
            [fp('0.25'), fp('0.25'), fp('0.5')]
          )
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)
      })

      it('Should setup assets correctly', async () => {
        // COMP Token
        expect(await compAsset.isCollateral()).to.equal(false)
        expect(await compAsset.erc20()).to.equal(compToken.address)
        expect(await compAsset.erc20()).to.equal(networkConfig[chainId].tokens.COMP)
        expect(await compToken.decimals()).to.equal(18)
        await expectPrice(compAsset.address, fp('58.28'), ORACLE_ERROR, true) // Close to $58 USD - June 2022
        await expect(compAsset.claimRewards()).to.not.emit(compAsset, 'RewardsClaimed')
        expect(await compAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

        // stkAAVE Token
        expect(await aaveAsset.isCollateral()).to.equal(false)
        expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
        expect(await aaveAsset.erc20()).to.equal(networkConfig[chainId].tokens.stkAAVE)
        expect(await aaveToken.decimals()).to.equal(18)
        await expectPrice(aaveAsset.address, fp('104.88183739'), ORACLE_ERROR, true) // Close to $104.8 USD - July 2022 - Uses AAVE price
        await expect(aaveAsset.claimRewards()).to.not.emit(aaveAsset, 'RewardsClaimed')
        expect(await aaveAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

        // RSR Token
        expect(await rsrAsset.isCollateral()).to.equal(false)
        expect(await rsrAsset.erc20()).to.equal(rsr.address)
        expect(await rsrAsset.erc20()).to.equal(networkConfig[chainId].tokens.RSR)
        expect(rsr.address).to.equal(networkConfig[chainId].tokens.RSR)
        expect(await rsr.decimals()).to.equal(18)
        await expectPrice(rsrAsset.address, fp('0.0069934'), ORACLE_ERROR, true) // Close to $0.00699
        await expect(rsrAsset.claimRewards()).to.not.emit(rsrAsset, 'RewardsClaimed')
        expect(await rsrAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
      })

      it('Should setup collateral correctly - Fiatcoins', async () => {
        // Define interface required for each fiat coin
        interface TokenInfo {
          token: ERC20Mock
          tokenDecimals: number
          tokenAddress: string
          tokenCollateral: FiatCollateral
          price: BigNumber
        }

        // DAI - USDC - USDT - BUSD
        const tokenInfos: TokenInfo[] = [
          {
            token: dai,
            tokenDecimals: 18,
            tokenAddress: networkConfig[chainId].tokens.DAI || '',
            tokenCollateral: daiCollateral,
            price: fp('1'),
          },
          {
            token: usdc,
            tokenDecimals: 6,
            tokenAddress: networkConfig[chainId].tokens.USDC || '',
            tokenCollateral: usdcCollateral,
            price: fp('1.0003994'),
          },
          {
            token: usdt,
            tokenDecimals: 6,
            tokenAddress: networkConfig[chainId].tokens.USDT || '',
            tokenCollateral: usdtCollateral,
            price: fp('0.99934692'),
          },
          {
            token: busd,
            tokenDecimals: 18,
            tokenAddress: networkConfig[chainId].tokens.BUSD || '',
            tokenCollateral: busdCollateral,
            price: fp('1.00030972'),
          },
          {
            token: usdp,
            tokenDecimals: 18,
            tokenAddress: networkConfig[chainId].tokens.USDP || '',
            tokenCollateral: usdpCollateral,
            price: fp('0.99995491'),
          },
          {
            token: tusd,
            tokenDecimals: 18,
            tokenAddress: networkConfig[chainId].tokens.TUSD || '',
            tokenCollateral: tusdCollateral,
            price: fp('1.00022194'),
          },
        ]

        for (const tkInf of tokenInfos) {
          // Fiat Token Assets
          expect(await tkInf.tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await tkInf.tokenCollateral.isCollateral()).to.equal(true)
          expect(await tkInf.tokenCollateral.erc20()).to.equal(tkInf.token.address)
          expect(await tkInf.tokenCollateral.erc20()).to.equal(tkInf.tokenAddress)
          expect(await tkInf.token.decimals()).to.equal(tkInf.tokenDecimals)
          expect(await tkInf.tokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String('USD')
          )
          expect(await tkInf.tokenCollateral.refPerTok()).to.equal(fp('1'))
          expect(await tkInf.tokenCollateral.targetPerRef()).to.equal(fp('1'))

          await expectPrice(
            tkInf.tokenCollateral.address,
            tkInf.price,
            ORACLE_ERROR,
            true,
            bn('1e5')
          )

          await expect(tkInf.tokenCollateral.claimRewards()).to.not.emit(
            tkInf.tokenCollateral,
            'RewardsClaimed'
          )
          expect(await tkInf.tokenCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
        }
      })

      it('Should setup collateral correctly - CTokens Fiat', async () => {
        // Define interface required for each ctoken
        interface CTokenInfo {
          token: ERC20Mock
          tokenAddress: string
          cToken: CTokenMock
          cTokenAddress: string
          cTokenCollateral: CTokenFiatCollateral
          pegPrice: BigNumber
          refPerTok: BigNumber
        }

        // Compound - cUSDC and cUSDT
        const cTokenInfos: CTokenInfo[] = [
          {
            token: dai,
            tokenAddress: networkConfig[chainId].tokens.DAI || '',
            cToken: cDai,
            cTokenAddress: networkConfig[chainId].tokens.cDAI || '',
            cTokenCollateral: cDaiCollateral,
            pegPrice: fp('1'),
            refPerTok: fp('0.022015108677007985'),
          },
          {
            token: usdc,
            tokenAddress: networkConfig[chainId].tokens.USDC || '',
            cToken: cUsdc,
            cTokenAddress: networkConfig[chainId].tokens.cUSDC || '',
            cTokenCollateral: cUsdcCollateral,
            pegPrice: fp('1.0003994'),
            refPerTok: fp('0.022611941829792900'),
          },
          {
            token: usdt,
            tokenAddress: networkConfig[chainId].tokens.USDT || '',
            cToken: cUsdt,
            cTokenAddress: networkConfig[chainId].tokens.cUSDT || '',
            cTokenCollateral: cUsdtCollateral,
            pegPrice: fp('0.99934692'),
            refPerTok: fp('0.021859813029312800'),
          },
          {
            token: usdp,
            tokenAddress: networkConfig[chainId].tokens.USDP || '',
            cToken: cUsdp,
            cTokenAddress: networkConfig[chainId].tokens.cUSDP || '',
            cTokenCollateral: cUsdpCollateral,
            pegPrice: fp('0.99995491'),
            refPerTok: fp('0.020090037479321573'),
          },
        ]

        for (const ctkInf of cTokenInfos) {
          // CToken
          expect(await ctkInf.cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctkInf.cTokenCollateral.isCollateral()).to.equal(true)
          expect(await ctkInf.cTokenCollateral.referenceERC20Decimals()).to.equal(
            await ctkInf.token.decimals()
          )
          expect(await ctkInf.cToken.decimals()).to.equal(8)
          expect(await ctkInf.cTokenCollateral.erc20()).to.equal(ctkInf.cToken.address)
          expect(await ctkInf.cTokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String('USD')
          )
          expect(await ctkInf.cTokenCollateral.refPerTok()).to.be.closeTo(
            ctkInf.refPerTok,
            fp('0.001')
          )
          expect(await ctkInf.cTokenCollateral.targetPerRef()).to.equal(fp('1'))

          await expectPrice(
            ctkInf.cTokenCollateral.address,
            ctkInf.pegPrice.mul(ctkInf.refPerTok).div(BN_SCALE_FACTOR),
            ORACLE_ERROR,
            true,
            bn('1e4')
          )

          await expect(ctkInf.cTokenCollateral.claimRewards())
            .to.emit(ctkInf.cTokenCollateral, 'RewardsClaimed')
            .withArgs(compToken.address, 0)

          expect(await ctkInf.cTokenCollateral.maxTradeVolume()).to.equal(
            config.rTokenMaxTradeVolume
          )
        }
      })

      it('Should setup collateral correctly - ATokens Fiat', async () => {
        // Define interface required for each aToken
        interface ATokenInfo {
          token: ERC20Mock
          tokenAddress: string
          stataToken: StaticATokenLM
          aToken: IAToken
          aTokenAddress: string
          aTokenCollateral: ATokenFiatCollateral
          pegPrice: BigNumber
          refPerTok: BigNumber
        }

        // aUSDC, aUSDT, and aBUSD
        const aTokenInfos: ATokenInfo[] = [
          {
            token: dai,
            tokenAddress: networkConfig[chainId].tokens.DAI || '',
            stataToken: stataDai,
            aToken: aDai,
            aTokenAddress: networkConfig[chainId].tokens.aDAI || '',
            aTokenCollateral: aDaiCollateral,
            pegPrice: fp('1'),
            refPerTok: fp('1.072871692909066736'),
          },
          {
            token: usdc,
            tokenAddress: networkConfig[chainId].tokens.USDC || '',
            stataToken: stataUsdc,
            aToken: aUsdc,
            aTokenAddress: networkConfig[chainId].tokens.aUSDC || '',
            aTokenCollateral: aUsdcCollateral,
            pegPrice: fp('1.0003994'),
            refPerTok: fp('1.075820226287820705'),
          },
          {
            token: usdt,
            tokenAddress: networkConfig[chainId].tokens.USDT || '',
            stataToken: stataUsdt,
            aToken: aUsdt,
            aTokenAddress: networkConfig[chainId].tokens.aUSDT || '',
            aTokenCollateral: aUsdtCollateral,
            pegPrice: fp('0.99934692'),
            refPerTok: fp('1.088178891886696259'),
          },
          {
            token: busd,
            tokenAddress: networkConfig[chainId].tokens.BUSD || '',
            stataToken: stataBusd,
            aToken: aBusd,
            aTokenAddress: networkConfig[chainId].tokens.aBUSD || '',
            aTokenCollateral: aBusdCollateral,
            pegPrice: fp('1.00030972'),
            refPerTok: fp('1.093996241277203301'),
          },
          {
            token: usdp,
            tokenAddress: networkConfig[chainId].tokens.USDP || '',
            stataToken: stataUsdp,
            aToken: aUsdp,
            aTokenAddress: networkConfig[chainId].tokens.aUSDP || '',
            aTokenCollateral: aUsdpCollateral,
            pegPrice: fp('0.99995491'),
            refPerTok: fp('1.019878722522085537'),
          },
        ]

        for (const atkInf of aTokenInfos) {
          // AToken
          expect(await atkInf.aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await atkInf.aTokenCollateral.isCollateral()).to.equal(true)
          expect(await atkInf.aTokenCollateral.erc20()).to.equal(atkInf.stataToken.address)
          expect(await atkInf.stataToken.decimals()).to.equal(await atkInf.token.decimals())
          expect(await atkInf.aTokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String('USD')
          )
          expect(await atkInf.aTokenCollateral.refPerTok()).to.be.closeTo(fp('1'), fp('0.095'))

          expect(await atkInf.aTokenCollateral.targetPerRef()).to.equal(fp('1'))

          await expectPrice(
            atkInf.aTokenCollateral.address,
            atkInf.pegPrice.mul(atkInf.refPerTok).div(BN_SCALE_FACTOR),
            ORACLE_ERROR,
            true,
            bn('1e5')
          )

          await expect(atkInf.aTokenCollateral.claimRewards())
            .to.emit(atkInf.stataToken, 'RewardsClaimed')
            .withArgs(aaveToken.address, 0)

          // Check StaticAToken
          expect(await atkInf.stataToken.name()).to.equal(
            'Static Aave interest bearing ' + (await atkInf.token.symbol())
          )
          expect(await atkInf.stataToken.symbol()).to.equal('stata' + (await atkInf.token.symbol()))
          expect(await atkInf.stataToken.decimals()).to.equal(await atkInf.token.decimals())
          expect(await atkInf.stataToken.LENDING_POOL()).to.equal(
            networkConfig[chainId].AAVE_LENDING_POOL
          )
          expect(await atkInf.stataToken.INCENTIVES_CONTROLLER()).to.equal(
            networkConfig[chainId].AAVE_INCENTIVES
          )
          expect(await atkInf.stataToken.ATOKEN()).to.equal(atkInf.aToken.address)
          expect(await atkInf.stataToken.ATOKEN()).to.equal(atkInf.aTokenAddress)
          expect(await atkInf.stataToken.ASSET()).to.equal(atkInf.token.address)
          expect(await atkInf.stataToken.ASSET()).to.equal(atkInf.tokenAddress)
          expect(await atkInf.stataToken.REWARD_TOKEN()).to.equal(aaveToken.address)

          expect(await atkInf.aTokenCollateral.maxTradeVolume()).to.equal(
            config.rTokenMaxTradeVolume
          )
        }
      })

      it('Should setup collateral correctly - Non-Fiatcoins', async () => {
        // Define interface required for each non-fiat coin
        interface TokenInfo {
          nonFiatToken: ERC20Mock
          nonFiatTokenDecimals: number
          nonFiatTokenAddress: string
          nonFiatTokenCollateral: NonFiatCollateral
          targetPrice: BigNumber
          refPrice: BigNumber
          targetName: string
        }

        // WBTC
        const tokenInfos: TokenInfo[] = [
          {
            nonFiatToken: wbtc,
            nonFiatTokenDecimals: 8,
            nonFiatTokenAddress: networkConfig[chainId].tokens.WBTC || '',
            nonFiatTokenCollateral: wbtcCollateral,
            targetPrice: fp('31311.5'), // approx price June 6, 2022
            refPrice: fp('1.00062735'), // approx price wbtc-btc
            targetName: 'BTC',
          },
        ]

        for (const tkInf of tokenInfos) {
          // Non-Fiat Token Assets
          expect(await tkInf.nonFiatTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await tkInf.nonFiatTokenCollateral.isCollateral()).to.equal(true)
          expect(await tkInf.nonFiatTokenCollateral.erc20()).to.equal(tkInf.nonFiatToken.address)
          expect(await tkInf.nonFiatTokenCollateral.erc20()).to.equal(tkInf.nonFiatTokenAddress)
          expect(await tkInf.nonFiatToken.decimals()).to.equal(tkInf.nonFiatTokenDecimals)
          expect(await tkInf.nonFiatTokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String(tkInf.targetName)
          )

          // Get priceable info
          await tkInf.nonFiatTokenCollateral.refresh()
          expect(await tkInf.nonFiatTokenCollateral.refPerTok()).to.equal(fp('1'))
          expect(await tkInf.nonFiatTokenCollateral.targetPerRef()).to.equal(fp('1'))

          // ref price approx 1.00062
          await expectPrice(
            tkInf.nonFiatTokenCollateral.address,
            tkInf.targetPrice.mul(tkInf.refPrice).div(BN_SCALE_FACTOR),
            ORACLE_ERROR,
            true,
            bn('1e10')
          )

          await expect(tkInf.nonFiatTokenCollateral.claimRewards()).to.not.emit(
            tkInf.nonFiatTokenCollateral,
            'RewardsClaimed'
          )

          expect(await tkInf.nonFiatTokenCollateral.maxTradeVolume()).to.equal(
            config.rTokenMaxTradeVolume
          )
        }
      })

      it('Should setup collateral correctly - CTokens Non-Fiat', async () => {
        // Define interface required for each ctoken
        interface CTokenInfo {
          token: ERC20Mock
          tokenAddress: string
          cToken: CTokenMock
          cTokenAddress: string
          cTokenCollateral: CTokenNonFiatCollateral
          targetPrice: BigNumber
          refPrice: BigNumber
          refPerTok: BigNumber
          targetName: string
        }

        // Compound - cWBTC
        const cTokenInfos: CTokenInfo[] = [
          {
            token: wbtc,
            tokenAddress: networkConfig[chainId].tokens.WBTC || '',
            cToken: cWBTC,
            cTokenAddress: networkConfig[chainId].tokens.cWBTC || '',
            cTokenCollateral: cWBTCCollateral,
            targetPrice: fp('31311.5'), // approx price June 6, 2022
            refPrice: fp('1.00062735'), // approx price wbtc-btc
            refPerTok: fp('0.020065932066404677'), // for wbtc on June 2022
            targetName: 'BTC',
          },
        ]

        for (const ctkInf of cTokenInfos) {
          // CToken
          expect(await ctkInf.cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctkInf.cTokenCollateral.isCollateral()).to.equal(true)
          expect(await ctkInf.cTokenCollateral.referenceERC20Decimals()).to.equal(
            await ctkInf.token.decimals()
          )
          expect(await ctkInf.cTokenCollateral.erc20()).to.equal(ctkInf.cTokenAddress)
          expect(await ctkInf.cToken.decimals()).to.equal(8)
          expect(await ctkInf.cTokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String(ctkInf.targetName)
          )
          expect(await ctkInf.cTokenCollateral.refPerTok()).to.be.closeTo(
            ctkInf.refPerTok,
            fp('0.001')
          )
          expect(await ctkInf.cTokenCollateral.targetPerRef()).to.equal(fp('1'))

          // close to $633 usd
          await expectPrice(
            ctkInf.cTokenCollateral.address,
            ctkInf.targetPrice
              .mul(ctkInf.refPrice)
              .mul(await ctkInf.cTokenCollateral.refPerTok())
              .div(BN_SCALE_FACTOR.pow(2)),
            ORACLE_ERROR,
            true
          )

          await expect(ctkInf.cTokenCollateral.claimRewards())
            .to.emit(ctkInf.cTokenCollateral, 'RewardsClaimed')
            .withArgs(compToken.address, 0)

          expect(await ctkInf.cTokenCollateral.maxTradeVolume()).to.equal(
            config.rTokenMaxTradeVolume
          )
        }
      })

      it('Should setup collateral correctly - Self-Referential', async () => {
        // Define interface required for each self-referential coin
        interface TokenInfo {
          selfRefToken: ERC20Mock | WETH9
          selfRefTokenDecimals: number
          selfRefTokenAddress: string
          selfRefTokenCollateral: FiatCollateral
          price: BigNumber
          targetName: string
        }

        // WBTC
        const tokenInfos: TokenInfo[] = [
          {
            selfRefToken: weth,
            selfRefTokenDecimals: 18,
            selfRefTokenAddress: networkConfig[chainId].tokens.WETH || '',
            selfRefTokenCollateral: wethCollateral,
            price: fp('1859.17'), //approx price June 2022
            targetName: 'ETH',
          },
        ]

        for (const tkInf of tokenInfos) {
          // Non-Fiat Token Assets
          expect(await tkInf.selfRefTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await tkInf.selfRefTokenCollateral.isCollateral()).to.equal(true)
          expect(await tkInf.selfRefTokenCollateral.erc20()).to.equal(tkInf.selfRefToken.address)
          expect(await tkInf.selfRefTokenCollateral.erc20()).to.equal(tkInf.selfRefTokenAddress)
          expect(await tkInf.selfRefToken.decimals()).to.equal(tkInf.selfRefTokenDecimals)
          expect(await tkInf.selfRefTokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String(tkInf.targetName)
          )
          // Get priceable info
          await tkInf.selfRefTokenCollateral.refresh()
          expect(await tkInf.selfRefTokenCollateral.refPerTok()).to.equal(fp('1'))
          expect(await tkInf.selfRefTokenCollateral.targetPerRef()).to.equal(fp('1'))

          await expectPrice(tkInf.selfRefTokenCollateral.address, tkInf.price, ORACLE_ERROR, true)

          await expect(tkInf.selfRefTokenCollateral.claimRewards()).to.not.emit(
            tkInf.selfRefTokenCollateral,
            'RewardsClaimed'
          )
          expect(await tkInf.selfRefTokenCollateral.maxTradeVolume()).to.equal(
            config.rTokenMaxTradeVolume
          )
        }
      })

      it('Should setup collateral correctly - CTokens Self-Referential', async () => {
        // Define interface required for each ctoken
        interface CTokenInfo {
          token: ERC20Mock
          tokenAddress: string
          cToken: CTokenMock
          cTokenAddress: string
          cTokenCollateral: CTokenSelfReferentialCollateral
          price: BigNumber
          refPerTok: BigNumber
          targetName: string
        }

        // Compound - cUSDC and cUSDT
        const cTokenInfos: CTokenInfo[] = [
          {
            token: weth,
            tokenAddress: networkConfig[chainId].tokens.WETH || '',
            cToken: cETH,
            cTokenAddress: networkConfig[chainId].tokens.cETH || '',
            cTokenCollateral: cETHCollateral,
            price: fp('1859.17'), // approx price June 6, 2022
            refPerTok: fp('0.020064224962890636'), // for weth on June 2022
            targetName: 'ETH',
          },
        ]

        for (const ctkInf of cTokenInfos) {
          // CToken
          expect(await ctkInf.cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await ctkInf.cTokenCollateral.isCollateral()).to.equal(true)
          expect(await ctkInf.cTokenCollateral.referenceERC20Decimals()).to.equal(
            await ctkInf.token.decimals()
          )
          expect(await ctkInf.cTokenCollateral.erc20()).to.equal(ctkInf.cTokenAddress)
          expect(await ctkInf.cToken.decimals()).to.equal(8)
          expect(await ctkInf.cTokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String(ctkInf.targetName)
          )

          expect(await ctkInf.cTokenCollateral.refPerTok()).to.be.closeTo(
            ctkInf.refPerTok,
            fp('0.001')
          )
          expect(await ctkInf.cTokenCollateral.targetPerRef()).to.equal(fp('1'))

          await expectPrice(
            ctkInf.cTokenCollateral.address,
            ctkInf.price.mul(ctkInf.refPerTok).div(BN_SCALE_FACTOR),
            ORACLE_ERROR,
            true,
            bn('1e5')
          )

          await expect(ctkInf.cTokenCollateral.claimRewards())
            .to.emit(ctkInf.cTokenCollateral, 'RewardsClaimed')
            .withArgs(compToken.address, 0)

          expect(await ctkInf.cTokenCollateral.maxTradeVolume()).to.equal(
            config.rTokenMaxTradeVolume
          )
        }
      })

      it('Should setup collateral correctly - EUR Fiatcoins', async () => {
        // Define interface required for each Eur-fiat coin
        interface TokenInfo {
          eurFiatToken: ERC20Mock
          eurFiatTokenDecimals: number
          eurFiatTokenAddress: string
          eurFiatTokenCollateral: EURFiatCollateral
          targetPrice: BigNumber
          refPrice: BigNumber
          targetName: string
        }

        // EURT
        const tokenInfos: TokenInfo[] = [
          {
            eurFiatToken: eurt,
            eurFiatTokenDecimals: 6,
            eurFiatTokenAddress: networkConfig[chainId].tokens.EURT || '',
            eurFiatTokenCollateral: eurtCollateral,
            targetPrice: fp('1.07025'), // mimic ref price
            refPrice: fp('1.07025'), // approx price EURT-USD June 6, 2022
            targetName: 'EUR',
          },
        ]

        for (const tkInf of tokenInfos) {
          // Non-Fiat Token Assets
          expect(await tkInf.eurFiatTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
          expect(await tkInf.eurFiatTokenCollateral.isCollateral()).to.equal(true)
          expect(await tkInf.eurFiatTokenCollateral.erc20()).to.equal(tkInf.eurFiatToken.address)
          expect(await tkInf.eurFiatTokenCollateral.erc20()).to.equal(tkInf.eurFiatTokenAddress)
          expect(await tkInf.eurFiatToken.decimals()).to.equal(tkInf.eurFiatTokenDecimals)
          expect(await tkInf.eurFiatTokenCollateral.targetName()).to.equal(
            ethers.utils.formatBytes32String(tkInf.targetName)
          )

          // Get priceable info
          await tkInf.eurFiatTokenCollateral.refresh()
          expect(await tkInf.eurFiatTokenCollateral.refPerTok()).to.equal(fp('1'))
          expect(await tkInf.eurFiatTokenCollateral.targetPerRef()).to.equal(fp('1'))

          // ref price approx 1.07
          await expectPrice(
            tkInf.eurFiatTokenCollateral.address,
            tkInf.refPrice,
            ORACLE_ERROR,
            true
          )

          await expect(tkInf.eurFiatTokenCollateral.claimRewards()).to.not.emit(
            tkInf.eurFiatTokenCollateral,
            'RewardsClaimed'
          )

          expect(await tkInf.eurFiatTokenCollateral.maxTradeVolume()).to.equal(
            config.rTokenMaxTradeVolume
          )
        }
      })

      it('Should handle invalid/stale Price - Assets', async () => {
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        // Stale Oracle
        await expectUnpriced(compAsset.address)
        await expectUnpriced(aaveAsset.address)

        // Setup Assets with no price feed
        const nonpriceAsset: Asset = <Asset>(
          await (
            await ethers.getContractFactory('Asset')
          ).deploy(
            PRICE_TIMEOUT,
            NO_PRICE_DATA_FEED,
            ORACLE_ERROR,
            networkConfig[chainId].tokens.stkAAVE || '',
            config.rTokenMaxTradeVolume,
            MAX_ORACLE_TIMEOUT
          )
        )
        // Assets with invalid feed - revert
        await expect(nonpriceAsset.price()).to.be.reverted

        // With a feed with zero price
        const zeroPriceAsset: Asset = <Asset>(
          await (
            await ethers.getContractFactory('Asset')
          ).deploy(
            PRICE_TIMEOUT,
            mockChainlinkFeed.address,
            ORACLE_ERROR,
            networkConfig[chainId].tokens.stkAAVE || '',
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT
          )
        )
        await setOraclePrice(zeroPriceAsset.address, bn('1e10'))
        await zeroPriceAsset.refresh()

        const initialPrice = await zeroPriceAsset.price()
        await setOraclePrice(zeroPriceAsset.address, bn(0))
        await expectExactPrice(zeroPriceAsset.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeroPriceAsset.address, bn(0))
        await expectDecayedPrice(zeroPriceAsset.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeroPriceAsset.address, bn(0))
        await expectUnpriced(zeroPriceAsset.address)
      })

      it('Should handle invalid/stale Price - Collateral - Fiat', async () => {
        // Does not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        await expectUnpriced(daiCollateral.address)
        await expectUnpriced(usdcCollateral.address)
        await expectUnpriced(usdtCollateral.address)
        await expectUnpriced(busdCollateral.address)
        await expectUnpriced(usdpCollateral.address)
        await expectUnpriced(tusdCollateral.address)

        // Refresh should mark status IFFY
        await daiCollateral.refresh()
        await usdcCollateral.refresh()
        await usdtCollateral.refresh()
        await busdCollateral.refresh()
        await usdpCollateral.refresh()
        await tusdCollateral.refresh()
        expect(await daiCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await usdcCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await usdtCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await busdCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await usdpCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await tusdCollateral.status()).to.equal(CollateralStatus.IFFY)

        const defaultThreshold = fp('0.01') // 1%
        const delayUntilDefault = bn('86400') // 24h

        // Non price Fiat collateral
        const nonPriceCollateral: FiatCollateral = <FiatCollateral>await (
          await ethers.getContractFactory('FiatCollateral')
        ).deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: NO_PRICE_DATA_FEED,
          oracleError: ORACLE_ERROR,
          erc20: dai.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: MAX_ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        })

        // Collateral with no price should revert
        await expect(nonPriceCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonPriceCollateral.refresh()).to.be.reverted
        expect(await nonPriceCollateral.status()).to.equal(CollateralStatus.SOUND)

        // feed with zero price - does not revert
        const zeroFiatCollateral: FiatCollateral = <FiatCollateral>await (
          await ethers.getContractFactory('FiatCollateral')
        ).deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: dai.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold,
          delayUntilDefault,
        })
        await setOraclePrice(zeroFiatCollateral.address, bn('1e8'))
        await zeroFiatCollateral.refresh()
        expect(await zeroFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

        const initialPrice = await zeroFiatCollateral.price()
        await setOraclePrice(zeroFiatCollateral.address, bn(0))
        await expectExactPrice(zeroFiatCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeroFiatCollateral.address, bn(0))
        await expectDecayedPrice(zeroFiatCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeroFiatCollateral.address, bn(0))
        await expectUnpriced(zeroFiatCollateral.address)

        // Marked IFFY after refresh
        await zeroFiatCollateral.refresh()
        expect(await zeroFiatCollateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('Should handle invalid/stale Price - Collateral - CTokens Fiat', async () => {
        expect(await cDaiCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await cUsdcCollateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await cUsdtCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Does not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        // Compound
        await expectUnpriced(cDaiCollateral.address)
        await expectUnpriced(cUsdcCollateral.address)
        await expectUnpriced(cUsdtCollateral.address)

        // Refresh should mark status IFFY
        await cDaiCollateral.refresh()
        await cUsdcCollateral.refresh()
        await cUsdtCollateral.refresh()
        expect(await cDaiCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await cUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await cUsdtCollateral.status()).to.equal(CollateralStatus.IFFY)

        const defaultThreshold = fp('0.01') // 1%
        const delayUntilDefault = bn('86400') // 24h

        // CTokens Collateral with no price
        const nonpriceCtokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>await (
          await ethers.getContractFactory('CTokenFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: NO_PRICE_DATA_FEED,
            oracleError: ORACLE_ERROR,
            erc20: cDai.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: MAX_ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          REVENUE_HIDING
        )
        // CTokens - Collateral with no price info should revert
        await expect(nonpriceCtokenCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
        expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Does not revert with a feed with zero price
        const zeropriceCtokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>await (
          await ethers.getContractFactory('CTokenFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: mockChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: cDai.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          REVENUE_HIDING
        )
        await setOraclePrice(zeropriceCtokenCollateral.address, bn('1e8'))
        await zeropriceCtokenCollateral.refresh()
        expect(await zeropriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

        const initialPrice = await zeropriceCtokenCollateral.price()
        await setOraclePrice(zeropriceCtokenCollateral.address, bn(0))
        await expectExactPrice(zeropriceCtokenCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeropriceCtokenCollateral.address, bn(0))
        await expectDecayedPrice(zeropriceCtokenCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeropriceCtokenCollateral.address, bn(0))
        await expectUnpriced(zeropriceCtokenCollateral.address)

        // Refresh should mark status IFFY
        await zeropriceCtokenCollateral.refresh()
        expect(await zeropriceCtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('Should handle invalid/stale Price - Collateral - ATokens Fiat', async () => {
        // Does not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        // Aave
        await expectUnpriced(aDaiCollateral.address)
        await expectUnpriced(aUsdcCollateral.address)
        await expectUnpriced(aUsdtCollateral.address)
        await expectUnpriced(aBusdCollateral.address)

        // Refresh should mark status IFFY
        await aDaiCollateral.refresh()
        await aUsdcCollateral.refresh()
        await aUsdtCollateral.refresh()
        await aBusdCollateral.refresh()
        expect(await aDaiCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await aUsdcCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await aUsdtCollateral.status()).to.equal(CollateralStatus.IFFY)
        expect(await aBusdCollateral.status()).to.equal(CollateralStatus.IFFY)

        const defaultThreshold = fp('0.01') // 1%
        const delayUntilDefault = bn('86400') // 24h

        // AToken collateral with no price
        const nonpriceAtokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
          await ethers.getContractFactory('ATokenFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: NO_PRICE_DATA_FEED,
            oracleError: ORACLE_ERROR,
            erc20: stataDai.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: MAX_ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          REVENUE_HIDING
        )

        // ATokens - Collateral with no price info should revert
        await expect(nonpriceAtokenCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonpriceAtokenCollateral.refresh()).to.be.reverted
        expect(await nonpriceAtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Does not revert with a feed with zero price
        const zeroPriceAtokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
          await ethers.getContractFactory('ATokenFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: mockChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: stataDai.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold,
            delayUntilDefault,
          },
          REVENUE_HIDING
        )
        await setOraclePrice(zeroPriceAtokenCollateral.address, bn('1e8'))
        await zeroPriceAtokenCollateral.refresh()
        expect(await zeroPriceAtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

        const initialPrice = await zeroPriceAtokenCollateral.price()
        await setOraclePrice(zeroPriceAtokenCollateral.address, bn(0))
        await expectExactPrice(zeroPriceAtokenCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeroPriceAtokenCollateral.address, bn(0))
        await expectDecayedPrice(zeroPriceAtokenCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeroPriceAtokenCollateral.address, bn(0))
        await expectUnpriced(zeroPriceAtokenCollateral.address)

        // Refresh should mark status IFFY
        await zeroPriceAtokenCollateral.refresh()
        expect(await zeroPriceAtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('Should handle invalid/stale Price - Collateral - Non-Fiatcoins', async () => {
        // Does not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        // Aave
        await expectUnpriced(wbtcCollateral.address)

        await wbtcCollateral.refresh()
        expect(await wbtcCollateral.status()).to.equal(CollateralStatus.IFFY)

        const defaultThreshold = fp('0.01') // 1%
        const delayUntilDefault = bn('86400') // 24h

        // Non-Fiat collateral with no price
        const nonpriceNonFiatCollateral: NonFiatCollateral = <NonFiatCollateral>await (
          await ethers.getContractFactory('NonFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: NO_PRICE_DATA_FEED,
            oracleError: ORACLE_ERROR,
            erc20: wbtc.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: MAX_ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('BTC'),
            defaultThreshold,
            delayUntilDefault,
          },
          NO_PRICE_DATA_FEED,
          MAX_ORACLE_TIMEOUT
        )

        // Non-fiat Collateral with no price should revert
        await expect(nonpriceNonFiatCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonpriceNonFiatCollateral.refresh()).to.be.reverted
        expect(await nonpriceNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Non-Fiat collateral with zero price
        const zeroPriceNonFiatCollateral: NonFiatCollateral = <NonFiatCollateral>await (
          await ethers.getContractFactory('NonFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: mockChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: wbtc.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('BTC'),
            defaultThreshold,
            delayUntilDefault,
          },
          mockChainlinkFeed.address,
          ORACLE_TIMEOUT
        )
        await setOraclePrice(zeroPriceNonFiatCollateral.address, bn('1e10'))
        await zeroPriceNonFiatCollateral.refresh()

        const initialPrice = await zeroPriceNonFiatCollateral.price()
        await setOraclePrice(zeroPriceNonFiatCollateral.address, bn(0))
        await expectExactPrice(zeroPriceNonFiatCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeroPriceNonFiatCollateral.address, bn(0))
        await expectDecayedPrice(zeroPriceNonFiatCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeroPriceNonFiatCollateral.address, bn(0))
        await expectUnpriced(zeroPriceNonFiatCollateral.address)
      })

      it('Should handle invalid/stale Price - Collateral - CTokens Non-Fiat', async () => {
        // Does not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        // Compound
        await expectUnpriced(cWBTCCollateral.address)

        // Refresh should mark status IFFY
        await cWBTCCollateral.refresh()
        expect(await cWBTCCollateral.status()).to.equal(CollateralStatus.IFFY)

        const defaultThreshold = fp('0.01') // 1%
        const delayUntilDefault = bn('86400') // 24h

        // CTokens Collateral with no price
        const nonpriceCtokenNonFiatCollateral: CTokenNonFiatCollateral = <CTokenNonFiatCollateral>(
          await (
            await ethers.getContractFactory('CTokenNonFiatCollateral')
          ).deploy(
            {
              priceTimeout: PRICE_TIMEOUT,
              chainlinkFeed: NO_PRICE_DATA_FEED,
              oracleError: ORACLE_ERROR,
              erc20: cWBTC.address,
              maxTradeVolume: config.rTokenMaxTradeVolume,
              oracleTimeout: MAX_ORACLE_TIMEOUT,
              targetName: ethers.utils.formatBytes32String('BTC'),
              defaultThreshold,
              delayUntilDefault,
            },
            NO_PRICE_DATA_FEED,
            MAX_ORACLE_TIMEOUT,
            REVENUE_HIDING
          )
        )

        // CTokens - Collateral with no price info should revert
        await expect(nonpriceCtokenNonFiatCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonpriceCtokenNonFiatCollateral.refresh()).to.be.reverted
        expect(await nonpriceCtokenNonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Does not revert with a feed with zero price
        const zeropriceCtokenNonFiatCollateral: CTokenNonFiatCollateral = <CTokenNonFiatCollateral>(
          await (
            await ethers.getContractFactory('CTokenNonFiatCollateral')
          ).deploy(
            {
              priceTimeout: PRICE_TIMEOUT,
              chainlinkFeed: mockChainlinkFeed.address,
              oracleError: ORACLE_ERROR,
              erc20: cWBTC.address,
              maxTradeVolume: config.rTokenMaxTradeVolume,
              oracleTimeout: ORACLE_TIMEOUT,
              targetName: ethers.utils.formatBytes32String('BTC'),
              defaultThreshold,
              delayUntilDefault,
            },
            mockChainlinkFeed.address,
            ORACLE_TIMEOUT,
            REVENUE_HIDING
          )
        )
        await setOraclePrice(zeropriceCtokenNonFiatCollateral.address, bn('1e10'))
        await zeropriceCtokenNonFiatCollateral.refresh()

        const initialPrice = await zeropriceCtokenNonFiatCollateral.price()
        await setOraclePrice(zeropriceCtokenNonFiatCollateral.address, bn(0))
        await expectExactPrice(zeropriceCtokenNonFiatCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeropriceCtokenNonFiatCollateral.address, bn(0))
        await expectDecayedPrice(zeropriceCtokenNonFiatCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeropriceCtokenNonFiatCollateral.address, bn(0))
        await expectUnpriced(zeropriceCtokenNonFiatCollateral.address)
      })

      it('Should handle invalid/stale Price - Collateral - Self-Referential', async () => {
        const delayUntilDefault = bn('86400') // 24h

        // Dows not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        // Aave
        await expectUnpriced(wethCollateral.address)

        await wethCollateral.refresh()
        expect(await wethCollateral.status()).to.equal(CollateralStatus.IFFY)

        // Self referential collateral with no price
        const nonpriceSelfReferentialCollateral: SelfReferentialCollateral = <
          SelfReferentialCollateral
        >await (
          await ethers.getContractFactory('SelfReferentialCollateral')
        ).deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: NO_PRICE_DATA_FEED,
          oracleError: ORACLE_ERROR,
          erc20: weth.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: MAX_ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('ETH'),
          defaultThreshold: bn('0'),
          delayUntilDefault,
        })

        // Non-fiat Collateral with no price should revert
        await expect(nonpriceSelfReferentialCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonpriceSelfReferentialCollateral.refresh()).to.be.reverted
        expect(await nonpriceSelfReferentialCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Self referential collateral with zero price
        const zeroPriceSelfReferentialCollateral: SelfReferentialCollateral = <
          SelfReferentialCollateral
        >await (
          await ethers.getContractFactory('SelfReferentialCollateral')
        ).deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: mockChainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: weth.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('ETH'),
          defaultThreshold: bn('0'),
          delayUntilDefault,
        })
        await setOraclePrice(zeroPriceSelfReferentialCollateral.address, bn('1e10'))
        await zeroPriceSelfReferentialCollateral.refresh()
        expect(await zeroPriceSelfReferentialCollateral.status()).to.equal(CollateralStatus.SOUND)

        const initialPrice = await zeroPriceSelfReferentialCollateral.price()
        await setOraclePrice(zeroPriceSelfReferentialCollateral.address, bn(0))
        await expectExactPrice(zeroPriceSelfReferentialCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeroPriceSelfReferentialCollateral.address, bn(0))
        await expectDecayedPrice(zeroPriceSelfReferentialCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeroPriceSelfReferentialCollateral.address, bn(0))
        await expectUnpriced(zeroPriceSelfReferentialCollateral.address)

        // Refresh should mark status DISABLED
        await zeroPriceSelfReferentialCollateral.refresh()
        expect(await zeroPriceSelfReferentialCollateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('Should handle invalid/stale Price - Collateral - CTokens Self-Referential', async () => {
        const delayUntilDefault = bn('86400') // 24h

        // Does not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        // Compound
        await expectUnpriced(cETHCollateral.address)

        // Refresh should mark status IFFY
        await cETHCollateral.refresh()
        expect(await cETHCollateral.status()).to.equal(CollateralStatus.IFFY)

        // CTokens Collateral with no price
        const nonpriceCtokenSelfReferentialCollateral: CTokenSelfReferentialCollateral = <
          CTokenSelfReferentialCollateral
        >await (
          await ethers.getContractFactory('CTokenSelfReferentialCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: NO_PRICE_DATA_FEED,
            oracleError: ORACLE_ERROR,
            erc20: cETH.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: MAX_ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('ETH'),
            defaultThreshold: bn('0'),
            delayUntilDefault,
          },
          REVENUE_HIDING,
          await weth.decimals()
        )

        // CTokens - Collateral with no price info should revert
        await expect(nonpriceCtokenSelfReferentialCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonpriceCtokenSelfReferentialCollateral.refresh()).to.be.reverted
        expect(await nonpriceCtokenSelfReferentialCollateral.status()).to.equal(
          CollateralStatus.SOUND
        )

        // Does not revert with a feed with zero price
        const zeroPriceCtokenSelfReferentialCollateral: CTokenSelfReferentialCollateral = <
          CTokenSelfReferentialCollateral
        >await (
          await ethers.getContractFactory('CTokenSelfReferentialCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: mockChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: cETH.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('ETH'),
            defaultThreshold: bn('0'),
            delayUntilDefault,
          },
          REVENUE_HIDING,
          await weth.decimals()
        )
        await setOraclePrice(zeroPriceCtokenSelfReferentialCollateral.address, bn('1e10'))
        await zeroPriceCtokenSelfReferentialCollateral.refresh()
        expect(await zeroPriceCtokenSelfReferentialCollateral.status()).to.equal(
          CollateralStatus.SOUND
        )

        const initialPrice = await zeroPriceCtokenSelfReferentialCollateral.price()
        await setOraclePrice(zeroPriceCtokenSelfReferentialCollateral.address, bn(0))
        await expectExactPrice(zeroPriceCtokenSelfReferentialCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(zeroPriceCtokenSelfReferentialCollateral.address, bn(0))
        await expectDecayedPrice(zeroPriceCtokenSelfReferentialCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(zeroPriceCtokenSelfReferentialCollateral.address, bn(0))
        await expectUnpriced(zeroPriceCtokenSelfReferentialCollateral.address)

        // Refresh should mark status IFFY
        await zeroPriceCtokenSelfReferentialCollateral.refresh()
        expect(await zeroPriceCtokenSelfReferentialCollateral.status()).to.equal(
          CollateralStatus.IFFY
        )
      })

      it('Should handle invalid/stale Price - Collateral - EUR Fiat', async () => {
        // Does not revert with stale price
        await advanceTime(DECAY_DELAY.add(PRICE_TIMEOUT).toString())

        await expectUnpriced(eurtCollateral.address)

        // Refresh should mark status IFFY
        await eurtCollateral.refresh()

        const defaultThreshold = fp('0.01') // 1%
        const delayUntilDefault = bn('86400') // 24h

        // Non price EUR Fiat collateral
        const nonPriceEURCollateral: EURFiatCollateral = <EURFiatCollateral>await (
          await ethers.getContractFactory('EURFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: NO_PRICE_DATA_FEED,
            oracleError: ORACLE_ERROR,
            erc20: eurt.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: MAX_ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('EUR'),
            defaultThreshold,
            delayUntilDefault,
          },
          NO_PRICE_DATA_FEED,
          MAX_ORACLE_TIMEOUT
        )

        // Collateral with no price should revert
        await expect(nonPriceEURCollateral.price()).to.be.reverted

        // Refresh should also revert - status is not modified
        await expect(nonPriceEURCollateral.refresh()).to.be.reverted
        expect(await nonPriceEURCollateral.status()).to.equal(CollateralStatus.SOUND)

        // Does not revert with a feed with zero price
        const invalidPriceEURCollateral: EURFiatCollateral = <EURFiatCollateral>await (
          await ethers.getContractFactory('EURFiatCollateral')
        ).deploy(
          {
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: mockChainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: eurt.address,
            maxTradeVolume: config.rTokenMaxTradeVolume,
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('EUR'),
            defaultThreshold,
            delayUntilDefault,
          },
          mockChainlinkFeed.address,
          ORACLE_TIMEOUT
        )
        await setOraclePrice(invalidPriceEURCollateral.address, bn('1e10'))
        await invalidPriceEURCollateral.refresh()
        expect(await invalidPriceEURCollateral.status()).to.equal(CollateralStatus.SOUND)

        const initialPrice = await invalidPriceEURCollateral.price()
        await setOraclePrice(invalidPriceEURCollateral.address, bn(0))
        await expectExactPrice(invalidPriceEURCollateral.address, initialPrice)

        // After oracle timeout, begins decay
        await advanceTime(DECAY_DELAY.add(1).toString())
        await setOraclePrice(invalidPriceEURCollateral.address, bn(0))
        await expectDecayedPrice(invalidPriceEURCollateral.address)

        // After price timeout, unpriced
        await advanceTime(PRICE_TIMEOUT.toString())
        await setOraclePrice(invalidPriceEURCollateral.address, bn(0))
        await expectUnpriced(invalidPriceEURCollateral.address)

        // Refresh should mark status IFFY
        await invalidPriceEURCollateral.refresh()
        expect(await invalidPriceEURCollateral.status()).to.equal(CollateralStatus.IFFY)
      })

      it('Should register ERC20s and Assets/Collateral correctly', async () => {
        // Check assets/collateral
        const ERC20s = await assetRegistry.erc20s()
        expect(ERC20s[0]).to.equal(rToken.address)
        expect(ERC20s[1]).to.equal(rsr.address)
        expect(ERC20s[2]).to.equal(aaveToken.address)
        expect(ERC20s[3]).to.equal(compToken.address)

        const initialTokens: string[] = await Promise.all(
          basket.map(async (c): Promise<string> => {
            return await c.erc20()
          })
        )
        expect(ERC20s.slice(4)).to.eql(initialTokens)
        expect(ERC20s.length).to.eql((await facade.basketTokens(rToken.address)).length + 4)

        // Assets
        expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
        expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
        expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(aaveAsset.address)
        expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(compAsset.address)
        expect(await assetRegistry.toAsset(ERC20s[4])).to.equal(daiCollateral.address)
        expect(await assetRegistry.toAsset(ERC20s[5])).to.equal(aDaiCollateral.address)
        expect(await assetRegistry.toAsset(ERC20s[6])).to.equal(cDaiCollateral.address)

        // Collaterals
        expect(await assetRegistry.toColl(ERC20s[4])).to.equal(daiCollateral.address)
        expect(await assetRegistry.toColl(ERC20s[5])).to.equal(aDaiCollateral.address)
        expect(await assetRegistry.toColl(ERC20s[6])).to.equal(cDaiCollateral.address)
      })

      it('Should register simple Basket correctly', async () => {
        // Basket
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        const backing = await facade.basketTokens(rToken.address)
        expect(backing[0]).to.equal(dai.address)
        expect(backing[1]).to.equal(stataDai.address)
        expect(backing[2]).to.equal(cDai.address)

        expect(backing.length).to.equal(3)

        // Check other values
        expect(await basketHandler.timestamp()).to.be.gt(bn(0))
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
        await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true, bn('1e5'))

        // Check RToken price
        const issueAmount: BigNumber = bn('10000e18')
        await dai.connect(addr1).approve(rToken.address, issueAmount)
        await stataDai.connect(addr1).approve(rToken.address, issueAmount)
        await cDai.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )
      })

      it('Should issue/reedem correctly with simple basket', async function () {
        const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

        // Check balances before
        expect(await dai.balanceOf(backingManager.address)).to.equal(0)
        expect(await stataDai.balanceOf(backingManager.address)).to.equal(0)
        expect(await cDai.balanceOf(backingManager.address)).to.equal(0)
        expect(await dai.balanceOf(addr1.address)).to.equal(initialBal)

        // Balance for Static a Token is about 18641.55e18, about 93.21% of the provided amount (20K)
        const initialBalAToken = initialBal.mul(9321).div(10000)
        expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(initialBalAToken, fp('1.5'))
        expect(await cDai.balanceOf(addr1.address)).to.equal(toBNDecimals(initialBal, 8).mul(100))

        // Provide approvals
        await dai.connect(addr1).approve(rToken.address, issueAmount)
        await stataDai.connect(addr1).approve(rToken.address, issueAmount)
        await cDai.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Check rToken balance
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(main.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check Balances after
        expect(await dai.balanceOf(backingManager.address)).to.equal(issueAmount.div(4)) // 2.5K needed (25% of basket)
        const issueAmtAToken = issueAmount.div(4).mul(9321).div(10000) // approx 93.21% of 2.5K needed (25% of basket)
        expect(await stataDai.balanceOf(backingManager.address)).to.be.closeTo(
          issueAmtAToken,
          fp('1')
        )
        const requiredCTokens: BigNumber = bn('227116e8') // approx 227K needed (~5K, 50% of basket) - Price: ~0.022
        expect(await cDai.balanceOf(backingManager.address)).to.be.closeTo(
          requiredCTokens,
          bn('1e8')
        )

        // Balances for user
        expect(await dai.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount.div(4)))
        expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(
          initialBalAToken.sub(issueAmtAToken),
          fp('1.5')
        )
        expect(await cDai.balanceOf(addr1.address)).to.be.closeTo(
          toBNDecimals(initialBal, 8).mul(100).sub(requiredCTokens),
          bn('1e8')
        )
        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        expect(await rToken.balanceOf(main.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        ) // approx 10K in value

        // Redeem Rtokens
        await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances after - Backing Manager is empty
        expect(await dai.balanceOf(backingManager.address)).to.equal(0)
        expect(await stataDai.balanceOf(backingManager.address)).to.be.closeTo(bn(0), fp('0.01'))
        expect(await cDai.balanceOf(backingManager.address)).to.be.closeTo(bn(0), bn('1e15'))

        // Check funds returned to user
        expect(await dai.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(initialBalAToken, fp('1.5'))
        expect(await cDai.balanceOf(addr1.address)).to.be.closeTo(
          toBNDecimals(initialBal, 8).mul(100),
          bn('1e16')
        )

        // Check asset value left
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          bn(0),
          fp('0.001')
        ) // Near zero
      })

      it('Should handle rates correctly on Issue/Redeem', async function () {
        const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

        // Provide approvals for issuances
        await dai.connect(addr1).approve(rToken.address, issueAmount)
        await stataDai.connect(addr1).approve(rToken.address, issueAmount)
        await cDai.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        // Store Balances after issuance
        const balanceAddr1Dai: BigNumber = await dai.balanceOf(addr1.address)
        const balanceAddr1aDai: BigNumber = await stataDai.balanceOf(addr1.address)
        const balanceAddr1cDai: BigNumber = await cDai.balanceOf(addr1.address)

        // Check rates and prices
        const [aDaiPriceLow1, aDaiPriceHigh1] = await aDaiCollateral.price() // ~1.07546
        const aDaiRefPerTok1: BigNumber = await aDaiCollateral.refPerTok() // ~ 1.07287
        const [cDaiPriceLow1, cDaiPriceHigh1] = await cDaiCollateral.price() // ~ 0.022015 cents
        const cDaiRefPerTok1: BigNumber = await cDaiCollateral.refPerTok() // ~ 0.022015 cents

        await expectPrice(
          aDaiCollateral.address,
          fp('1.072871695141967225'),
          ORACLE_ERROR,
          true,
          bn('1e5')
        )
        expect(aDaiRefPerTok1).to.be.closeTo(fp('1'), fp('0.095'))

        await expectPrice(
          cDaiCollateral.address,
          fp('0.022015110752383443'),
          ORACLE_ERROR,
          true,
          bn('1e5')
        )
        expect(cDaiRefPerTok1).to.be.closeTo(fp('0.022'), fp('0.001'))

        // Check total asset value
        const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

        // Advance time and blocks slightly
        await advanceTime(10000)
        await advanceBlocks(10000)

        // Refresh assets
        await assetRegistry.refresh()

        // Check rates and prices - Have changed, slight inrease
        const [aDaiPriceLow2, aDaiPriceHigh2] = await aDaiCollateral.price() // ~1.07548
        const aDaiRefPerTok2: BigNumber = await aDaiCollateral.refPerTok() // ~1.07288
        const [cDaiPriceLow2, cDaiPriceHigh2] = await cDaiCollateral.price() // ~0.022016
        const cDaiRefPerTok2: BigNumber = await cDaiCollateral.refPerTok() // ~0.022016

        // Check rates and price increase
        expect(aDaiPriceLow2).to.be.gt(aDaiPriceLow1)
        expect(aDaiPriceHigh2).to.be.gt(aDaiPriceHigh1)
        expect(aDaiRefPerTok2).to.be.gt(aDaiRefPerTok1)
        expect(cDaiPriceLow2).to.be.gt(cDaiPriceLow1)
        expect(cDaiPriceHigh2).to.be.gt(cDaiPriceHigh1)
        expect(cDaiRefPerTok2).to.be.gt(cDaiRefPerTok1)

        // Still close to the original values
        await expectPrice(
          aDaiCollateral.address,
          fp('1.072882861877314264'),
          ORACLE_ERROR,
          true,
          bn('1e5')
        )
        expect(aDaiRefPerTok2).to.be.closeTo(fp('1'), fp('0.095'))

        await expectPrice(
          cDaiCollateral.address,
          fp('0.022016203274102888'),
          ORACLE_ERROR,
          true,
          bn('1e5')
        )
        expect(cDaiRefPerTok2).to.be.closeTo(fp('0.022'), fp('0.001'))

        // Check total asset value increased
        const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue2).to.be.gt(totalAssetValue1)

        // Advance time and blocks significantly
        await advanceTime(100000000)
        await advanceBlocks(100000000)

        // Refresh cToken manually (required)
        await assetRegistry.refresh()

        // Check rates and prices - Have changed significantly
        const [aDaiPriceLow3, aDaiPriceHigh3] = await aDaiCollateral.price() // ~1.1873
        const aDaiRefPerTok3: BigNumber = await aDaiCollateral.refPerTok() // ~1.1845
        const [cDaiPriceLow3, cDaiPriceHigh3] = await cDaiCollateral.price() // ~0.03294
        const cDaiRefPerTok3: BigNumber = await cDaiCollateral.refPerTok() // ~0.03294

        // Check rates and price increase
        expect(aDaiPriceLow3).to.be.gt(aDaiPriceLow2)
        expect(aDaiPriceHigh3).to.be.gt(aDaiPriceHigh2)
        expect(aDaiRefPerTok3).to.be.gt(aDaiRefPerTok2)
        expect(cDaiPriceLow3).to.be.gt(cDaiPriceLow2)
        expect(cDaiPriceHigh3).to.be.gt(cDaiPriceHigh2)
        expect(cDaiRefPerTok3).to.be.gt(cDaiRefPerTok2)

        await expectPrice(
          aDaiCollateral.address,
          fp('1.184527887459258141'),
          ORACLE_ERROR,
          true,
          bn('1e5')
        )
        expect(aDaiRefPerTok3).to.be.closeTo(fp('1.1'), fp('0.095'))
        await expectPrice(
          cDaiCollateral.address,
          fp('0.032941268543431921'),
          ORACLE_ERROR,
          true,
          bn('1e5')
        )
        expect(cDaiRefPerTok3).to.be.closeTo(fp('0.032'), fp('0.001'))

        // Check total asset value increased
        const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
          rToken.address
        )
        expect(totalAssetValue3).to.be.gt(totalAssetValue2)

        // Redeem Rtokens with the udpated rates
        await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances - Fewer ATokens and cTokens should have been sent to the user
        const newBalanceAddr1Dai: BigNumber = await dai.balanceOf(addr1.address)
        const newBalanceAddr1aDai: BigNumber = await stataDai.balanceOf(addr1.address)
        const newBalanceAddr1cDai: BigNumber = await cDai.balanceOf(addr1.address)

        // Check received tokens represent ~10K in value at current prices
        expect(newBalanceAddr1Dai.sub(balanceAddr1Dai)).to.equal(issueAmount.div(4)) // = 2.5K (25% of basket)
        expect(newBalanceAddr1aDai.sub(balanceAddr1aDai)).to.be.closeTo(fp('2110.5'), fp('0.5')) // ~1.1873 * 2110.5  ~= 2.5K (25% of basket)
        expect(newBalanceAddr1cDai.sub(balanceAddr1cDai)).to.be.closeTo(bn('151785e8'), bn('5e16')) // ~0.03294 * 151785.3 ~= 5K (50% of basket)

        // Check remainders in Backing Manager
        expect(await dai.balanceOf(backingManager.address)).to.equal(0)
        expect(await stataDai.balanceOf(backingManager.address)).to.be.closeTo(
          fp('219.64'), // ~= 260 usd in value
          fp('0.01')
        )
        expect(await cDai.balanceOf(backingManager.address)).to.be.closeTo(
          bn('75331e8'),
          bn('5e16')
        ) // ~= 2481 usd in value

        //  Check total asset value (remainder)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          fp('2742'), // ~=  260usd + 2481 usd (from above)
          fp('1')
        )
      })

      it('Should also support StaticAToken from underlying', async () => {
        // Transfer out all existing stataDai - empty balance
        await stataDai
          .connect(addr1)
          .transfer(addr2.address, await stataDai.balanceOf(addr1.address))
        expect(await stataDai.balanceOf(addr1.address)).to.equal(bn(0))

        const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
        const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

        // Transfer plain DAI
        await whileImpersonating(holderDAI, async (daiSigner) => {
          await dai.connect(daiSigner).transfer(addr1.address, initialBal)
        })

        // Wrap DAI into a staticaDAI
        await dai.connect(addr1).approve(stataDai.address, initialBal)
        await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, true)

        // Balance for Static a Token is about 18641.55e18, about 93.21% of the provided amount (20K)
        const initialBalAToken = initialBal.mul(9321).div(10000)
        expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(initialBalAToken, fp('1.5'))

        // Provide approvals
        await dai.connect(addr1).approve(rToken.address, issueAmount)
        await stataDai.connect(addr1).approve(rToken.address, issueAmount)
        await cDai.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

        // Check rToken balance
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Issue rTokens
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmount,
          fp('150')
        ) // approx 10K in value
      })
    })

    context('With Complex basket', function () {
      let newBasket: Collateral[]
      let newBasketsNeededAmts: BigNumber[]

      beforeEach(async () => {
        // Set new basket
        newBasket = [
          wbtcCollateral,
          cWBTCCollateral,
          wethCollateral,
          cETHCollateral,
          eurtCollateral,
        ]
        newBasketsNeededAmts = [fp('1'), fp('1'), fp('1'), fp('1'), fp('1000')]

        // Register prime collateral and grant allowances
        const newBasketERC20s = []
        for (let i = 0; i < newBasket.length; i++) {
          await assetRegistry.connect(owner).register(newBasket[i].address)
          newBasketERC20s.push(await newBasket[i].erc20())
          // Grant allowance
          await backingManager.grantRTokenAllowance(await newBasket[i].erc20())
        }
        // Set non-empty basket
        await basketHandler.connect(owner).setPrimeBasket(newBasketERC20s, newBasketsNeededAmts)
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Approve all balances for user
        await wbtc.connect(addr1).approve(rToken.address, await wbtc.balanceOf(addr1.address))
        await cWBTC.connect(addr1).approve(rToken.address, await cWBTC.balanceOf(addr1.address))
        await weth.connect(addr1).approve(rToken.address, await weth.balanceOf(addr1.address))
        await cETH.connect(addr1).approve(rToken.address, await cETH.balanceOf(addr1.address))
        await eurt.connect(addr1).approve(rToken.address, await eurt.balanceOf(addr1.address))
      })

      it('Should Issue/Redeem (wBTC, cWBTC, wETH, cETH, EURT)', async () => {
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

        // Check prices
        // WBTC
        const btcTargetPrice = fp('31311.5') // June 6, 2022
        const wbtcRefPrice = fp('1.00062735') // approx price wbtc-btc
        const btcPrice = btcTargetPrice.mul(wbtcRefPrice).div(BN_SCALE_FACTOR)
        await expectPrice(wbtcCollateral.address, btcPrice, ORACLE_ERROR, true, bn('1e8'))

        // cWBTC
        const cWBTCPrice = btcTargetPrice
          .mul(wbtcRefPrice)
          .mul(fp('0.020065932166404677'))
          .div(BN_SCALE_FACTOR.pow(2))
        await expectPrice(cWBTCCollateral.address, cWBTCPrice, ORACLE_ERROR, true, bn('1e8')) // close to $633 usd

        // WETH
        const ethTargetPrice = fp('1859.17') //approx price June 2022
        await expectPrice(wethCollateral.address, ethTargetPrice, ORACLE_ERROR, true, bn('1e8'))

        // cETH
        const cETHPrice = ethTargetPrice.mul(fp('0.020064225660680504')).div(BN_SCALE_FACTOR)
        await expectPrice(cETHCollateral.address, cETHPrice, ORACLE_ERROR, true, bn('1e5'))

        // EURT
        const eurPrice = fp('1.07025') // approx price EURT-USD June 6, 2022
        await expectPrice(eurtCollateral.address, eurPrice, ORACLE_ERROR, true, bn('1e5')) // ref price approx 1.07

        // Aproximate total price of Basket in USD
        const totalPriceUSD = btcPrice.mul(2).add(ethTargetPrice.mul(2)).add(eurPrice.mul(1000))

        // Check Basket
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        const backing = await facade.basketTokens(rToken.address)
        expect(backing[0]).to.equal(wbtc.address)
        expect(backing[1]).to.equal(cWBTC.address)
        expect(backing[2]).to.equal(weth.address)
        expect(backing[3]).to.equal(cETH.address)
        expect(backing[4]).to.equal(eurt.address)
        expect(backing.length).to.equal(5)

        // Check initial values
        expect(await basketHandler.timestamp()).to.be.gt(bn(0))
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
        await expectPrice(basketHandler.address, totalPriceUSD, ORACLE_ERROR, true)
        await expectRTokenPrice(
          rTokenAsset.address,
          totalPriceUSD,
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        // Check rToken balance
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(rToken.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances before
        expect(await wbtc.balanceOf(backingManager.address)).to.equal(0)
        expect(await cWBTC.balanceOf(backingManager.address)).to.equal(0)
        expect(await weth.balanceOf(backingManager.address)).to.equal(0)
        expect(await cETH.balanceOf(backingManager.address)).to.equal(0)
        expect(await eurt.balanceOf(backingManager.address)).to.equal(0)

        expect(await wbtc.balanceOf(addr1.address)).to.equal(toBNDecimals(initialBalBtcEth, 8))
        expect(await cWBTC.balanceOf(addr1.address)).to.equal(
          toBNDecimals(initialBalBtcEth, 8).mul(1000)
        )
        expect(await weth.balanceOf(addr1.address)).to.equal(initialBalBtcEth)
        expect(await cETH.balanceOf(addr1.address)).to.equal(
          toBNDecimals(initialBalBtcEth, 8).mul(1000)
        )
        expect(await eurt.balanceOf(addr1.address)).to.equal(
          toBNDecimals(initialBalBtcEth, 6).mul(1000)
        )

        // Issue one RToken
        const issueAmount: BigNumber = bn('1e18')
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check Balances after
        expect(await wbtc.balanceOf(backingManager.address)).to.equal(toBNDecimals(issueAmount, 8)) //1 full units
        const requiredCWBTC: BigNumber = toBNDecimals(fp('49.85'), 8) // approx 49.5 cWBTC needed (~1 wbtc / 0.02006)
        expect(await cWBTC.balanceOf(backingManager.address)).to.be.closeTo(
          requiredCWBTC,
          point1Pct(requiredCWBTC)
        )
        expect(await weth.balanceOf(backingManager.address)).to.equal(issueAmount) //1 full units
        const requiredCETH: BigNumber = toBNDecimals(fp('49.8'), 8) // approx 49.8 cETH needed (~1 weth / 0.02020)
        expect(await cETH.balanceOf(backingManager.address)).to.be.closeTo(
          requiredCETH,
          point1Pct(requiredCETH)
        )
        expect(await eurt.balanceOf(backingManager.address)).to.equal(bn(1000e6))

        // Balances for user
        expect(await wbtc.balanceOf(addr1.address)).to.equal(
          toBNDecimals(initialBalBtcEth.sub(issueAmount), 8)
        )
        const expectedcWBTCBalance = toBNDecimals(initialBalBtcEth, 8).mul(1000).sub(requiredCWBTC)
        expect(await cWBTC.balanceOf(addr1.address)).to.be.closeTo(
          expectedcWBTCBalance,
          point1Pct(expectedcWBTCBalance)
        )
        expect(await weth.balanceOf(addr1.address)).to.equal(initialBalBtcEth.sub(issueAmount))
        const expectedcETHBalance = toBNDecimals(initialBalBtcEth, 8).mul(1000).sub(requiredCETH)
        expect(await cWBTC.balanceOf(addr1.address)).to.be.closeTo(
          expectedcETHBalance,
          point1Pct(expectedcETHBalance)
        )
        expect(await eurt.balanceOf(addr1.address)).to.equal(
          toBNDecimals(initialBalBtcEth.mul(1000).sub(issueAmount.mul(1000)), 6)
        )

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        expect(await rToken.balanceOf(rToken.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          totalPriceUSD,
          point1Pct(totalPriceUSD)
        )

        // Redeem Rtokens
        await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances after - Backing Manager is empty
        expect(await wbtc.balanceOf(backingManager.address)).to.equal(0)
        expect(await cWBTC.balanceOf(backingManager.address)).to.be.closeTo(bn(0), bn('10e9'))
        expect(await weth.balanceOf(backingManager.address)).to.equal(0)
        expect(await cETH.balanceOf(backingManager.address)).to.be.closeTo(bn(0), bn('10e9'))
        expect(await eurt.balanceOf(backingManager.address)).to.equal(0)

        // Check funds returned to user
        expect(await wbtc.balanceOf(addr1.address)).to.equal(toBNDecimals(initialBalBtcEth, 8))
        expect(await cWBTC.balanceOf(addr1.address)).to.be.closeTo(
          toBNDecimals(initialBalBtcEth, 8).mul(1000),
          bn('10e9')
        )
        expect(await weth.balanceOf(addr1.address)).to.equal(initialBalBtcEth)
        expect(await cETH.balanceOf(addr1.address)).to.be.closeTo(
          toBNDecimals(initialBalBtcEth, 8).mul(1000),
          bn('10e9')
        )
        expect(await eurt.balanceOf(addr1.address)).to.equal(
          toBNDecimals(initialBalBtcEth, 6).mul(1000)
        )

        //  Check asset value left
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          bn(0),
          fp('0.001')
        ) // Near zero
      })

      it('Should claim rewards (cWBTC, cETH)', async () => {
        // Try to claim rewards at this point - Nothing for Backing Manager
        expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
        ])

        // No rewards so far
        expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

        // Issue RTokens
        const issueAmount: BigNumber = bn('10e18')
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

        // Now we can claim rewards - check initial balance still 0
        expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

        // Advance Time
        await advanceTime(8000)

        // Claim rewards
        await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

        // Check rewards both in COMP
        const rewardsCOMP1: BigNumber = await compToken.balanceOf(backingManager.address)
        expect(rewardsCOMP1).to.be.gt(0)

        // Keep moving time
        await advanceTime(3600)

        // Get additional rewards
        await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

        const rewardsCOMP2: BigNumber = await compToken.balanceOf(backingManager.address)
        expect(rewardsCOMP2.sub(rewardsCOMP1)).to.be.gt(0)
      })
    })

    context('With USDT (Non-compliant token)', function () {
      let newBasket: Collateral[]
      let newBasketsNeededAmts: BigNumber[]

      beforeEach(async () => {
        // Set new basket
        newBasket = [usdtCollateral]
        newBasketsNeededAmts = [fp('1')]

        // Register prime collateral and grant allowances
        const newBasketERC20s = []
        for (let i = 0; i < newBasket.length; i++) {
          await assetRegistry.connect(owner).register(newBasket[i].address)
          newBasketERC20s.push(await newBasket[i].erc20())
          // Grant allowance
          await backingManager.grantRTokenAllowance(await newBasket[i].erc20())

          // Another call to grant allowance should not revert
          await backingManager.grantRTokenAllowance(await newBasket[i].erc20())
        }
        // Set non-empty basket
        await basketHandler.connect(owner).setPrimeBasket(newBasketERC20s, newBasketsNeededAmts)
        await basketHandler.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Approve all balances for user
        await usdt.connect(addr1).approve(rToken.address, await usdt.balanceOf(addr1.address))
      })

      it('Should Issue/Redeem (USDT)', async () => {
        // Check prices
        // USDT
        const usdtPrice = fp('0.999346920000000000') // June 2022
        await expectPrice(usdtCollateral.address, usdtPrice, ORACLE_ERROR, true)

        // Aproximate total price of Basket in USD
        const totalPriceUSD = usdtPrice

        // Check Basket
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        const backing = await facade.basketTokens(rToken.address)
        expect(backing[0]).to.equal(usdt.address)
        expect(backing.length).to.equal(1)

        // Check initial values
        expect(await basketHandler.timestamp()).to.be.gt(bn(0))
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
        await expectRTokenPrice(
          rTokenAsset.address,
          usdtPrice,
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )
        await expectPrice(basketHandler.address, totalPriceUSD, ORACLE_ERROR, true)

        // Check rToken balance
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(rToken.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances before
        expect(await usdt.balanceOf(backingManager.address)).to.equal(0)

        expect(await usdt.balanceOf(addr1.address)).to.equal(toBNDecimals(initialBal, 6))

        // Issue one RToken
        const issueAmount: BigNumber = bn('1e18')
        await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

        // Check Balances after
        const usdtBal = toBNDecimals(issueAmount, 6)
        expect(await usdt.balanceOf(backingManager.address)).to.be.gt(usdtBal)
        expect(await usdt.balanceOf(backingManager.address)).to.be.closeTo(usdtBal, 1000) //1 full unit

        // Balances for user
        const expected = toBNDecimals(
          initialBal.sub(await usdt.balanceOf(backingManager.address)),
          6
        )
        expect(await usdt.balanceOf(addr1.address)).to.be.closeTo(expected, point1Pct(expected))

        // Check RTokens issued to user
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        expect(await rToken.balanceOf(rToken.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          totalPriceUSD,
          point1Pct(totalPriceUSD)
        )

        // Redeem Rtokens
        await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances after - Backing Manager is basically empty
        expect(await usdt.balanceOf(backingManager.address)).to.be.closeTo(0, 1000)

        // Check funds returned to user
        expect(await usdt.balanceOf(addr1.address)).to.be.closeTo(toBNDecimals(initialBal, 6), 1000)

        //  Check asset value left
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          bn(0),
          fp('0.001')
        ) // Near zero
      })
    })
  })

  // Skip explanation:
  // - Aave hasn't run their reward program in a while
  // - We don't expect them to soon
  // - Rewards can always be collected later through a plugin upgrade
  describe.skip('Claim Rewards - ATokens/CTokens Fiat', () => {
    // const setup = async (blockNumber: number) => {
    //   ;[owner] = await ethers.getSigners()

    //   // Use Mainnet fork
    //   await hre.network.provider.request({
    //     method: 'hardhat_reset',
    //     params: [
    //       {
    //         forking: {
    //           jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
    //           blockNumber: blockNumber,
    //         },
    //       },
    //     ],
    //   })
    // }

    beforeEach(async () => {
      ;[owner, addr1] = await ethers.getSigners()
      ;({
        compToken,
        aaveToken,
        compAsset,
        aaveAsset,
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
      } = await loadFixture(defaultFixtureNoBasket))

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
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
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
    })

    it('Should claim rewards correctly- Simple basket', async function () {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimRewards(), [
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [compToken.address, bn(0)],
          emitted: true,
        },
        {
          contract: backingManager,
          name: 'RewardsClaimed',
          args: [aaveToken.address, bn(0)],
          emitted: true,
        },
      ])

      // No rewards so far
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)

      // Provide approvals for issuances
      await dai.connect(addr1).approve(rToken.address, issueAmount)
      await stataDai.connect(addr1).approve(rToken.address, issueAmount)
      await cDai.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 8).mul(100))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Now we can claim rewards - check initial balance still 0
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)

      // Advance Time
      await advanceTime(8000)

      // Claim rewards
      expect(await stataDai.getTotalClaimableRewards()).to.be.gt(0)
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards both in COMP and stkAAVE
      const rewardsCOMP1: BigNumber = await compToken.balanceOf(backingManager.address)
      const rewardsAAVE1: BigNumber = await aaveToken.balanceOf(backingManager.address)

      expect(rewardsCOMP1).to.be.gt(0)
      expect(rewardsAAVE1).to.be.gt(0)

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardsCOMP2: BigNumber = await compToken.balanceOf(backingManager.address)
      const rewardsAAVE2: BigNumber = await aaveToken.balanceOf(backingManager.address)

      expect(rewardsCOMP2.sub(rewardsCOMP1)).to.be.gt(0)
      expect(rewardsAAVE2.sub(rewardsAAVE1)).to.be.gt(0)
    })
  })
})

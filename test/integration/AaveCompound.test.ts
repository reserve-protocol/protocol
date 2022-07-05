import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { Collateral, IConfig, IMPLEMENTATION } from '../fixtures'
import { defaultFixture } from './fixtures'
import { CollateralStatus, ZERO_ADDRESS, MAX_ORACLE_TIMEOUT } from '../../common/constants'
import { expectEvents } from '../../common/events'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import {
  advanceBlocks,
  advanceTime,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '../utils/time'
import { whileImpersonating } from '../utils/impersonation'
import forkBlockNumber from './fork-block-numbers'

import {
  AAVE_INCENTIVES_ADDRESS,
  AAVE_LENDING_POOL_ADDRESS,
  ABUSD_ADDRESS,
  ADAI_ADDRESS,
  AUSDC_ADDRESS,
  AUSDT_ADDRESS,
  BUSD_ADDRESS,
  COMP_ADDRESS,
  CUSDC_ADDRESS,
  CUSDT_ADDRESS,
  CDAI_ADDRESS,
  DAI_ADDRESS,
  NO_PRICE_DATA_FEED,
  STAKEDAAVE_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
} from './mainnet'

import {
  Asset,
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  Facade,
  FiatCollateral,
  IAToken,
  IERC20,
  IBasketHandler,
  OracleLib,
  RTokenAsset,
  StaticATokenLM,
  StaticATokenMock,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIMain,
  TestIRToken,
  USDCMock,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
// DAI, cDAI, and aDAI Holders
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderCDAI = '0x01ec5e7e03e2835bb2d1ae8d2edded298780129c'
const holderADAI = '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296'

let owner: SignerWithAddress

// Setup test environment
const setup = async (blockNumber: number) => {
  ;[owner] = await ethers.getSigners()

  // Use Mainnet fork
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: blockNumber,
        },
      },
    ],
  })
}

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`Aave/Compound - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let addr1: SignerWithAddress

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

  let aDai: IAToken
  let aUsdc: IAToken
  let aUsdt: IAToken
  let aBusd: IAToken
  let stataDai: StaticATokenLM
  let stataUsdc: StaticATokenLM
  let stataUsdt: StaticATokenLM
  let stataBusd: StaticATokenLM

  let cDai: CTokenMock
  let cUsdc: CTokenMock
  let cUsdt: CTokenMock

  let daiCollateral: FiatCollateral
  let usdcCollateral: FiatCollateral
  let usdtCollateral: FiatCollateral
  let busdCollateral: FiatCollateral

  let aDaiCollateral: ATokenFiatCollateral
  let aUsdcCollateral: ATokenFiatCollateral
  let aUsdtCollateral: ATokenFiatCollateral
  let aBusdCollateral: ATokenFiatCollateral

  let cDaiCollateral: CTokenFiatCollateral
  let cUsdcCollateral: CTokenFiatCollateral
  let cUsdtCollateral: CTokenFiatCollateral

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let main: TestIMain
  let facade: Facade
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let config: IConfig
  let oracleLib: OracleLib

  let initialBal: BigNumber
  let basket: Collateral[]
  let erc20s: IERC20[]

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  describe('Assets/Collateral Setup', () => {
    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
    })

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()
      ;({
        compToken,
        aaveToken,
        compAsset,
        aaveAsset,
        compoundMock,
        erc20s,
        collateral,
        config,
        oracleLib,
      } = await loadFixture(defaultFixture))

      // Get tokens
      dai = <ERC20Mock>erc20s[0] // DAI
      usdc = <ERC20Mock>erc20s[1] // USDC
      usdt = <ERC20Mock>erc20s[2] // USDT
      busd = <ERC20Mock>erc20s[3] // BUSD
      cDai = <CTokenMock>erc20s[4] // cDAI
      cUsdc = <CTokenMock>erc20s[5] // cUSDC
      cUsdt = <CTokenMock>erc20s[6] // cUSDT
      stataDai = <StaticATokenLM>erc20s[7] // static aDAI
      stataUsdc = <StaticATokenLM>erc20s[8] // static aUSDC
      stataUsdt = <StaticATokenLM>erc20s[9] // static aUSDT
      stataBusd = <StaticATokenLM>erc20s[10] // static aBUSD

      // Get plain aTokens
      aDai = <IAToken>(
        await ethers.getContractAt('contracts/plugins/aave/IAToken.sol:IAToken', ADAI_ADDRESS)
      )

      aUsdc = <IAToken>(
        await ethers.getContractAt('contracts/plugins/aave/IAToken.sol:IAToken', AUSDC_ADDRESS)
      )
      aUsdt = <IAToken>(
        await ethers.getContractAt('contracts/plugins/aave/IAToken.sol:IAToken', AUSDT_ADDRESS)
      )
      aBusd = <IAToken>(
        await ethers.getContractAt('contracts/plugins/aave/IAToken.sol:IAToken', ABUSD_ADDRESS)
      )

      // Get collaterals
      daiCollateral = <FiatCollateral>collateral[0] // DAI
      usdcCollateral = <FiatCollateral>collateral[1] // USDC
      usdtCollateral = <FiatCollateral>collateral[2] // USDT
      busdCollateral = <FiatCollateral>collateral[3] // BUSD
      cDaiCollateral = <CTokenFiatCollateral>collateral[4] // cDAI
      cUsdcCollateral = <CTokenFiatCollateral>collateral[5] // cUSDC
      cUsdtCollateral = <CTokenFiatCollateral>collateral[6] // cUSDT
      aDaiCollateral = <ATokenFiatCollateral>collateral[7] // aDAI
      aUsdcCollateral = <ATokenFiatCollateral>collateral[8] // aUSDC
      aUsdtCollateral = <ATokenFiatCollateral>collateral[9] // aUSDT
      aBusdCollateral = <ATokenFiatCollateral>collateral[10] // aBUSD
    })

    it('Should setup assets correctly', async () => {
      // COMP Token
      expect(await compAsset.isCollateral()).to.equal(false)
      expect(await compAsset.erc20()).to.equal(compToken.address)
      expect(await compAsset.erc20()).to.equal(COMP_ADDRESS)
      expect(await compToken.decimals()).to.equal(18)
      expect(await compAsset.price()).to.be.closeTo(fp('58'), fp('0.5')) // Close to $58 USD - June 2022
      expect(await compAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await compAsset.rewardERC20()).to.equal(ZERO_ADDRESS)

      // stkAAVE Token
      expect(await aaveAsset.isCollateral()).to.equal(false)
      expect(await aaveAsset.erc20()).to.equal(aaveToken.address)
      expect(await aaveAsset.erc20()).to.equal(STAKEDAAVE_ADDRESS)
      expect(await aaveToken.decimals()).to.equal(18)
      expect(await aaveAsset.price()).to.be.closeTo(fp('104.8'), fp('0.5')) // Close to $104.8 USD - July 2022 - Uses AAVE price
      expect(await aaveAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await aaveAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    })

    it('Should setup collaterals correctly - Fiatcoins', async () => {
      // Define interface required for each fiat coin
      interface TokenInfo {
        token: ERC20Mock
        tokenDecimals: number
        tokenAddress: string
        tokenCollateral: FiatCollateral
      }

      // DAI - USDC - USDT - BUSD
      const tokenInfos: TokenInfo[] = [
        {
          token: dai,
          tokenDecimals: 18,
          tokenAddress: DAI_ADDRESS,
          tokenCollateral: daiCollateral,
        },
        {
          token: usdc,
          tokenDecimals: 6,
          tokenAddress: USDC_ADDRESS,
          tokenCollateral: usdcCollateral,
        },
        {
          token: usdt,
          tokenDecimals: 6,
          tokenAddress: USDT_ADDRESS,
          tokenCollateral: usdtCollateral,
        },
        {
          token: busd,
          tokenDecimals: 18,
          tokenAddress: BUSD_ADDRESS,
          tokenCollateral: busdCollateral,
        },
      ]

      for (const tkInf of tokenInfos) {
        // Fiat Token Assets
        expect(await tkInf.tokenCollateral.isCollateral()).to.equal(true)
        expect(await tkInf.tokenCollateral.erc20()).to.equal(tkInf.token.address)
        expect(await tkInf.tokenCollateral.erc20()).to.equal(tkInf.tokenAddress)
        expect(await tkInf.token.decimals()).to.equal(tkInf.tokenDecimals)
        expect(await tkInf.tokenCollateral.targetName()).to.equal(
          ethers.utils.formatBytes32String('USD')
        )
        expect(await tkInf.tokenCollateral.refPerTok()).to.equal(fp('1'))
        expect(await tkInf.tokenCollateral.targetPerRef()).to.equal(fp('1'))
        expect(await tkInf.tokenCollateral.pricePerTarget()).to.equal(fp('1'))
        expect(await tkInf.tokenCollateral.price()).to.be.closeTo(fp('1'), fp('0.05')) // Should always be close to $1

        expect(await tkInf.tokenCollateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
        expect(await tkInf.tokenCollateral.rewardERC20()).to.equal(ZERO_ADDRESS)
      }
    })

    it('Should setup collaterals correctly - Compound', async () => {
      // Define interface required for each ctoken
      interface CTokenInfo {
        token: ERC20Mock
        tokenAddress: string
        cToken: CTokenMock
        cTokenAddress: string
        cTokenCollateral: CTokenFiatCollateral
      }

      // Compound - cUSDC and cUSDT
      const cTokenInfos: CTokenInfo[] = [
        {
          token: dai,
          tokenAddress: DAI_ADDRESS,
          cToken: cDai,
          cTokenAddress: CDAI_ADDRESS,
          cTokenCollateral: cDaiCollateral,
        },
        {
          token: usdc,
          tokenAddress: USDC_ADDRESS,
          cToken: cUsdc,
          cTokenAddress: CUSDC_ADDRESS,
          cTokenCollateral: cUsdcCollateral,
        },
        {
          token: usdt,
          tokenAddress: USDT_ADDRESS,
          cToken: cUsdt,
          cTokenAddress: CUSDT_ADDRESS,
          cTokenCollateral: cUsdtCollateral,
        },
      ]

      for (const ctkInf of cTokenInfos) {
        // CToken
        expect(await ctkInf.cTokenCollateral.isCollateral()).to.equal(true)
        expect(await ctkInf.cTokenCollateral.referenceERC20Decimals()).to.equal(
          await ctkInf.token.decimals()
        )
        expect(await ctkInf.cTokenCollateral.erc20()).to.equal(ctkInf.cToken.address)
        expect(await ctkInf.cTokenCollateral.erc20()).to.equal(ctkInf.cTokenAddress)
        expect(await ctkInf.cToken.decimals()).to.equal(8)
        expect(await ctkInf.cTokenCollateral.targetName()).to.equal(
          ethers.utils.formatBytes32String('USD')
        )
        expect(await ctkInf.cTokenCollateral.refPerTok()).to.be.closeTo(fp('0.022'), fp('0.001'))
        expect(await ctkInf.cTokenCollateral.targetPerRef()).to.equal(fp('1'))
        expect(await ctkInf.cTokenCollateral.pricePerTarget()).to.equal(fp('1'))
        expect(await ctkInf.cTokenCollateral.prevReferencePrice()).to.equal(
          await ctkInf.cTokenCollateral.refPerTok()
        )
        expect(await ctkInf.cTokenCollateral.price()).to.be.closeTo(fp('0.022'), fp('0.001')) // close to $0.022 cents

        const calldata = compoundMock.interface.encodeFunctionData('claimComp', [owner.address])
        expect(await ctkInf.cTokenCollateral.connect(owner).getClaimCalldata()).to.eql([
          compoundMock.address,
          calldata,
        ])
        expect(await ctkInf.cTokenCollateral.rewardERC20()).to.equal(compToken.address)
      }
    })

    it('Should setup collaterals correctly - AAve', async () => {
      // Define interface required for each aToken
      interface ATokenInfo {
        token: ERC20Mock
        tokenAddress: string
        stataToken: StaticATokenLM
        aToken: IAToken
        aTokenAddress: string
        aTokenCollateral: ATokenFiatCollateral
      }

      // Aave - aUSDC, aUSDT, and aBUSD
      const aTokenInfos: ATokenInfo[] = [
        {
          token: dai,
          tokenAddress: DAI_ADDRESS,
          stataToken: stataDai,
          aToken: aDai,
          aTokenAddress: ADAI_ADDRESS,
          aTokenCollateral: aDaiCollateral,
        },
        {
          token: usdc,
          tokenAddress: USDC_ADDRESS,
          stataToken: stataUsdc,
          aToken: aUsdc,
          aTokenAddress: AUSDC_ADDRESS,
          aTokenCollateral: aUsdcCollateral,
        },
        {
          token: usdt,
          tokenAddress: USDT_ADDRESS,
          stataToken: stataUsdt,
          aToken: aUsdt,
          aTokenAddress: AUSDT_ADDRESS,
          aTokenCollateral: aUsdtCollateral,
        },
        {
          token: busd,
          tokenAddress: BUSD_ADDRESS,
          stataToken: stataBusd,
          aToken: aBusd,
          aTokenAddress: ABUSD_ADDRESS,
          aTokenCollateral: aBusdCollateral,
        },
      ]

      for (const atkInf of aTokenInfos) {
        // AToken
        expect(await atkInf.aTokenCollateral.isCollateral()).to.equal(true)
        expect(await atkInf.aTokenCollateral.erc20()).to.equal(atkInf.stataToken.address)
        expect(await atkInf.stataToken.decimals()).to.equal(await atkInf.token.decimals())
        expect(await atkInf.aTokenCollateral.targetName()).to.equal(
          ethers.utils.formatBytes32String('USD')
        )
        expect(await atkInf.aTokenCollateral.refPerTok()).to.be.closeTo(fp('1'), fp('0.095'))

        expect(await atkInf.aTokenCollateral.targetPerRef()).to.equal(fp('1'))
        expect(await atkInf.aTokenCollateral.pricePerTarget()).to.equal(fp('1'))
        expect(await atkInf.aTokenCollateral.prevReferencePrice()).to.be.closeTo(
          await atkInf.aTokenCollateral.refPerTok(),
          fp('0.000005')
        )

        expect(await atkInf.aTokenCollateral.price()).to.be.closeTo(fp('1'), fp('0.095'))

        const calldata = atkInf.stataToken.interface.encodeFunctionData('claimRewardsToSelf', [
          true,
        ])
        expect(await atkInf.aTokenCollateral.getClaimCalldata()).to.eql([
          atkInf.stataToken.address,
          calldata,
        ])
        expect(await atkInf.aTokenCollateral.rewardERC20()).to.equal(aaveToken.address)

        // Check StaticAToken
        expect(await atkInf.stataToken.name()).to.equal(
          'Static Aave interest bearing ' + (await atkInf.token.symbol())
        )
        expect(await atkInf.stataToken.symbol()).to.equal('stata' + (await atkInf.token.symbol()))
        expect(await atkInf.stataToken.decimals()).to.equal(await atkInf.token.decimals())
        expect(await atkInf.stataToken.LENDING_POOL()).to.equal(AAVE_LENDING_POOL_ADDRESS)
        expect(await atkInf.stataToken.INCENTIVES_CONTROLLER()).to.equal(AAVE_INCENTIVES_ADDRESS)
        expect(await atkInf.stataToken.ATOKEN()).to.equal(atkInf.aToken.address)
        expect(await atkInf.stataToken.ATOKEN()).to.equal(atkInf.aTokenAddress)
        expect(await atkInf.stataToken.ASSET()).to.equal(atkInf.token.address)
        expect(await atkInf.stataToken.ASSET()).to.equal(atkInf.tokenAddress)
        expect(await atkInf.stataToken.REWARD_TOKEN()).to.equal(aaveToken.address)
      }
    })

    it('Should handle invalid Price - Assets', async () => {
      // Setup Assets with no price - Use stkAAVE token
      const nonpriceToken: ERC20Mock = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', STAKEDAAVE_ADDRESS)
      )
      const nonpriceAaveAsset: Asset = <Asset>(
        await (
          await ethers.getContractFactory('Asset')
        ).deploy(
          NO_PRICE_DATA_FEED,
          nonpriceToken.address,
          aaveToken.address,
          config.maxTradeVolume,
          MAX_ORACLE_TIMEOUT
        )
      )

      const nonpriceCompoundAsset: Asset = <Asset>(
        await (
          await ethers.getContractFactory('Asset')
        ).deploy(
          NO_PRICE_DATA_FEED,
          nonpriceToken.address,
          compToken.address,
          config.maxTradeVolume,
          MAX_ORACLE_TIMEOUT
        )
      )

      // Aave - Assets with no price info return 0 , so they revert with Invalid Price
      await expect(nonpriceAaveAsset.price()).to.be.reverted

      // Compound - Assets with no price info revert with also with token config not found
      await expect(nonpriceCompoundAsset.price()).to.be.reverted
    })

    it('Should handle invalid Price - Collaterals - Fiat', async () => {
      const defaultThreshold = fp('0.05') // 5%
      const delayUntilDefault = bn('86400') // 24h

      // Setup Collateral with no price - Use stkAAVE token
      const nonpriceToken: ERC20Mock = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', STAKEDAAVE_ADDRESS)
      )

      // Fiat collateral - Aave
      const nonpriceAaveCollateral: FiatCollateral = <FiatCollateral>await (
        await ethers.getContractFactory('FiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        NO_PRICE_DATA_FEED,
        nonpriceToken.address,
        aaveToken.address,
        config.maxTradeVolume,
        MAX_ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault
      )

      // Fiat Collateral - Compound
      const nonpriceCompoundCollateral: FiatCollateral = <FiatCollateral>await (
        await ethers.getContractFactory('FiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        NO_PRICE_DATA_FEED,
        nonpriceToken.address,
        compToken.address,
        config.maxTradeVolume,
        MAX_ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault
      )

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Aave - Collateral with no price info return 0, so they revert with Invalid Price
      await expect(nonpriceAaveCollateral.price()).to.be.reverted

      // Refresh should mark status UNPRICED
      await nonpriceAaveCollateral.refresh()
      expect(await nonpriceAaveCollateral.status()).to.equal(CollateralStatus.UNPRICED)

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Compound - Assets with no price info revert with token config not found
      await expect(nonpriceCompoundCollateral.price()).to.be.reverted

      // Refresh should mark status UNPRICED
      await nonpriceCompoundCollateral.refresh()
      expect(await nonpriceCompoundCollateral.status()).to.equal(CollateralStatus.UNPRICED)
    })

    it('Should handle invalid Price - Collaterals - AToken/CToken', async () => {
      const defaultThreshold = fp('0.05') // 5%
      const delayUntilDefault = bn('86400') // 24h

      // Setup Collateral with no price - Use stkAAVE token
      const nonpriceToken: ERC20Mock = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', STAKEDAAVE_ADDRESS)
      )

      // Wrap in Static AToken (use mock in this case)
      const staticNonPriceErc20: StaticATokenMock = <StaticATokenMock>(
        await (
          await ethers.getContractFactory('StaticATokenMock')
        ).deploy(
          'static ' + (await nonpriceToken.name()),
          'stat' + (await nonpriceToken.symbol()),
          nonpriceToken.address
        )
      )

      // AToken collateral
      const nonpriceAtokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>await (
        await ethers.getContractFactory('ATokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        NO_PRICE_DATA_FEED,
        staticNonPriceErc20.address,
        aaveToken.address,
        config.maxTradeVolume,
        MAX_ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault
      )

      // Setup CToken (use mock for this purpose)
      const nonpriceCtoken: CTokenMock = <CTokenMock>(
        await (
          await ethers.getContractFactory('CTokenMock')
        ).deploy(
          'c' + (await nonpriceToken.name()),
          'c' + (await nonpriceToken.symbol()),
          nonpriceToken.address
        )
      )

      // CTokens Collateral
      const nonpriceCtokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>await (
        await ethers.getContractFactory('CTokenFiatCollateral', {
          libraries: { OracleLib: oracleLib.address },
        })
      ).deploy(
        NO_PRICE_DATA_FEED,
        nonpriceCtoken.address,
        compToken.address,
        config.maxTradeVolume,
        MAX_ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        defaultThreshold,
        delayUntilDefault,
        await nonpriceToken.decimals(),
        compoundMock.address
      )

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // ATokens - Collateral with no price info return 0, so they revert with Invalid Price
      await expect(nonpriceAtokenCollateral.price()).to.be.reverted

      // Refresh should mark status UNPRICED
      await nonpriceAtokenCollateral.refresh()
      expect(await nonpriceAtokenCollateral.status()).to.equal(CollateralStatus.UNPRICED)

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // CTokens - Collateral with no price info revert with token config not found
      await expect(nonpriceCtokenCollateral.price()).to.be.reverted

      // Refresh should mark status UNPRICED
      await nonpriceCtokenCollateral.refresh()
      expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.UNPRICED)
    })
  })

  describe('Basket/Issue/Redeem', () => {
    let addr2: SignerWithAddress

    // RSR
    let rsr: ERC20Mock
    let rsrAsset: Asset

    before(async () => {
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
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
      } = await loadFixture(defaultFixture))

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
        await ethers.getContractAt('contracts/plugins/aave/IAToken.sol:IAToken', ADAI_ADDRESS)
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

    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(dai.address)
      expect(backing[1]).to.equal(stataDai.address)
      expect(backing[2]).to.equal(cDai.address)

      expect(backing.length).to.equal(3)

      // Check other values
      expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.price()).to.be.closeTo(fp('1'), fp('0.015'))
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // Check RToken price
      expect(await rToken.price()).to.be.closeTo(fp('1'), fp('0.015'))
    })

    it('Should issue/reedem correctly', async function () {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Check balances before
      expect(await dai.balanceOf(backingManager.address)).to.equal(0)
      expect(await stataDai.balanceOf(backingManager.address)).to.equal(0)
      expect(await cDai.balanceOf(backingManager.address)).to.equal(0)
      expect(await dai.balanceOf(addr1.address)).to.equal(initialBal)

      // Balance for Static a Token is about 18641.55e18, about 93.21% of the provided amount (20K)
      const initialBalAToken = initialBal.mul(9321).div(10000)
      expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(initialBalAToken, fp('1'))
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
      const issueAmtAToken = issueAmount.div(4).mul(9321).div(10000) // approx 95.95% of 2.5K needed (25% of basket)
      expect(await stataDai.balanceOf(backingManager.address)).to.be.closeTo(
        issueAmtAToken,
        fp('1')
      )
      const requiredCTokens: BigNumber = bn('227116e8') // approx 227K needed (~5K, 50% of basket) - Price: ~0.022
      expect(await cDai.balanceOf(backingManager.address)).to.be.closeTo(requiredCTokens, bn(1e8))

      // Balances for user
      expect(await dai.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount.div(4)))
      expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(
        initialBalAToken.sub(issueAmtAToken),
        fp('1')
      )
      expect(await cDai.balanceOf(addr1.address)).to.be.closeTo(
        toBNDecimals(initialBal, 8).mul(100).sub(requiredCTokens),
        bn(1e8)
      )
      // Check RTokens issued to user
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      // Check asset value
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
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
      expect(await cDai.balanceOf(backingManager.address)).to.be.closeTo(bn(0), bn('1e6'))

      // Check funds returned to user
      expect(await dai.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(initialBalAToken, fp('1'))
      expect(await cDai.balanceOf(addr1.address)).to.be.closeTo(
        toBNDecimals(initialBal, 8).mul(100),
        bn('1e7')
      )

      // Check asset value left
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
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
      const aDaiPrice1: BigNumber = await aDaiCollateral.price() // ~1.07546
      const aDaiRefPerTok1: BigNumber = await aDaiCollateral.refPerTok() // ~ 1.07287
      const cDaiPrice1: BigNumber = await cDaiCollateral.price() // ~ 0.022015 cents
      const cDaiRefPerTok1: BigNumber = await cDaiCollateral.refPerTok() // ~ 0.022015 cents

      expect(aDaiPrice1).to.be.closeTo(fp('1'), fp('0.095'))
      expect(aDaiRefPerTok1).to.be.closeTo(fp('1'), fp('0.095'))
      expect(cDaiPrice1).to.be.closeTo(fp('0.022'), fp('0.001'))
      expect(cDaiRefPerTok1).to.be.closeTo(fp('0.022'), fp('0.001'))

      // Check total asset value
      const totalAssetValue1: BigNumber = await facade.callStatic.totalAssetValue(rToken.address)
      expect(totalAssetValue1).to.be.closeTo(issueAmount, fp('150')) // approx 10K in value

      // Advance time and blocks slightly
      await advanceTime(10000)
      await advanceBlocks(10000)

      // Refresh cToken manually (required)
      await cDaiCollateral.refresh()

      // Check rates and prices - Have changed, slight inrease
      const aDaiPrice2: BigNumber = await aDaiCollateral.price() // ~1.07548
      const aDaiRefPerTok2: BigNumber = await aDaiCollateral.refPerTok() // ~1.07288
      const cDaiPrice2: BigNumber = await cDaiCollateral.price() // ~0.022016
      const cDaiRefPerTok2: BigNumber = await cDaiCollateral.refPerTok() // ~0.022016

      // Check rates and price increase
      expect(aDaiPrice2).to.be.gt(aDaiPrice1)
      expect(aDaiRefPerTok2).to.be.gt(aDaiRefPerTok1)
      expect(cDaiPrice2).to.be.gt(cDaiPrice1)
      expect(cDaiRefPerTok2).to.be.gt(cDaiRefPerTok1)

      // Still close to the original values
      expect(aDaiPrice2).to.be.closeTo(fp('1'), fp('0.095'))
      expect(aDaiRefPerTok2).to.be.closeTo(fp('1'), fp('0.095'))
      expect(cDaiPrice2).to.be.closeTo(fp('0.022'), fp('0.001'))
      expect(cDaiRefPerTok2).to.be.closeTo(fp('0.022'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue2: BigNumber = await facade.callStatic.totalAssetValue(rToken.address)
      expect(totalAssetValue2).to.be.gt(totalAssetValue1)

      // Advance time and blocks significantly
      await advanceTime(100000000)
      await advanceBlocks(100000000)

      // Refresh cToken manually (required)
      await cDaiCollateral.refresh()

      // Check rates and prices - Have changed significantly
      const aDaiPrice3: BigNumber = await aDaiCollateral.price() // ~1.1873
      const aDaiRefPerTok3: BigNumber = await aDaiCollateral.refPerTok() // ~1.1845
      const cDaiPrice3: BigNumber = await cDaiCollateral.price() // ~0.03294
      const cDaiRefPerTok3: BigNumber = await cDaiCollateral.refPerTok() // ~0.03294

      // Check rates and price increase
      expect(aDaiPrice3).to.be.gt(aDaiPrice2)
      expect(aDaiRefPerTok3).to.be.gt(aDaiRefPerTok2)
      expect(cDaiPrice3).to.be.gt(cDaiPrice2)
      expect(cDaiRefPerTok3).to.be.gt(cDaiRefPerTok2)

      // Need to adjust ranges
      expect(aDaiPrice3).to.be.closeTo(fp('1.1'), fp('0.095'))
      expect(aDaiRefPerTok3).to.be.closeTo(fp('1.1'), fp('0.095'))
      expect(cDaiPrice3).to.be.closeTo(fp('0.032'), fp('0.001'))
      expect(cDaiRefPerTok3).to.be.closeTo(fp('0.032'), fp('0.001'))

      // Check total asset value increased
      const totalAssetValue3: BigNumber = await facade.callStatic.totalAssetValue(rToken.address)
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
      expect(newBalanceAddr1cDai.sub(balanceAddr1cDai)).to.be.closeTo(bn('151785e8'), bn('5e7')) // ~0.03294 * 151785.3 ~= 5K (50% of basket)

      // Check remainders in Backing Manager
      expect(await dai.balanceOf(backingManager.address)).to.equal(0)
      expect(await stataDai.balanceOf(backingManager.address)).to.be.closeTo(
        fp('219.64'), // ~= 260 usd in value
        fp('0.01')
      )
      expect(await cDai.balanceOf(backingManager.address)).to.be.closeTo(bn(75331e8), bn('5e7')) // ~= 2481 usd in value

      //  Check total asset value (remainder)
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        fp('2742'), // ~=  260usd + 2481 usd (from above)
        fp('1')
      )
    })

    it('Should also support StaticAToken from underlying', async () => {
      // Transfer out all existing stataDai - empty balance
      await stataDai.connect(addr1).transfer(addr2.address, await stataDai.balanceOf(addr1.address))
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
      expect(await stataDai.balanceOf(addr1.address)).to.be.closeTo(initialBalAToken, fp('1'))

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
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
        issueAmount,
        fp('150')
      ) // approx 10K in value
    })
  })

  describe.skip('Claim Rewards', () => {
    before(async () => {
      await setup(forkBlockNumber['aave-compound-rewards'])
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
    })

    beforeEach(async () => {
      ;[owner, addr1] = await ethers.getSigners()
      ;({
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
      } = await loadFixture(defaultFixture))

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
        await ethers.getContractAt('contracts/plugins/aave/IAToken.sol:IAToken', ADAI_ADDRESS)
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

    it('Should claim rewards correctly', async function () {
      const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Try to claim rewards at this point - Nothing for Backing Manager
      expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)

      await expectEvents(backingManager.claimAndSweepRewards(), [
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
      await expect(backingManager.claimAndSweepRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Check rewards both in COMP and stkAAVE
      const rewardsCOMP1: BigNumber = await compToken.balanceOf(backingManager.address)
      const rewardsAAVE1: BigNumber = await aaveToken.balanceOf(backingManager.address)

      expect(rewardsCOMP1).to.be.gt(0)
      expect(rewardsAAVE1).to.be.gt(0)

      // Keep moving time
      await advanceTime(3600)

      // Get additional rewards
      await expect(backingManager.claimAndSweepRewards()).to.emit(backingManager, 'RewardsClaimed')

      const rewardsCOMP2: BigNumber = await compToken.balanceOf(backingManager.address)
      const rewardsAAVE2: BigNumber = await aaveToken.balanceOf(backingManager.address)

      expect(rewardsCOMP2.sub(rewardsCOMP1)).to.be.gt(0)
      expect(rewardsAAVE2.sub(rewardsAAVE1)).to.be.gt(0)
    })
  })
})

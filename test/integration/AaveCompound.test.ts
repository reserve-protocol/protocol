import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { Collateral, IMPLEMENTATION } from '../fixtures'
import { defaultFixture } from './fixtures'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import { CollateralStatus, ZERO_ADDRESS } from '../../common/constants'
import { advanceBlocks, advanceTime } from '../utils/time'
import { whileImpersonating } from '../utils/impersonation'
import forkBlockNumber from './fork-block-numbers'

import {
  AAVE_INCENTIVES_ADDRESS,
  STAKEDAAVE_ADDRESS,
  COMP_ADDRESS,
  DAI_ADDRESS,
  USDC_ADDRESS,
  USDT_ADDRESS,
  BUSD_ADDRESS,
  AUSDC_ADDRESS,
  AUSDT_ADDRESS,
  ADAI_ADDRESS,
  ABUSD_ADDRESS,
  CUSDC_ADDRESS,
  CUSDT_ADDRESS,
  CDAI_ADDRESS,
  AAVE_LENDING_POOL_ADDRESS,
} from './mainnet'

import {
  AavePricedFiatCollateral,
  Asset,
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  Facade,
  IAToken,
  IERC20,
  IGnosis,
  IAaveIncentivesController,
  IBasketHandler,
  RTokenAsset,
  StaticATokenLM,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIBroker,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  USDCMock,
} from '../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

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

  let daiCollateral: AavePricedFiatCollateral
  let usdcCollateral: AavePricedFiatCollateral
  let usdtCollateral: AavePricedFiatCollateral
  let busdCollateral: AavePricedFiatCollateral

  let aDaiCollateral: ATokenFiatCollateral
  let aUsdcCollateral: ATokenFiatCollateral
  let aUsdtCollateral: ATokenFiatCollateral
  let aBusdCollateral: ATokenFiatCollateral

  let cDaiCollateral: CTokenFiatCollateral
  let cUsdcCollateral: CTokenFiatCollateral
  let cUsdtCollateral: CTokenFiatCollateral

  let erc20s: IERC20[]

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  describe('Assets/Collateral Setup', () => {
    before(async () => {
      await setup(forkBlockNumber['aave-compound-setup'])
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
    })

    beforeEach(async () => {
      ;[owner] = await ethers.getSigners()
      ;({ compToken, aaveToken, compAsset, aaveAsset, compoundMock, erc20s, collateral } =
        await loadFixture(defaultFixture))

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
      daiCollateral = <AavePricedFiatCollateral>collateral[0] // DAI
      usdcCollateral = <AavePricedFiatCollateral>collateral[1] // USDC
      usdtCollateral = <AavePricedFiatCollateral>collateral[2] // USDT
      busdCollateral = <AavePricedFiatCollateral>collateral[3] // BUSD
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
      expect(await aaveAsset.price()).to.be.closeTo(fp('105.5'), fp('0.5')) // Close to $105.5 USD - June 2022 - Uses AAVE price
      expect(await aaveAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
      expect(await aaveAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    })

    it('Should setup collaterals correctly - Fiatcoins', async () => {
      // Define interface required for each fiat coin
      interface TokenInfo {
        token: ERC20Mock
        tokenDecimals: number
        tokenAddress: string
        tokenCollateral: AavePricedFiatCollateral
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
        expect(await tkInf.tokenCollateral.referenceERC20()).to.equal(tkInf.token.address)
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
        expect(await ctkInf.cTokenCollateral.referenceERC20()).to.equal(ctkInf.token.address)
        expect(await ctkInf.cTokenCollateral.referenceERC20()).to.equal(ctkInf.tokenAddress)
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

        let calldata = compoundMock.interface.encodeFunctionData('claimComp', [owner.address])
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
        expect(await atkInf.aTokenCollateral.referenceERC20()).to.equal(atkInf.token.address)
        expect(await atkInf.aTokenCollateral.referenceERC20()).to.equal(atkInf.tokenAddress)
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

        let calldata = atkInf.stataToken.interface.encodeFunctionData('claimRewardsToSelf', [true])
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
  })

  describe('Basket/Issue/Redeem/Rewards', () => {
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress
    let other: SignerWithAddress

    // RSR
    let rsr: ERC20Mock
    let rsrAsset: Asset

    // Contracts to retrieve after deploy
    let rToken: TestIRToken
    let rTokenAsset: RTokenAsset
    let stRSR: TestIStRSR
    let furnace: TestIFurnace
    let main: TestIMain
    let facade: Facade
    let assetRegistry: TestIAssetRegistry
    let backingManager: TestIBackingManager
    let basketHandler: IBasketHandler
    let distributor: TestIDistributor
    let incentivesController: IAaveIncentivesController

    let initialBal: BigNumber

    let basket: Collateral[]
    let basketsNeededAmts: BigNumber[]

    // Trading
    let gnosis: IGnosis
    let broker: TestIBroker
    let rsrTrader: TestIRevenueTrader
    let rTokenTrader: TestIRevenueTrader

    // Relevant addresses (Mainnet)
    // DAI, cDAI, and aDAI Holders
    const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
    const holderCDAI = '0x01ec5e7e03e2835bb2d1ae8d2edded298780129c'
    const holderADAI = '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296'

    before(async () => {
      await setup(forkBlockNumber['aave-compound-rewards'])
      ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
      loadFixture = createFixtureLoader([wallet])
    })

    beforeEach(async () => {
      ;[owner, addr1, addr2, other] = await ethers.getSigners()
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
        basketsNeededAmts,
        main,
        assetRegistry,
        backingManager,
        basketHandler,
        distributor,
        rToken,
        rTokenAsset,
        furnace,
        stRSR,
        gnosis,
        broker,
        facade,
        rsrTrader,
        rTokenTrader,
      } = await loadFixture(defaultFixture))

      // Get assets and tokens for default basket
      daiCollateral = <AavePricedFiatCollateral>basket[0]
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
  })
})

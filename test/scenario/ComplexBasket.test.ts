import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp } from '../../common/numbers'
import {
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  Facade,
  FiatCollateral,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  StaticATokenMock,
  StaticATokenLM,
  TestIBackingManager,
  TestIRToken,
  WETH9,
  USDCMock,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'
import { BN_SCALE_FACTOR, CollateralStatus, ZERO_ADDRESS } from '../../common/constants'
import { expectTrade } from '../utils/trades'
import { setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'
import { deployMarket } from '../../tasks/deprecated/helper'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

describe(`Complex Basket - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Non-backing assets
  let compoundMock: ComptrollerMock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock

  // Tokens and Assets
  let initialBal: BigNumber
  let rewardAmount: BigNumber
  let totalPriceUSD: BigNumber

  let erc20s: ERC20Mock[]

  let weth: WETH9

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let basketHandler: IBasketHandler
  let facade: Facade
  let backingManager: TestIBackingManager
  let oracleLib: OracleLib

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  const prepareBacking = async (backing: string[]) => {
    for (let i = 0; i < backing.length; i++) {
      const erc20 = await ethers.getContractAt('ERC20Mock', backing[i])
      await erc20.mint(addr1.address, initialBal)
      await erc20.connect(addr1).approve(rToken.address, initialBal)

      // Grant allowances
      await backingManager.grantRTokenAllowance(erc20.address)
    }
  }

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Deploy fixture
    ;({
      compoundMock,
      compToken,
      aaveToken,
      erc20s,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      facade,
      oracleLib,
    } = await loadFixture(defaultFixture))

    // Mint initial balances
    initialBal = bn('1000000e18')
    rewardAmount = bn('0.5e18')

    // Setup Factories
    const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const WETH: ContractFactory = await ethers.getContractFactory('WETH9')
    const CToken: ContractFactory = await ethers.getContractFactory('CTokenMock')
    const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
      'MockV3Aggregator'
    )

    /*****  Setup Basket  ***********/
    // 1. FiatCollateral against USD
    // 2. FiatCollateral against EUR
    // 3. CTokenFiatCollateral against USD
    // 4. ATokenFiatCollateral against USD
    // 5. NonFiatCollateral WBTC against BTC
    // 6. CTokenNonFiatCollateral cWBTC against BTC
    // 7. SelfReferentialCollateral WETH against ETH
    // 8. CTokenSelfReferentialCollateral cETH against ETH

    const primeBasketERC20s = []
    const targetPricesInUoA = []

    // 1. FiatCollateral against USD
    const usdToken = erc20s[0] // DAI Token
    const usdFeed: MockV3Aggregator = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    )
    const { collateral: fiatUSD } = await hre.run('deploy-fiat-collateral', {
      priceFeed: usdFeed.address,
      tokenAddress: usdToken.address, // DAI Token
      rewardToken: ZERO_ADDRESS,
      maxTradeVolume: config.maxTradeVolume.toString(),
      maxOracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLibrary: oracleLib.address,
    })

    await assetRegistry.swapRegistered(fiatUSD)
    primeBasketERC20s.push(usdToken.address)
    targetPricesInUoA.push(fp('1')) // USD Target

    // 2. FiatCollateral against EUR
    const eurToken: ERC20Mock = <ERC20Mock>await ERC20.deploy('EUR Token', 'EUR')
    const eurTargetUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const eurRefUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const { collateral: fiatEUR } = await hre.run('deploy-eurfiat-collateral', {
      referenceUnitFeed: eurRefUnitFeed.address,
      targetUnitFeed: eurTargetUnitFeed.address,
      tokenAddress: eurToken.address,
      rewardToken: ZERO_ADDRESS,
      maxTradeVolume: config.maxTradeVolume.toString(),
      maxOracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: ethers.utils.formatBytes32String('EURO'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLibrary: oracleLib.address,
    })

    await assetRegistry.register(fiatEUR)
    primeBasketERC20s.push(eurToken.address)
    targetPricesInUoA.push(fp('1')) // EUR = USD Target

    // 3. CTokenFiatCollateral against USD
    const cUSDToken = erc20s[4] // cDAI Token
    const { collateral: cUSDCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
      priceFeed: usdFeed.address,
      cToken: cUSDToken.address,
      rewardToken: compToken.address,
      maxTradeVolume: config.maxTradeVolume.toString(),
      maxOracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      comptroller: compoundMock.address,
      oracleLibrary: oracleLib.address,
    })

    await assetRegistry.swapRegistered(cUSDCollateral)
    primeBasketERC20s.push(cUSDToken.address)
    targetPricesInUoA.push(fp('1')) // USD Target

    // 4. ATokenFiatCollateral against USD
    const aUSDToken = erc20s[7] // aDAI Token
    const { collateral: aUSDCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
      priceFeed: usdFeed.address,
      staticAToken: aUSDToken.address,
      rewardToken: aaveToken.address,
      maxTradeVolume: config.maxTradeVolume.toString(),
      maxOracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLibrary: oracleLib.address,
    })

    await assetRegistry.swapRegistered(aUSDCollateral)
    primeBasketERC20s.push(aUSDToken.address)
    targetPricesInUoA.push(fp('1')) // USD Target

    // 5. NonFiatCollateral WBTC against BTC
    const wbtc: ERC20Mock = <ERC20Mock>await ERC20.deploy('WBTC Token', 'WBTC')
    const targetUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('20000e8')) // $20k
    const referenceUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8')) // 1 WBTC/BTC
    const { collateral: wBTCCollateral } = await hre.run('deploy-nonfiat-collateral', {
      referenceUnitFeed: referenceUnitFeed.address,
      targetUnitFeed: targetUnitFeed.address,
      tokenAddress: wbtc.address,
      rewardToken: ZERO_ADDRESS,
      maxTradeVolume: config.maxTradeVolume.toString(),
      maxOracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: ethers.utils.formatBytes32String('BTC'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLibrary: oracleLib.address,
    })

    await assetRegistry.register(wBTCCollateral)
    primeBasketERC20s.push(wbtc.address)
    targetPricesInUoA.push(fp('20000')) // BTC Target

    // 6. CTokenNonFiatCollateral cWBTC against BTC
    const cWBTC: CTokenMock = <CTokenMock>await CToken.deploy('cWBTC Token', 'cWBTC', wbtc.address)
    const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
      referenceUnitFeed: referenceUnitFeed.address,
      targetUnitFeed: targetUnitFeed.address,
      cToken: cWBTC.address,
      rewardToken: compToken.address,
      maxTradeVolume: config.maxTradeVolume.toString(),
      maxOracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('BTC'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      comptroller: compoundMock.address,
      oracleLibrary: oracleLib.address,
    })

    await assetRegistry.register(cWBTCCollateral)
    primeBasketERC20s.push(cWBTC.address)
    targetPricesInUoA.push(fp('20000')) // BTC Target

    // 7. SelfReferentialCollateral WETH against ETH
    weth = <WETH9>await WETH.deploy()
    const ethFeed = await MockV3AggregatorFactory.deploy(8, bn('1200e8'))
    const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
      priceFeed: ethFeed.address,
      tokenAddress: weth.address,
      rewardToken: ZERO_ADDRESS,
      maxTradeVolume: config.maxTradeVolume.toString(),
      maxOracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      oracleLibrary: oracleLib.address,
    })

    await assetRegistry.register(wETHCollateral)
    primeBasketERC20s.push(weth.address)
    targetPricesInUoA.push(fp('1200')) // ETH Target

    // 8. CTokenSelfReferentialCollateral cETH against ETH
    const cETH: CTokenMock = <CTokenMock>await CToken.deploy('cETH Token', 'cETH', weth.address)
    const { collateral: cETHCollateral } = await hre.run(
      'deploy-ctoken-selfreferential-collateral',
      {
        priceFeed: ethFeed.address,
        cToken: cETH.address,
        rewardToken: compToken.address,
        maxTradeVolume: config.maxTradeVolume.toString(),
        maxOracleTimeout: ORACLE_TIMEOUT.toString(),
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        decimals: bn(18).toString(),
        comptroller: compoundMock.address,
        oracleLibrary: oracleLib.address,
      }
    )
    await assetRegistry.register(cETHCollateral)
    primeBasketERC20s.push(cETH.address)
    targetPricesInUoA.push(fp('1200')) // ETH Target

    const targetAmts = []
    totalPriceUSD = bn(0)
    for (let i = 0; i < primeBasketERC20s.length; i++) {
      const amt = fp(2 ** i)
      targetAmts.push(amt)
      totalPriceUSD = totalPriceUSD.add(amt.mul(targetPricesInUoA[i]).div(BN_SCALE_FACTOR))
    }

    // Set basket
    await basketHandler.setPrimeBasket(primeBasketERC20s, targetAmts)
    await basketHandler.connect(owner).refreshBasket()
  })

  it('Should Issue/Redeem with max basket correctly', async () => {
    // Basket
    expect(await basketHandler.fullyCapitalized()).to.equal(true)
    const backing: string[] = await facade.basketTokens(rToken.address)
    expect(backing.length).to.equal(8)

    // Check other values
    expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    expect(await basketHandler.price()).to.equal(totalPriceUSD)
    expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(0)

    // Mint and approve initial balances
    await prepareBacking(backing)
    // WETH needs to be deposited
    await weth.connect(addr1).deposit({
      value: ethers.utils.parseUnits(bn('128e18').toString(), 'wei'),
    })

    // Issue
    const issueAmt = bn('1e18')
    await rToken.connect(addr1).issue(issueAmt)
    expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)

    // Redeem
    await rToken.connect(addr1).redeem(issueAmt)
    expect(await rToken.balanceOf(addr1.address)).to.equal(0)
  })
})

import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp, pow10, toBNDecimals } from '../../common/numbers'
import {
  Asset,
  ComptrollerMock,
  CTokenMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  GnosisMock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIRevenueTrader,
  TestIRToken,
  WETH9,
  TestIFurnace,
  TestIStRSR,
  TestIDistributor,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'
import { BN_SCALE_FACTOR, CollateralStatus, FURNACE_DEST, STRSR_DEST } from '../../common/constants'
import { expectTrade, getTrade } from '../utils/trades'
import { setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
const MAX_TRADE_VOLUME = fp('1e7') // $10M

const point5Pct = (value: BigNumber): BigNumber => {
  return value.mul(5).div(1000)
}

const createFixtureLoader = waffle.createFixtureLoader

describe(`Complex Basket - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Non-backing assets
  let rsr: ERC20Mock
  let compoundMock: ComptrollerMock
  let compToken: ERC20Mock
  let compAsset: Asset
  let aaveToken: ERC20Mock
  let rsrAsset: Asset
  let rTokenAsset: RTokenAsset

  // Trading
  let gnosis: GnosisMock
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Tokens and Assets
  let initialBal: BigNumber
  let rewardAmount: BigNumber
  let wethDepositAmt: BigNumber
  let totalPriceUSD: BigNumber

  let erc20s: ERC20Mock[]
  let collateral: Collateral[]
  let primeBasketERC20s: string[]
  let targetAmts: BigNumber[]
  let targetPricesInUoA: BigNumber[]

  let usdToken: ERC20Mock
  let eurToken: ERC20Mock
  let cUSDToken: CTokenMock
  let aUSDToken: StaticATokenMock
  let wbtc: ERC20Mock
  let cWBTC: CTokenMock
  let cETH: CTokenMock

  let weth: WETH9

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let distributor: TestIDistributor
  let furnace: TestIFurnace
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let assetRegistry: IAssetRegistry
  let basketHandler: IBasketHandler
  let facade: FacadeRead
  let facadeTest: FacadeTest
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
      compAsset,
      aaveToken,
      erc20s,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      facade,
      facadeTest,
      rsr,
      rsrAsset,
      furnace,
      distributor,
      stRSR,
      rTokenTrader,
      rsrTrader,
      gnosis,
      oracleLib,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    // Mint initial balances
    initialBal = bn('100000000e18')

    // Set large amount of Eth to addr1 (to be able to mint WETH)
    await hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [addr1.address, '0xfffffffffffffffffffffff'],
    })

    // Setup Factories
    const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
    const WETH: ContractFactory = await ethers.getContractFactory('WETH9')
    const CToken: ContractFactory = await ethers.getContractFactory('CTokenMock')
    const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
      'MockV3Aggregator'
    )

    // Replace RSRAsset

    const AssetFactory = await ethers.getContractFactory('Asset')

    const newRSRAsset: Asset = <Asset>(
      await AssetFactory.deploy(
        fp('1'),
        await rsrAsset.chainlinkFeed(),
        rsr.address,
        MAX_TRADE_VOLUME,
        ORACLE_TIMEOUT
      )
    )
    await assetRegistry.connect(owner).swapRegistered(newRSRAsset.address)
    rsrAsset = newRSRAsset

    /*****  Setup Basket  ***********/
    // 0. FiatCollateral against USD
    // 1. FiatCollateral against EUR
    // 2. CTokenFiatCollateral against USD
    // 3. ATokenFiatCollateral against USD
    // 4. NonFiatCollateral WBTC against BTC
    // 5. CTokenNonFiatCollateral cWBTC against BTC
    // 6. SelfReferentialCollateral WETH against ETH
    // 7. CTokenSelfReferentialCollateral cETH against ETH

    primeBasketERC20s = []
    targetPricesInUoA = []
    collateral = []

    // 1. FiatCollateral against USD
    usdToken = erc20s[0] // DAI Token
    const usdFeed: MockV3Aggregator = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    )
    const { collateral: fiatUSD } = await hre.run('deploy-fiat-collateral', {
      fallbackPrice: fp('1').toString(),
      priceFeed: usdFeed.address,
      tokenAddress: usdToken.address, // DAI Token
      maxTradeVolume: MAX_TRADE_VOLUME.toString(),
      oracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLib: oracleLib.address,
      noOutput: true,
    })

    await assetRegistry.swapRegistered(fiatUSD)
    primeBasketERC20s.push(usdToken.address)
    targetPricesInUoA.push(fp('1')) // USD Target
    collateral.push(await ethers.getContractAt('Collateral', fiatUSD))

    // 2. FiatCollateral against EUR
    eurToken = <ERC20Mock>await ERC20.deploy('EUR Token', 'EUR')
    const eurTargetUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    const eurRefUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

    const { collateral: fiatEUR } = await hre.run('deploy-eurfiat-collateral', {
      fallbackPrice: fp('1').toString(),
      referenceUnitFeed: eurRefUnitFeed.address,
      targetUnitFeed: eurTargetUnitFeed.address,
      tokenAddress: eurToken.address,
      maxTradeVolume: MAX_TRADE_VOLUME.toString(),
      oracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: ethers.utils.formatBytes32String('EURO'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLib: oracleLib.address,
      noOutput: true,
    })

    await assetRegistry.register(fiatEUR)
    primeBasketERC20s.push(eurToken.address)
    targetPricesInUoA.push(fp('1')) // EUR = USD Target
    collateral.push(await ethers.getContractAt('Collateral', fiatEUR))

    // 3. CTokenFiatCollateral against USD
    cUSDToken = <CTokenMock>erc20s[4] // cDAI Token
    const { collateral: cUSDCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
      fallbackPrice: fp('1').div(50).toString(),
      priceFeed: usdFeed.address,
      cToken: cUSDToken.address,
      maxTradeVolume: MAX_TRADE_VOLUME.toString(),
      oracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      comptroller: compoundMock.address,
      oracleLib: oracleLib.address,
      noOutput: true,
    })

    await assetRegistry.swapRegistered(cUSDCollateral)
    primeBasketERC20s.push(cUSDToken.address)
    targetPricesInUoA.push(fp('1')) // USD Target
    collateral.push(await ethers.getContractAt('Collateral', cUSDCollateral))

    // 4. ATokenFiatCollateral against USD
    aUSDToken = <StaticATokenMock>erc20s[7] // aDAI Token
    const { collateral: aUSDCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
      fallbackPrice: fp('1').toString(),
      priceFeed: usdFeed.address,
      staticAToken: aUSDToken.address,
      maxTradeVolume: MAX_TRADE_VOLUME.toString(),
      oracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLib: oracleLib.address,
      noOutput: true,
    })

    await assetRegistry.swapRegistered(aUSDCollateral)
    primeBasketERC20s.push(aUSDToken.address)
    targetPricesInUoA.push(fp('1')) // USD Target
    collateral.push(await ethers.getContractAt('Collateral', aUSDCollateral))

    // 5. NonFiatCollateral WBTC against BTC
    wbtc = <ERC20Mock>await ERC20.deploy('WBTC Token', 'WBTC')
    const targetUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('20000e8')) // $20k
    const referenceUnitFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8')) // 1 WBTC/BTC
    const { collateral: wBTCCollateral } = await hre.run('deploy-nonfiat-collateral', {
      fallbackPrice: fp('20000').toString(),
      referenceUnitFeed: referenceUnitFeed.address,
      targetUnitFeed: targetUnitFeed.address,
      tokenAddress: wbtc.address,
      maxTradeVolume: MAX_TRADE_VOLUME.toString(),
      oracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: ethers.utils.formatBytes32String('BTC'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLib: oracleLib.address,
      noOutput: true,
    })

    await assetRegistry.register(wBTCCollateral)
    primeBasketERC20s.push(wbtc.address)
    targetPricesInUoA.push(fp('20000')) // BTC Target
    collateral.push(await ethers.getContractAt('Collateral', wBTCCollateral))

    // 6. CTokenNonFiatCollateral cWBTC against BTC
    cWBTC = <CTokenMock>await CToken.deploy('cWBTC Token', 'cWBTC', wbtc.address)
    const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
      fallbackPrice: fp('20000').div(50).toString(),
      referenceUnitFeed: referenceUnitFeed.address,
      targetUnitFeed: targetUnitFeed.address,
      cToken: cWBTC.address,
      maxTradeVolume: MAX_TRADE_VOLUME.toString(),
      oracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('BTC'),
      defaultThreshold: DEFAULT_THRESHOLD.toString(),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      comptroller: compoundMock.address,
      oracleLib: oracleLib.address,
      noOutput: true,
    })

    await assetRegistry.register(cWBTCCollateral)
    primeBasketERC20s.push(cWBTC.address)
    targetPricesInUoA.push(fp('20000')) // BTC Target
    collateral.push(await ethers.getContractAt('Collateral', cWBTCCollateral))

    // 7. SelfReferentialCollateral WETH against ETH
    // Give higher maxTradeVolume: MAX_TRADE_VOLUME.toString(),
    weth = <WETH9>await WETH.deploy()
    const ethFeed = await MockV3AggregatorFactory.deploy(8, bn('1200e8'))
    const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
      fallbackPrice: fp('1200').toString(),
      priceFeed: ethFeed.address,
      tokenAddress: weth.address,
      maxTradeVolume: MAX_TRADE_VOLUME.toString(),
      oracleTimeout: ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      oracleLib: oracleLib.address,
      noOutput: true,
    })

    await assetRegistry.register(wETHCollateral)
    primeBasketERC20s.push(weth.address)
    targetPricesInUoA.push(fp('1200')) // ETH Target
    collateral.push(await ethers.getContractAt('Collateral', wETHCollateral))

    // 8. CTokenSelfReferentialCollateral cETH against ETH
    // Give higher maxTradeVolume: MAX_TRADE_VOLUME.toString(),
    cETH = <CTokenMock>await CToken.deploy('cETH Token', 'cETH', weth.address)
    const { collateral: cETHCollateral } = await hre.run(
      'deploy-ctoken-selfreferential-collateral',
      {
        fallbackPrice: fp('1200').div(50).toString(),
        priceFeed: ethFeed.address,
        cToken: cETH.address,
        maxTradeVolume: MAX_TRADE_VOLUME.toString(),
        oracleTimeout: ORACLE_TIMEOUT.toString(),
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
        decimals: bn(18).toString(),
        comptroller: compoundMock.address,
        oracleLib: oracleLib.address,
        noOutput: true,
      }
    )
    await assetRegistry.register(cETHCollateral)
    primeBasketERC20s.push(cETH.address)
    targetPricesInUoA.push(fp('1200')) // ETH Target
    collateral.push(await ethers.getContractAt('Collateral', cETHCollateral))

    targetAmts = []
    totalPriceUSD = bn(0)
    for (let i = 0; i < primeBasketERC20s.length; i++) {
      const amt = fp(2 ** i)
      targetAmts.push(amt)
      totalPriceUSD = totalPriceUSD.add(amt.mul(targetPricesInUoA[i]).div(BN_SCALE_FACTOR))
    }

    // Set basket
    await basketHandler.setPrimeBasket(primeBasketERC20s, targetAmts)
    await basketHandler.connect(owner).refreshBasket()

    // Mint and approve initial balances
    const backing: string[] = await facade.basketTokens(rToken.address)
    await prepareBacking(backing)
    // WETH needs to be deposited
    wethDepositAmt = initialBal
    await weth.connect(addr1).deposit({
      value: ethers.utils.parseUnits(wethDepositAmt.toString(), 'wei'),
    })
  })

  it('Should Issue/Redeem correctly', async () => {
    // Basket
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    const backing: string[] = await facade.basketTokens(rToken.address)
    expect(backing.length).to.equal(8)

    // Check other values
    expect(await basketHandler.nonce()).to.be.gt(bn(0))
    expect(await basketHandler.timestamp()).to.be.gt(bn(0))
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    const [isFallback, price] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    expect(price).to.equal(totalPriceUSD)

    const issueAmt = bn('10e18')

    // Get quotes
    const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmt)

    // Issue
    await rToken.connect(addr1).issue(issueAmt)
    expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)
    expect(await rToken.totalSupply()).to.equal(issueAmt)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
      issueAmt.mul(totalPriceUSD.div(BN_SCALE_FACTOR))
    )

    const [isFallback2, price2] = await basketHandler.price(true)
    expect(isFallback2).to.equal(false)
    expect(price2).to.equal(totalPriceUSD)

    // Set expected quotes
    const expectedTkn0: BigNumber = issueAmt.mul(targetAmts[0]).div(await collateral[0].refPerTok())
    const expectedTkn1: BigNumber = issueAmt.mul(targetAmts[1]).div(await collateral[1].refPerTok())
    const expectedTkn2: BigNumber = toBNDecimals(
      issueAmt.mul(targetAmts[2]).div(await collateral[2].refPerTok()),
      8
    ) // cToken
    const expectedTkn3: BigNumber = issueAmt.mul(targetAmts[3]).div(await collateral[3].refPerTok())
    const expectedTkn4: BigNumber = issueAmt.mul(targetAmts[4]).div(await collateral[4].refPerTok())
    const expectedTkn5: BigNumber = toBNDecimals(
      issueAmt.mul(targetAmts[5]).div(await collateral[5].refPerTok()),
      8
    ) // cToken
    const expectedTkn6: BigNumber = issueAmt.mul(targetAmts[6]).div(await collateral[6].refPerTok())
    const expectedTkn7: BigNumber = toBNDecimals(
      issueAmt.mul(targetAmts[7]).div(await collateral[7].refPerTok()),
      8
    ) // cToken

    // Check balances
    expect(await usdToken.balanceOf(backingManager.address)).to.equal(expectedTkn0)
    expect(await usdToken.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))
    expect(expectedTkn0).to.equal(quotes[0])

    expect(await eurToken.balanceOf(backingManager.address)).to.equal(expectedTkn1)
    expect(await eurToken.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))
    expect(expectedTkn1).to.equal(quotes[1])

    expect(await cUSDToken.balanceOf(backingManager.address)).to.equal(expectedTkn2)
    expect(await cUSDToken.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))
    expect(expectedTkn2).to.equal(quotes[2])

    expect(await aUSDToken.balanceOf(backingManager.address)).to.equal(expectedTkn3)
    expect(await aUSDToken.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))
    expect(expectedTkn3).to.equal(quotes[3])

    expect(await wbtc.balanceOf(backingManager.address)).to.equal(expectedTkn4)
    expect(await wbtc.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn4))
    expect(expectedTkn4).to.equal(quotes[4])

    expect(await cWBTC.balanceOf(backingManager.address)).to.equal(expectedTkn5)
    expect(await cWBTC.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn5))
    expect(expectedTkn5).to.equal(quotes[5])

    expect(await weth.balanceOf(backingManager.address)).to.equal(expectedTkn6)
    expect(await weth.balanceOf(addr1.address)).to.equal(wethDepositAmt.sub(expectedTkn6))
    expect(expectedTkn6).to.equal(quotes[6])

    expect(await cETH.balanceOf(backingManager.address)).to.equal(expectedTkn7)
    expect(await cETH.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn7))
    expect(expectedTkn7).to.equal(quotes[7])

    // Redeem
    await rToken.connect(addr1).redeem(issueAmt)
    expect(await rToken.balanceOf(addr1.address)).to.equal(0)
    expect(await rToken.totalSupply()).to.equal(0)

    // Check balances - Back to initial status
    expect(await usdToken.balanceOf(backingManager.address)).to.equal(0)
    expect(await usdToken.balanceOf(addr1.address)).to.equal(initialBal)

    expect(await eurToken.balanceOf(backingManager.address)).to.equal(0)
    expect(await eurToken.balanceOf(addr1.address)).to.equal(initialBal)

    expect(await cUSDToken.balanceOf(backingManager.address)).to.equal(0)
    expect(await cUSDToken.balanceOf(addr1.address)).to.equal(initialBal)

    expect(await aUSDToken.balanceOf(backingManager.address)).to.equal(0)
    expect(await aUSDToken.balanceOf(addr1.address)).to.equal(initialBal)

    expect(await wbtc.balanceOf(backingManager.address)).to.equal(0)
    expect(await wbtc.balanceOf(addr1.address)).to.equal(initialBal)

    expect(await cWBTC.balanceOf(backingManager.address)).to.equal(0)
    expect(await cWBTC.balanceOf(addr1.address)).to.equal(initialBal)

    expect(await weth.balanceOf(backingManager.address)).to.equal(0)
    expect(await weth.balanceOf(addr1.address)).to.equal(wethDepositAmt)

    expect(await cETH.balanceOf(backingManager.address)).to.equal(0)
    expect(await cETH.balanceOf(addr1.address)).to.equal(initialBal)
  })

  it('Should claim COMP rewards correctly - All RSR', async () => {
    // Set RSR price
    const rsrPrice = fp('0.005') // 0.005 usd
    await setOraclePrice(rsrAsset.address, toBNDecimals(rsrPrice, 8))

    // Set COMP price
    const compPrice = fp('50') // 50 usd
    await setOraclePrice(compAsset.address, toBNDecimals(compPrice, 8))

    // Set Reward amount  = approx 5 usd
    rewardAmount = bn('0.1e18')

    // Mint some RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)

    // Set f=1 // All revenues to RSR
    await expect(
      distributor
        .connect(owner)
        .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
    )
      .to.emit(distributor, 'DistributionSet')
      .withArgs(FURNACE_DEST, bn(0), bn(0))

    // Avoid dropping qCOMP by making there be exactly 1 distribution share.
    await expect(
      distributor.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })
    )
      .to.emit(distributor, 'DistributionSet')
      .withArgs(STRSR_DEST, bn(0), bn(1))

    // COMP Rewards
    await compoundMock.setRewards(backingManager.address, rewardAmount)

    // Collect revenue - Called via poke
    // Expected values based on Prices between COMP and RSR - Need about 1000 RSR for 5 usd of COMP
    const sellAmt: BigNumber = rewardAmount // all will be sold
    const requiredRSRAmt: BigNumber = rewardAmount.mul(compPrice).div(rsrPrice)
    const minBuyAmt: BigNumber = requiredRSRAmt.sub(requiredRSRAmt.div(100)) //  due to trade slippage 1%

    await expectEvents(backingManager.claimRewards(), [
      {
        contract: backingManager,
        name: 'RewardsClaimed',
        args: [compToken.address, rewardAmount],
        emitted: true,
      },
      {
        contract: backingManager,
        name: 'RewardsClaimed',
        args: [aaveToken.address, bn(0)],
        emitted: true,
      },
    ])

    // Check status of destinations at this point
    expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
    expect(await rToken.balanceOf(furnace.address)).to.equal(0)

    // Run auctions
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        args: [anyValue, compToken.address, rsr.address, sellAmt, minBuyAmt],
        emitted: true,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: false,
      },
    ])

    const auctionTimestamp: number = await getLatestBlockTimestamp()

    //  Check auctions registered
    //  COMP -> RSR Auction
    await expectTrade(rsrTrader, {
      sell: compToken.address,
      buy: rsr.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('0'),
    })

    //  Check funds in Market
    expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmount)

    //  Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Perform Mock Bids for RSR and RToken (addr1 has balance)
    await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
    await gnosis.placeBid(0, {
      bidder: addr1.address,
      sellAmount: sellAmt,
      buyAmount: minBuyAmt,
    })

    // Close auctions
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeSettled',
        args: [anyValue, compToken.address, rsr.address, sellAmt, minBuyAmt],
        emitted: true,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: false,
      },
    ])

    // Check balances sent to corresponding destinations
    // StRSR
    expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
    // Furnace
    expect(await rToken.balanceOf(furnace.address)).to.equal(0)
  })

  it('Should sell collateral as it appreciates and handle revenue auction correctly', async () => {
    // Set RSR price
    const rsrPrice = fp('0.005') // 0.005 usd
    await setOraclePrice(rsrAsset.address, toBNDecimals(rsrPrice, 8))

    // Mint some RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)

    // Issue 1 RToken
    const issueAmount = bn('1e18')

    // Get quotes for RToken
    const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)

    // Requires 200 cDAI (at $0.02 = $4 USD)
    expect(quotes[2]).to.equal(bn(200e8))
    // Requires 1600 cWBTC (at $400 = $640K USD) - matches 32 BTC @ 20K
    expect(quotes[5]).to.equal(bn(1600e8))
    // Requires 6400 cETH (at $24 = $153,600 K USD) - matches 128 ETH @ 1200
    expect(quotes[7]).to.equal(bn(6400e8))

    // Issue 1 RToken
    await rToken.connect(addr1).issue(issueAmount)

    const origAssetValue = issueAmount.mul(totalPriceUSD).div(BN_SCALE_FACTOR)
    expect(await rTokenAsset.strictPrice()).to.equal(totalPriceUSD)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(origAssetValue)
    expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
    expect(await rToken.totalSupply()).to.equal(issueAmount)

    // Increase redemption rate for cUSD to double
    await cUSDToken.setExchangeRate(fp('2'))

    // Increase redemption rate for cWBTC 25%
    await cWBTC.setExchangeRate(fp('1.25'))

    // Increase redemption rate for cETH 5%
    await cETH.setExchangeRate(fp('1.05'))

    // Get updated quotes
    // Should now require:
    // Token2:  100 cDAI @ 0.004 = 4 USD
    // Token5:  1280 cWBTC @ 500 = 640K USD
    // Token7:  6095.23 cETH @ 25.2 = $153,600 USD
    const [, newQuotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)

    const expectedTkn2: BigNumber = toBNDecimals(
      issueAmount.mul(targetAmts[2]).div(await collateral[2].refPerTok()),
      8
    ) // cDAI
    expect(expectedTkn2).to.be.closeTo(newQuotes[2], point5Pct(newQuotes[2]))
    expect(newQuotes[2]).to.equal(bn(100e8))

    const expectedTkn5: BigNumber = toBNDecimals(
      issueAmount.mul(targetAmts[5]).div(await collateral[5].refPerTok()),
      8
    ) // cWBTC
    expect(expectedTkn5).to.be.closeTo(newQuotes[5], point5Pct(newQuotes[5]))
    expect(newQuotes[5]).to.equal(bn(1280e8))

    const expectedTkn7: BigNumber = toBNDecimals(
      issueAmount.mul(targetAmts[7]).div(await collateral[7].refPerTok()),
      8
    ) // cETH
    expect(expectedTkn7).to.be.closeTo(newQuotes[7], point5Pct(newQuotes[7]))
    expect(newQuotes[7]).to.be.closeTo(bn(6095e8), point5Pct(bn(6095e8)))

    // Check Price (unchanged) and Assets value increment by 50%
    // Excess cDAI = 100 (half) - valued at 100 * 0.04 = 4 usd
    const excessQuantity2: BigNumber = quotes[2].sub(newQuotes[2]).mul(pow10(10)) // Convert to 18 decimals for simplification
    const excessValue2: BigNumber = excessQuantity2
      .mul(await collateral[2].strictPrice())
      .div(BN_SCALE_FACTOR)
    expect(excessQuantity2).to.equal(fp('100'))
    expect(excessValue2).to.equal(fp('4'))

    // Excess cWBTC = 320 - valued at 320 * 500 = 160K usd (25%)
    const excessQuantity5: BigNumber = quotes[5].sub(newQuotes[5]).mul(pow10(10)) // Convert to 18 decimals for simplification
    const excessValue5: BigNumber = excessQuantity5
      .mul(await collateral[5].strictPrice())
      .div(BN_SCALE_FACTOR)
    expect(excessQuantity5).to.equal(fp('320'))
    expect(excessValue5).to.equal(fp('160000'))

    // Excess cETH = 304.7619- valued at 25.2 = 7679.999 usd (5%)
    const excessQuantity7: BigNumber = quotes[7].sub(newQuotes[7]).mul(pow10(10)) // Convert to 18 decimals for simplification
    const excessValue7: BigNumber = excessQuantity7
      .mul(await collateral[7].strictPrice())
      .div(BN_SCALE_FACTOR)
    expect(excessQuantity7).to.be.closeTo(fp('304.7619'), point5Pct(fp('304.7619')))
    expect(excessValue7).to.be.closeTo(fp('7679.999'), point5Pct(fp('7679.999')))

    expect(await rTokenAsset.strictPrice()).to.be.closeTo(totalPriceUSD, fp('0.1'))
    const excessTotal = excessValue2.add(excessValue5).add(excessValue7)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      origAssetValue.add(excessTotal),
      point5Pct(origAssetValue.add(excessTotal))
    )

    // Check status of destinations at this point
    expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
    expect(await rToken.balanceOf(furnace.address)).to.equal(0)

    // Expected values
    const currentTotalSupply: BigNumber = await rToken.totalSupply()

    // Token2 - CDAI
    const expectedToTrader2 = toBNDecimals(excessQuantity2.mul(60).div(100), 8) // 60% of 100 tokens = 60 cDAI
    const expectedToFurnace2 = toBNDecimals(excessQuantity2, 8).sub(expectedToTrader2) // Remainder = 40 cDAI
    expect(expectedToTrader2).to.equal(bn(60e8))
    expect(expectedToFurnace2).to.equal(bn(40e8))

    // Token5- CWBTC
    const expectedToTrader5 = toBNDecimals(excessQuantity5.mul(60).div(100), 8) // 60% of 320 tokens = 192 cWBTC
    const expectedToFurnace5 = toBNDecimals(excessQuantity5, 8).sub(expectedToTrader5) // Remainder = 128 cWBTC
    expect(expectedToTrader5).to.equal(bn(192e8))
    expect(expectedToFurnace5).to.equal(bn(128e8))

    // Token7- CETH
    const expectedToTrader7 = toBNDecimals(excessQuantity7.mul(60).div(100), 8) // 60% of 304.7619 = 182.85 cETH
    const expectedToFurnace7 = toBNDecimals(excessQuantity7, 8).sub(expectedToTrader7) // Remainder = 121.9 cETH
    expect(expectedToTrader7).to.be.closeTo(bn('182.85e8'), point5Pct(bn('182.85e8')))
    expect(expectedToFurnace7).to.be.closeTo(bn('121.9e8'), point5Pct(bn('121.9e8')))

    // Set expected values for first auction - cDAI
    const sellAmt2: BigNumber = expectedToTrader2 // everything is auctioned, below max auction
    const minBuyAmt2: BigNumber = sellAmt2
      .sub(sellAmt2.div(100))
      .mul(pow10(10))
      .mul(await collateral[2].strictPrice())
      .div(await rsrAsset.strictPrice()) // trade slippage 1% - 59.4 cDAI @ 0.04 = 2.376 USD of value, in RSR = 475.2 RSR (@0.005)
    expect(minBuyAmt2).to.equal(fp('475.2'))

    const sellAmtRToken2: BigNumber = expectedToFurnace2 // everything is auctioned, below max auction
    const minBuyAmtRToken2: BigNumber = sellAmtRToken2
      .sub(sellAmtRToken2.div(100))
      .mul(pow10(10))
      .mul(await collateral[2].strictPrice())
      .div(await rTokenAsset.strictPrice()) // trade slippage 1% - 39.6 cDAI @ 0.04 = 1.584 USD of value, in Rtoken = 0.000001330
    expect(minBuyAmtRToken2).to.be.closeTo(fp('0.00000133'), fp('0.00000001'))

    // Run auctions - Will detect excess
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: true,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: true,
      },
    ])

    let auctionTimestamp: number = await getLatestBlockTimestamp()

    //  Check auctions registered
    //  cUSD -> RSR Auction
    await expectTrade(rsrTrader, {
      sell: cUSDToken.address,
      buy: rsr.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('0'),
    })

    // Check trades
    let trade = await getTrade(rsrTrader, cUSDToken.address)
    let auctionId = await trade.auctionId()
    const [, , , auctionSellAmt2, auctionbuyAmt2] = await gnosis.auctions(auctionId)
    expect(sellAmt2).to.be.closeTo(auctionSellAmt2, point5Pct(auctionSellAmt2))
    expect(minBuyAmt2).to.be.closeTo(auctionbuyAmt2, point5Pct(auctionbuyAmt2))

    //  cUSD -> RToken Auction
    await expectTrade(rTokenTrader, {
      sell: cUSDToken.address,
      buy: rToken.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('1'),
    })

    trade = await getTrade(rTokenTrader, cUSDToken.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmtRToken2, auctionbuyAmtRToken2] = await gnosis.auctions(auctionId)
    expect(sellAmtRToken2).to.be.closeTo(auctionSellAmtRToken2, point5Pct(auctionSellAmtRToken2))
    expect(minBuyAmtRToken2).to.be.closeTo(auctionbuyAmtRToken2, point5Pct(auctionbuyAmtRToken2))

    // Check Price (unchanged) and Assets value
    expect(await rTokenAsset.strictPrice()).to.be.closeTo(totalPriceUSD, point5Pct(totalPriceUSD))
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      origAssetValue,
      point5Pct(origAssetValue)
    )
    expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

    //  Check destinations at this stage
    expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
    expect(await rToken.balanceOf(furnace.address)).to.equal(0)

    // Check funds in Market and Traders
    expect(await cUSDToken.balanceOf(gnosis.address)).to.be.closeTo(
      sellAmt2.add(sellAmtRToken2),
      point5Pct(sellAmt2.add(sellAmtRToken2))
    )

    expect(await cUSDToken.balanceOf(rsrTrader.address)).to.equal(expectedToTrader2.sub(sellAmt2))
    expect(await cUSDToken.balanceOf(rTokenTrader.address)).to.equal(
      expectedToFurnace2.sub(sellAmtRToken2)
    )

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auctions
    await rsr.connect(addr1).approve(gnosis.address, auctionbuyAmt2)
    await rToken.connect(addr1).approve(gnosis.address, auctionbuyAmtRToken2)
    await gnosis.placeBid(0, {
      bidder: addr1.address,
      sellAmount: auctionSellAmt2,
      buyAmount: auctionbuyAmt2,
    })
    await gnosis.placeBid(1, {
      bidder: addr1.address,
      sellAmount: auctionSellAmtRToken2,
      buyAmount: auctionbuyAmtRToken2,
    })

    // Closing auction will create new auction for cWBTC
    // Set expected values
    const sellAmt5: BigNumber = expectedToTrader5 // everything is auctioned, below max auction
    const minBuyAmt5: BigNumber = sellAmt5
      .sub(sellAmt5.div(100))
      .mul(pow10(10))
      .mul(await collateral[5].strictPrice())
      .div(await rsrAsset.strictPrice()) // trade slippage 1% - 190.08 CWBTC @ 500 = 95K USD of value, in RSR = 19,008,000 RSR (@0.005)
    expect(minBuyAmt5).to.equal(fp('19008e3'))

    const sellAmtRToken5: BigNumber = expectedToFurnace5 // everything is auctioned, below max auction
    const minBuyAmtRToken5: BigNumber = sellAmtRToken5
      .sub(sellAmtRToken5.div(100))
      .mul(pow10(10))
      .mul(await collateral[5].strictPrice())
      .div(await rTokenAsset.strictPrice()) // trade slippage 1% - 128 CWBTC @ 500 = 64K USD of value, in Rtoken = 0.053225
    expect(minBuyAmtRToken5).to.be.closeTo(fp('0.053225'), fp('0.0001'))

    // Close auctions - Will open for next token
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeSettled',
        args: [anyValue, cUSDToken.address, rsr.address, auctionSellAmt2, auctionbuyAmt2],
        emitted: true,
      },
      {
        contract: rTokenTrader,
        name: 'TradeSettled',
        args: [
          anyValue,
          cUSDToken.address,
          rToken.address,
          auctionSellAmtRToken2,
          auctionbuyAmtRToken2,
        ],
        emitted: true,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: true,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: true,
      },
    ])

    // Check Price (unchanged) and Assets value (unchanged)
    expect(await rTokenAsset.strictPrice()).to.be.closeTo(totalPriceUSD, point5Pct(totalPriceUSD))
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      origAssetValue,
      point5Pct(origAssetValue)
    )
    expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

    // Check destinations at this stage - RSR and RTokens already in StRSR and Furnace
    expect(await rsr.balanceOf(stRSR.address)).to.equal(auctionbuyAmt2)
    expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
      auctionbuyAmtRToken2,
      point5Pct(auctionbuyAmtRToken2)
    )

    // Check no more funds in Market and Traders
    expect(await cUSDToken.balanceOf(gnosis.address)).to.equal(0)
    expect(await cUSDToken.balanceOf(rsrTrader.address)).to.equal(0)
    expect(await cUSDToken.balanceOf(rTokenTrader.address)).to.equal(0)

    // Check new auctions created for cWBTC
    auctionTimestamp = await getLatestBlockTimestamp()

    //  Check auctions registered
    //  cWBTC -> RSR Auction
    await expectTrade(rsrTrader, {
      sell: cWBTC.address,
      buy: rsr.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('6'),
    })

    // Check trades
    trade = await getTrade(rsrTrader, cWBTC.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmt5, auctionbuyAmt5] = await gnosis.auctions(auctionId)
    expect(sellAmt5).to.be.closeTo(auctionSellAmt5, point5Pct(auctionSellAmt5))
    expect(minBuyAmt5).to.be.closeTo(auctionbuyAmt5, point5Pct(auctionbuyAmt5))

    //  cWBTC -> RToken Auction
    await expectTrade(rTokenTrader, {
      sell: cWBTC.address,
      buy: rToken.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('7'),
    })

    trade = await getTrade(rTokenTrader, cWBTC.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmtRToken5, auctionbuyAmtRToken5] = await gnosis.auctions(auctionId)
    expect(sellAmtRToken5).to.be.closeTo(auctionSellAmtRToken5, point5Pct(auctionSellAmtRToken5))
    expect(minBuyAmtRToken5).to.be.closeTo(auctionbuyAmtRToken5, point5Pct(auctionbuyAmtRToken5))

    // Check funds in Market and Traders
    expect(await cWBTC.balanceOf(gnosis.address)).to.be.closeTo(
      sellAmt5.add(sellAmtRToken5),
      point5Pct(sellAmt5.add(sellAmtRToken5))
    )

    expect(await cWBTC.balanceOf(rsrTrader.address)).to.equal(expectedToTrader5.sub(sellAmt5))
    expect(await cWBTC.balanceOf(rTokenTrader.address)).to.equal(
      expectedToFurnace5.sub(sellAmtRToken5)
    )

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auctions
    await rsr.connect(addr1).approve(gnosis.address, auctionbuyAmt5)
    await rToken.connect(addr1).approve(gnosis.address, auctionbuyAmtRToken5)
    await gnosis.placeBid(6, {
      bidder: addr1.address,
      sellAmount: auctionSellAmt5,
      buyAmount: auctionbuyAmt5,
    })
    await gnosis.placeBid(7, {
      bidder: addr1.address,
      sellAmount: auctionSellAmtRToken5,
      buyAmount: auctionbuyAmtRToken5,
    })

    // Closing auction will create new auction for cETH
    // Set expected values
    const sellAmt7: BigNumber = expectedToTrader7 // everything is auctioned, below max auction
    const minBuyAmt7: BigNumber = sellAmt7
      .sub(sellAmt7.div(100))
      .mul(pow10(10))
      .mul(await collateral[7].strictPrice())
      .div(await rsrAsset.strictPrice()) // trade slippage 1% - 181.02 CETH @ 25.2 = 4561 USD of value, in RSR = 912,384 RSR (@0.005)
    expect(minBuyAmt7).to.be.closeTo(fp('912384'), point5Pct(fp('912384')))

    const sellAmtRToken7: BigNumber = expectedToFurnace7 // everything is auctioned, below max auction
    const minBuyAmtRToken7: BigNumber = sellAmtRToken7
      .sub(sellAmtRToken7.div(100))
      .mul(pow10(10))
      .mul(await collateral[7].strictPrice())
      .div(await rTokenAsset.strictPrice()) // trade slippage 1% - 119.79 CETH @ 25.2 = 3018.7 USD of value, in Rtoken = 0.002554
    expect(minBuyAmtRToken7).to.be.closeTo(fp('0.002554'), point5Pct(fp('0.002554')))

    // Close auctions - Will open for next token
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeSettled',
        args: [anyValue, cWBTC.address, rsr.address, auctionSellAmt5, auctionbuyAmt5],
        emitted: true,
      },
      {
        contract: rTokenTrader,
        name: 'TradeSettled',
        args: [
          anyValue,
          cWBTC.address,
          rToken.address,
          auctionSellAmtRToken5,
          auctionbuyAmtRToken5,
        ],
        emitted: true,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: true,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: true,
      },
    ])

    // Check Price (unchanged) and Assets value (unchanged)
    expect(await rTokenAsset.strictPrice()).to.be.closeTo(totalPriceUSD, point5Pct(totalPriceUSD))
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      origAssetValue,
      point5Pct(origAssetValue)
    )
    expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

    // Check destinations at this stage - RSR and RTokens already in StRSR and Furnace
    expect(await rsr.balanceOf(stRSR.address)).to.equal(auctionbuyAmt2.add(auctionbuyAmt5))
    expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
      auctionbuyAmtRToken2.add(auctionbuyAmtRToken5),
      point5Pct(auctionbuyAmtRToken2.add(auctionbuyAmtRToken5))
    )

    // Check no more funds in Market and Traders
    expect(await cWBTC.balanceOf(gnosis.address)).to.equal(0)
    expect(await cWBTC.balanceOf(rsrTrader.address)).to.equal(0)
    expect(await cWBTC.balanceOf(rTokenTrader.address)).to.equal(0)

    // Check new auctions created for cWBTC
    auctionTimestamp = await getLatestBlockTimestamp()

    //  Check auctions registered
    //  cETH -> RSR Auction
    await expectTrade(rsrTrader, {
      sell: cETH.address,
      buy: rsr.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('10'),
    })

    // Check trades
    trade = await getTrade(rsrTrader, cETH.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmt7, auctionbuyAmt7] = await gnosis.auctions(auctionId)
    expect(sellAmt7).to.be.closeTo(auctionSellAmt7, point5Pct(auctionSellAmt7))
    expect(minBuyAmt7).to.be.closeTo(auctionbuyAmt7, point5Pct(auctionbuyAmt7))

    //  cETH -> RToken Auction
    await expectTrade(rTokenTrader, {
      sell: cETH.address,
      buy: rToken.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('11'),
    })

    trade = await getTrade(rTokenTrader, cETH.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmtRToken7, auctionbuyAmtRToken7] = await gnosis.auctions(auctionId)
    expect(sellAmtRToken7).to.be.closeTo(auctionSellAmtRToken7, point5Pct(auctionSellAmtRToken7))
    expect(minBuyAmtRToken7).to.be.closeTo(auctionbuyAmtRToken7, point5Pct(auctionbuyAmtRToken7))

    // Check funds in Market and Traders
    expect(await cETH.balanceOf(gnosis.address)).to.be.closeTo(
      sellAmt7.add(sellAmtRToken7),
      point5Pct(sellAmt7.add(sellAmtRToken7))
    )

    expect(await cETH.balanceOf(rsrTrader.address)).to.equal(expectedToTrader7.sub(sellAmt7))
    expect(await cETH.balanceOf(rTokenTrader.address)).to.equal(
      expectedToFurnace7.sub(sellAmtRToken7)
    )

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auctions
    await rsr.connect(addr1).approve(gnosis.address, auctionbuyAmt7)
    await rToken.connect(addr1).approve(gnosis.address, auctionbuyAmtRToken7)
    await gnosis.placeBid(10, {
      bidder: addr1.address,
      sellAmount: auctionSellAmt7,
      buyAmount: auctionbuyAmt7,
    })
    await gnosis.placeBid(11, {
      bidder: addr1.address,
      sellAmount: auctionSellAmtRToken7,
      buyAmount: auctionbuyAmtRToken7,
    })

    // Close auctions - Will not open new ones
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeSettled',
        args: [anyValue, cETH.address, rsr.address, auctionSellAmt7, auctionbuyAmt7],
        emitted: true,
      },
      {
        contract: rTokenTrader,
        name: 'TradeSettled',
        args: [anyValue, cETH.address, rToken.address, auctionSellAmtRToken7, auctionbuyAmtRToken7],
        emitted: true,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: false,
      },
    ])

    // Check Price (unchanged) and Assets value (unchanged)
    expect(await rTokenAsset.strictPrice()).to.be.closeTo(totalPriceUSD, point5Pct(totalPriceUSD))
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      origAssetValue,
      point5Pct(origAssetValue)
    )
    expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

    // Check destinations at this stage - RSR and RTokens already in StRSR and Furnace
    expect(await rsr.balanceOf(stRSR.address)).to.equal(
      auctionbuyAmt2.add(auctionbuyAmt5).add(auctionbuyAmt7)
    )
    expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
      auctionbuyAmtRToken2.add(auctionbuyAmtRToken5).add(auctionbuyAmtRToken7),
      point5Pct(auctionbuyAmtRToken2.add(auctionbuyAmtRToken5).add(auctionbuyAmtRToken7))
    )

    // Check no more funds in Market and Traders
    expect(await cETH.balanceOf(gnosis.address)).to.equal(0)
    expect(await cETH.balanceOf(rsrTrader.address)).to.equal(0)
    expect(await cETH.balanceOf(rTokenTrader.address)).to.equal(0)
  })

  it('Should recollateralize basket correctly - cWBTC', async () => {
    // Set RSR price to 25 cts for less auctions
    const rsrPrice = fp('0.25') // 0.25 usd
    await setOraclePrice(rsrAsset.address, toBNDecimals(rsrPrice, 8))

    // Stake some RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)

    // Issue
    const issueAmount = bn('1e18')

    await rToken.connect(addr1).issue(issueAmount)

    expect(await basketHandler.fullyCollateralized()).to.equal(true)

    // Get quotes for RToken
    const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)
    const expectedTkn4: BigNumber = issueAmount
      .mul(targetAmts[4])
      .div(await collateral[4].refPerTok())
    const expectedTkn5: BigNumber = toBNDecimals(
      issueAmount.mul(targetAmts[5]).div(await collateral[5].refPerTok()),
      8
    ) // cToken
    expect(quotes[4]).to.equal(fp('16')) // wBTC Target: 16 BTC
    expect(expectedTkn4).to.equal(quotes[4])
    expect(quotes[5]).to.equal(bn(1600e8)) // cWBTC Target: 32 BTC (1600 cWBTC @ 400 usd)
    expect(expectedTkn5).to.equal(quotes[5])

    const cWBTCCollateral = collateral[5] // cWBTC

    // Set Backup for cWBTC to BTC
    await basketHandler
      .connect(owner)
      .setBackupConfig(ethers.utils.formatBytes32String('BTC'), bn(1), [wbtc.address])

    // Basket Swapping - Default cWBTC - should be replaced by BTC
    // Decrease rate to cause default in Ctoken
    await cWBTC.setExchangeRate(fp('0.8'))

    // Mark Collateral as Defaulted
    await cWBTCCollateral.refresh()

    expect(await cWBTCCollateral.status()).to.equal(CollateralStatus.DISABLED)

    // Ensure valid basket
    await basketHandler.refreshBasket()

    const [, newQuotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)
    const newExpectedTkn4: BigNumber = issueAmount
      .mul(targetAmts[4].add(targetAmts[5]))
      .div(await collateral[4].refPerTok())
    expect(newQuotes[4]).to.equal(fp('48')) // wBTC Target: 16 + 32 BTC
    expect(newExpectedTkn4).to.equal(newQuotes[4])

    // Check new basket
    expect(await basketHandler.fullyCollateralized()).to.equal(false)
    const newBacking: string[] = await facade.basketTokens(rToken.address)
    expect(newBacking.length).to.equal(7) // One less token
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

    // Running auctions will trigger recollateralization - All balance of invalid tokens will be redeemed
    const sellAmt: BigNumber = await cWBTC.balanceOf(backingManager.address)

    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: backingManager,
        name: 'TradeStarted',
        args: [anyValue, cWBTC.address, wbtc.address, sellAmt, bn('0')],
        emitted: true,
      },
    ])

    let auctionTimestamp = await getLatestBlockTimestamp()

    // cWBTC (Defaulted) -> wBTC (only valid backup token for that target)
    await expectTrade(backingManager, {
      sell: cWBTC.address,
      buy: wbtc.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('0'),
    })

    // Check trade
    let trade = await getTrade(backingManager, cWBTC.address)
    let auctionId = await trade.auctionId()
    const [, , , auctionSellAmt] = await gnosis.auctions(auctionId)
    expect(sellAmt).to.be.closeTo(auctionSellAmt, point5Pct(auctionSellAmt))

    // Check funds in Market and Traders
    expect(await cWBTC.balanceOf(gnosis.address)).to.be.closeTo(sellAmt, point5Pct(sellAmt))
    expect(await cWBTC.balanceOf(backingManager.address)).to.equal(bn(0))

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auction - Get 80% of value
    // 1600 cWTBC -> 80% = 1280 cWBTC @ 400 = 512K = 25 BTC
    const auctionbuyAmt = fp('25')
    await wbtc.connect(addr1).approve(gnosis.address, auctionbuyAmt)
    await gnosis.placeBid(0, {
      bidder: addr1.address,
      sellAmount: auctionSellAmt,
      buyAmount: auctionbuyAmt,
    })

    const buyAmtBidRSR: BigNumber = fp('7')
    const sellAmtRSR: BigNumber = buyAmtBidRSR
      .mul(100)
      .div(99)
      .add(1)
      .mul(await collateral[4].strictPrice())
      .div(await rsrAsset.strictPrice()) // 7 wBTC @ 20K = 140K USD of value, in RSR ~= 560K RSR (@0.25)

    // Close auctions - Will sell RSR for the remaining 7 WBTC
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: backingManager,
        name: 'TradeSettled',
        args: [anyValue, cWBTC.address, wbtc.address, auctionSellAmt, auctionbuyAmt],
        emitted: true,
      },
      {
        contract: backingManager,
        name: 'TradeStarted',
        //args: [rsr.address, wbtc.address, sellAmtRSR, buyAmtBidRSR],
        emitted: true,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: false,
      },
    ])

    auctionTimestamp = await getLatestBlockTimestamp()

    // RSR -> wBTC
    await expectTrade(backingManager, {
      sell: rsr.address,
      buy: wbtc.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('1'),
    })

    // Check trade
    trade = await getTrade(backingManager, rsr.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmtRSR, auctionBuyAmtRSR] = await gnosis.auctions(auctionId)
    expect(sellAmtRSR).to.be.closeTo(auctionSellAmtRSR, point5Pct(auctionSellAmtRSR))
    expect(buyAmtBidRSR).to.be.closeTo(auctionBuyAmtRSR, point5Pct(auctionBuyAmtRSR))

    // Check funds in Market and Traders
    expect(await rsr.balanceOf(gnosis.address)).to.be.closeTo(sellAmtRSR, point5Pct(sellAmtRSR))

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auction - Get all tokens
    await wbtc.connect(addr1).approve(gnosis.address, auctionBuyAmtRSR)
    await gnosis.placeBid(1, {
      bidder: addr1.address,
      sellAmount: auctionSellAmtRSR,
      buyAmount: buyAmtBidRSR,
    })

    // Close auctions - Will sell RSR for the remaining 7 WBTC
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: backingManager,
        name: 'TradeSettled',
        args: [anyValue, rsr.address, wbtc.address, auctionSellAmtRSR, auctionBuyAmtRSR],
        emitted: true,
      },
      {
        contract: backingManager,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: false,
      },
    ])

    // Check new status
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
  })

  it('Should recollateralize basket correctly - cETH, multiple auctions', async () => {
    // Set RSR price to 2 usd
    const rsrPrice = fp('2') // 2 usd
    await setOraclePrice(rsrAsset.address, toBNDecimals(rsrPrice, 8))

    // Stake some RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)

    // Issue
    const issueAmount = bn('200e18')

    await rToken.connect(addr1).issue(issueAmount)

    expect(await basketHandler.fullyCollateralized()).to.equal(true)

    // Get quotes for RToken
    const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)
    const expectedTkn6: BigNumber = issueAmount
      .mul(targetAmts[6])
      .div(await collateral[6].refPerTok())
    const expectedTkn7: BigNumber = toBNDecimals(
      issueAmount.mul(targetAmts[7]).div(await collateral[7].refPerTok()),
      8
    )
    expect(quotes[6]).to.equal(fp('12800')) // wETH Target: 64 ETH * 200
    expect(expectedTkn6).to.equal(quotes[6])
    expect(quotes[7]).to.equal(bn(1280000e8)) // cETH Target: 128 ETH * 200 (6400 * 200 cETH @ 24 usd)
    expect(expectedTkn7).to.equal(quotes[7])

    const cETHCollateral = collateral[7] // cETH

    // Set Backup for cETH to wETH
    await basketHandler
      .connect(owner)
      .setBackupConfig(ethers.utils.formatBytes32String('ETH'), bn(1), [weth.address])

    // Basket Swapping - Default cETH - should be replaced by ETH
    // Decrease rate to cause default in Ctoken
    await cETH.setExchangeRate(fp('0.5'))

    // Mark Collateral as Defaulted
    await cETHCollateral.refresh()

    expect(await cETHCollateral.status()).to.equal(CollateralStatus.DISABLED)

    // Ensure valid basket
    await basketHandler.refreshBasket()

    const [, newQuotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)
    const newExpectedTkn6: BigNumber = issueAmount
      .mul(targetAmts[6].add(targetAmts[7]))
      .div(await collateral[6].refPerTok())
    expect(newQuotes[6]).to.equal(fp('38400')) // wETH Target: 64 + 128 ETH * 200
    expect(newExpectedTkn6).to.equal(newQuotes[6])

    // Check new basket
    expect(await basketHandler.fullyCollateralized()).to.equal(false)
    const newBacking: string[] = await facade.basketTokens(rToken.address)
    expect(newBacking.length).to.equal(7) // One less token
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

    // Running auctions will trigger recollateralization - cETH partial sale for weth
    const sellAmt = toBNDecimals(MAX_TRADE_VOLUME, 8).div(12)
    const sellAmtRemainder = (await cETH.balanceOf(backingManager.address)).sub(sellAmt)

    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: backingManager,
        name: 'TradeStarted',
        args: [anyValue, cETH.address, weth.address, sellAmt, bn('0')],
        emitted: true,
      },
    ])

    let auctionTimestamp = await getLatestBlockTimestamp()

    // cETH (Defaulted) -> wETH (only valid backup token for that target)
    await expectTrade(backingManager, {
      sell: cETH.address,
      buy: weth.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('0'),
    })

    // Check trade
    let trade = await getTrade(backingManager, cETH.address)
    let auctionId = await trade.auctionId()
    const [, , , auctionSellAmt] = await gnosis.auctions(auctionId)
    expect(sellAmt).to.be.closeTo(auctionSellAmt, point5Pct(auctionSellAmt))

    // Check funds in Market and Traders
    expect(await cETH.balanceOf(gnosis.address)).to.be.closeTo(sellAmt, point5Pct(sellAmt))
    expect(await cETH.balanceOf(backingManager.address)).to.equal(sellAmtRemainder)

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auction - Get 90% of value
    // 1,000,000 cETH-> 90% = 900K cETH @ 24 = 21,6M  = 18K ETH
    const auctionbuyAmt = fp('18000')
    await weth.connect(addr1).approve(gnosis.address, auctionbuyAmt)
    await gnosis.placeBid(0, {
      bidder: addr1.address,
      sellAmount: auctionSellAmt,
      buyAmount: auctionbuyAmt,
    })

    // Run auctions again for remainder
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: backingManager,
        name: 'TradeSettled',
        args: [anyValue, cETH.address, weth.address, auctionSellAmt, auctionbuyAmt],
        emitted: true,
      },
      {
        contract: backingManager,
        name: 'TradeStarted',
        args: [anyValue, cETH.address, weth.address, sellAmtRemainder, bn('0')],
        emitted: true,
      },
    ])

    auctionTimestamp = await getLatestBlockTimestamp()

    // cETH (Defaulted) -> wETH (only valid backup token for that target)
    await expectTrade(backingManager, {
      sell: cETH.address,
      buy: weth.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('1'),
    })

    // Check trade
    trade = await getTrade(backingManager, cETH.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmtRemainder] = await gnosis.auctions(auctionId)
    expect(sellAmtRemainder).to.be.closeTo(
      auctionSellAmtRemainder,
      point5Pct(auctionSellAmtRemainder)
    )

    // Check funds in Market and Traders
    expect(await cETH.balanceOf(gnosis.address)).to.be.closeTo(
      sellAmtRemainder,
      point5Pct(sellAmtRemainder)
    )
    expect(await cETH.balanceOf(backingManager.address)).to.equal(bn(0))

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auction - Get 90% of value
    // 280,000 cETH-> 90% = 180K cETH @ 24 =  4.4M =approx 3K ETH
    const auctionbuyAmtRemainder = fp('3000')
    await weth.connect(addr1).approve(gnosis.address, auctionbuyAmtRemainder)
    await gnosis.placeBid(1, {
      bidder: addr1.address,
      sellAmount: auctionSellAmtRemainder,
      buyAmount: auctionbuyAmtRemainder,
    })

    // We still need 25600 - 21000 ETH (already bought) = 4600 ETH
    expect(await basketHandler.fullyCollateralized()).to.equal(false)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

    // Next auction will trigger RSR auction for the rest
    const buyAmtBidRSR: BigNumber = fp('4600')
    const sellAmtRSR: BigNumber = buyAmtBidRSR
      .mul(await collateral[6].strictPrice())
      .div(await rsrAsset.strictPrice()) // 4600 wETH @ 1200 = 5,520,000 USD of value, in RSR ~= 2,760,000 RSR (@2 usd)
      .mul(100)
      .div(99)
      .add(1)

    // Close auctions - Will sell RSR for partial Buy #1
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: backingManager,
        name: 'TradeSettled',
        args: [
          anyValue,
          cETH.address,
          weth.address,
          auctionSellAmtRemainder,
          auctionbuyAmtRemainder,
        ],
        emitted: true,
      },
      {
        contract: backingManager,
        name: 'TradeStarted',
        args: [anyValue, rsr.address, weth.address, sellAmtRSR, buyAmtBidRSR],
        emitted: true,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: false,
      },
    ])

    auctionTimestamp = await getLatestBlockTimestamp()

    // RSR -> wETH
    await expectTrade(backingManager, {
      sell: rsr.address,
      buy: weth.address,
      endTime: auctionTimestamp + Number(config.auctionLength),
      externalId: bn('2'),
    })

    // Check trade
    trade = await getTrade(backingManager, rsr.address)
    auctionId = await trade.auctionId()
    const [, , , auctionSellAmtRSR, auctionBuyAmtRSR] = await gnosis.auctions(auctionId)
    expect(auctionSellAmtRSR).to.equal(sellAmtRSR)
    expect(auctionBuyAmtRSR).to.be.closeTo(buyAmtBidRSR, point5Pct(buyAmtBidRSR))

    // Advance time till auction ended
    await advanceTime(config.auctionLength.add(100).toString())

    // Mock auction - Get all tokens
    await weth.connect(addr1).approve(gnosis.address, auctionBuyAmtRSR)
    await gnosis.placeBid(2, {
      bidder: addr1.address,
      sellAmount: auctionSellAmtRSR,
      buyAmount: auctionBuyAmtRSR,
    })

    // Close auctions - Will sell RSR for partial Buy #2
    await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
      {
        contract: backingManager,
        name: 'TradeSettled',
        args: [anyValue, rsr.address, weth.address, auctionSellAmtRSR, auctionBuyAmtRSR],
        emitted: true,
      },
      {
        contract: backingManager,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        emitted: false,
      },
      {
        contract: rTokenTrader,
        name: 'TradeStarted',
        emitted: false,
      },
    ])
    // Check new status - Capitalized
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
  })
})

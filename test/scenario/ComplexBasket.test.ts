import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import {
  ATokenFiatCollateral,
  ATokenMock,
  Asset,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  Facade,
  FiatCollateral,
  GnosisMock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  StaticATokenMock,
  StaticATokenLM,
  TestIBackingManager,
  TestIRevenueTrader,
  TestIRToken,
  WETH9,
  USDCMock,
  TestIFurnace,
  TestIStRSR,
  TestIDistributor,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'
import {
  BN_SCALE_FACTOR,
  CollateralStatus,
  FURNACE_DEST,
  STRSR_DEST,
  ZERO_ADDRESS,
} from '../../common/constants'
import { expectTrade } from '../utils/trades'
import { setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

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

  // Trading
  let gnosis: GnosisMock
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Tokens and Assets
  let initialBal: BigNumber
  let rewardAmount: BigNumber
  let totalPriceUSD: BigNumber
  let targetAmts: BigNumber[]
  let targetPricesInUoA: BigNumber[]
  let refPerToks: BigNumber[]

  let erc20s: ERC20Mock[]

  let usdToken: ERC20Mock
  let eurToken: ERC20Mock
  let cUSDToken: CTokenMock
  let aUSDToken: ATokenMock
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
      compAsset,
      aaveToken,
      erc20s,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      facade,
      rsr,
      rsrAsset,
      furnace,
      distributor,
      stRSR,
      rTokenTrader,
      rsrTrader,
      gnosis,
      oracleLib,
    } = await loadFixture(defaultFixture))

    // Mint initial balances
    initialBal = bn('1000000e18')

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
    targetPricesInUoA = []
    refPerToks = []

    // 1. FiatCollateral against USD
    usdToken = erc20s[0] // DAI Token
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
    refPerToks.push(await (await ethers.getContractAt('Collateral', fiatUSD)).refPerTok())

    // 2. FiatCollateral against EUR
    eurToken = <ERC20Mock>await ERC20.deploy('EUR Token', 'EUR')
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
    refPerToks.push(await (await ethers.getContractAt('Collateral', fiatEUR)).refPerTok())

    // 3. CTokenFiatCollateral against USD
    cUSDToken = <CTokenMock>erc20s[4] // cDAI Token
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
    refPerToks.push(await (await ethers.getContractAt('Collateral', cUSDCollateral)).refPerTok())

    // 4. ATokenFiatCollateral against USD
    aUSDToken = <ATokenMock>erc20s[7] // aDAI Token
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
    refPerToks.push(await (await ethers.getContractAt('Collateral', aUSDCollateral)).refPerTok())

    // 5. NonFiatCollateral WBTC against BTC
    wbtc = <ERC20Mock>await ERC20.deploy('WBTC Token', 'WBTC')
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
    refPerToks.push(await (await ethers.getContractAt('Collateral', wBTCCollateral)).refPerTok())

    // 6. CTokenNonFiatCollateral cWBTC against BTC
    cWBTC = <CTokenMock>await CToken.deploy('cWBTC Token', 'cWBTC', wbtc.address)
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
    refPerToks.push(await (await ethers.getContractAt('Collateral', cWBTCCollateral)).refPerTok())

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
    refPerToks.push(await (await ethers.getContractAt('Collateral', wETHCollateral)).refPerTok())

    // 8. CTokenSelfReferentialCollateral cETH against ETH
    cETH = <CTokenMock>await CToken.deploy('cETH Token', 'cETH', weth.address)
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
    refPerToks.push(await (await ethers.getContractAt('Collateral', cETHCollateral)).refPerTok())

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
  })

  it('Should Issue/Redeem correctly', async () => {
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
    const wethDepositAmt = bn('1280e18')
    await weth.connect(addr1).deposit({
      value: ethers.utils.parseUnits(wethDepositAmt.toString(), 'wei'),
    })

    const issueAmt = bn('10e18')

    // Get quotes
    const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmt)

    // Issue
    await rToken.connect(addr1).issue(issueAmt)
    expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)
    expect(await rToken.totalSupply()).to.equal(issueAmt)

    // Set expected quotes
    const expectedTkn0: BigNumber = issueAmt.mul(targetAmts[0]).div(refPerToks[0])
    const expectedTkn1: BigNumber = issueAmt.mul(targetAmts[1]).div(refPerToks[1])
    const expectedTkn2: BigNumber = toBNDecimals(issueAmt.mul(targetAmts[2]).div(refPerToks[2]), 8) // cToken
    const expectedTkn3: BigNumber = issueAmt.mul(targetAmts[3]).div(refPerToks[3])
    const expectedTkn4: BigNumber = issueAmt.mul(targetAmts[4]).div(refPerToks[4])
    const expectedTkn5: BigNumber = toBNDecimals(issueAmt.mul(targetAmts[5]).div(refPerToks[5]), 8) // cToken
    const expectedTkn6: BigNumber = issueAmt.mul(targetAmts[6]).div(refPerToks[6])
    const expectedTkn7: BigNumber = toBNDecimals(issueAmt.mul(targetAmts[7]).div(refPerToks[7]), 8) // cToken

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

    await expectEvents(backingManager.claimAndSweepRewards(), [
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
    await expectEvents(facade.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeStarted',
        args: [compToken.address, rsr.address, sellAmt, minBuyAmt],
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
    await expectEvents(facade.runAuctionsForAllTraders(rToken.address), [
      {
        contract: rsrTrader,
        name: 'TradeSettled',
        args: [compToken.address, rsr.address, sellAmt, minBuyAmt],
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
})

import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { expect } from 'chai'
import { ProposalBuilder, buildProposal } from '../governance'
import { Proposal } from '#/utils/subgraph'
import { IImplementations, networkConfig } from '#/common/configuration'
import { bn, fp, toBNDecimals } from '#/common/numbers'
import { CollateralStatus, TradeKind, ZERO_ADDRESS } from '#/common/constants'
import { pushOraclesForward, setOraclePrice } from '../oracles'
import { whileImpersonating } from '#/utils/impersonation'
import { whales } from '../constants'
import { getTokens, runDutchTrade } from '../trades'
import {
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  BasketLibP1,
  BrokerP1,
  CTokenFiatCollateral,
  DistributorP1,
  EURFiatCollateral,
  FurnaceP1,
  MockV3Aggregator,
  GnosisTrade,
  IERC20Metadata,
  DutchTrade,
  RevenueTraderP1,
  RTokenP1,
  StRSRP1Votes,
  MainP1,
  RecollateralizationLibP1,
} from '../../../../typechain'
import {
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '#/utils/time'

export default async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string
) => {
  console.log('\n* * * * * Run checks for release 3.0.0...')
  const [tester] = await hre.ethers.getSigners()
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const timelockAddress = await governor.timelock()
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
  const furnace = await hre.ethers.getContractAt('FurnaceP1', await main.furnace())
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const rsr = await hre.ethers.getContractAt('StRSRP1Votes', await main.rsr())

  // we pushed the chain forward, so we need to keep the rToken SOUND
  await pushOraclesForward(hre, rTokenAddress)

  /*
    Asset Registry - new getters       
  */
  const nextTimestamp = (await getLatestBlockTimestamp(hre)) + 10
  await setNextBlockTimestamp(hre, nextTimestamp)
  await assetRegistry.refresh()
  expect(await assetRegistry.lastRefresh()).to.equal(nextTimestamp)
  expect(await assetRegistry.size()).to.equal(16)
  console.log(`successfully tested new AssetRegistry getters`)

  /*
    New Basket validations - units and weights       
  */
  const usdcCollat = await assetRegistry.toColl(networkConfig['1'].tokens.USDC!)
  const usdcFiatColl = await hre.ethers.getContractAt('FiatCollateral', usdcCollat)
  const usdc = await hre.ethers.getContractAt('USDCMock', await usdcFiatColl.erc20())

  // Attempt to change target weights in basket
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await expect(
      basketHandler.connect(tl).setPrimeBasket([usdc.address], [fp('20')])
    ).to.be.revertedWith('new target weights')
  })

  // Attempt to change target unit in basket
  const eurt = await hre.ethers.getContractAt('ERC20Mock', networkConfig['1'].tokens.EURT!)
  const EURFiatCollateralFactory = await hre.ethers.getContractFactory('EURFiatCollateral')
  const feedMock = <MockV3Aggregator>(
    await (await hre.ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
  )
  const eurFiatCollateral = <EURFiatCollateral>await EURFiatCollateralFactory.deploy(
    {
      priceTimeout: bn('604800'),
      chainlinkFeed: feedMock.address,
      oracleError: fp('0.01'),
      erc20: eurt.address,
      maxTradeVolume: fp('1000'),
      oracleTimeout: await usdcFiatColl.oracleTimeout(),
      targetName: hre.ethers.utils.formatBytes32String('EUR'),
      defaultThreshold: fp('0.01'),
      delayUntilDefault: bn('86400'),
    },
    feedMock.address,
    await usdcFiatColl.oracleTimeout()
  )
  await eurFiatCollateral.refresh()

  // Attempt to set basket with an EUR token
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await assetRegistry.connect(tl).register(eurFiatCollateral.address)
    await expect(
      basketHandler.connect(tl).setPrimeBasket([eurt.address], [fp('1')])
    ).to.be.revertedWith('new target weights')
    await assetRegistry.connect(tl).unregister(eurFiatCollateral.address)
  })

  console.log(`successfully tested validations of weights and units on basket switch`)

  /*
    Main - Pausing issuance and trading
  */
  // Can pause/unpause issuance and trading separately
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await main.connect(tl).pauseIssuance()

    await expect(rToken.connect(tester).issue(fp('100'))).to.be.revertedWith(
      'frozen or issuance paused'
    )

    await main.connect(tl).unpauseIssuance()

    await expect(rToken.connect(tester).issue(fp('100'))).to.emit(rToken, 'Issuance')

    await main.connect(tl).pauseTrading()

    await expect(backingManager.connect(tester).forwardRevenue([])).to.be.revertedWith(
      'frozen or trading paused'
    )

    await main.connect(tl).unpauseTrading()

    await expect(backingManager.connect(tester).forwardRevenue([])).to.not.be.reverted
  })

  console.log(`successfully tested issuance and trading pause`)

  /*
    New getters/setters for auctions
  */
  // Auction getters/setters
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await broker.connect(tl).enableBatchTrade()
    await broker.connect(tl).enableDutchTrade(rsr.address)
  })
  expect(await broker.batchTradeDisabled()).to.equal(false)
  expect(await broker.dutchTradeDisabled(rsr.address)).to.equal(false)

  console.log(`successfully tested new auction getters/setters`)

  /*
    Dust Auctions
  */
  console.log(`testing dust auctions...`)

  const minTrade = bn('1e18')
  const minTradePrev = await rsrTrader.minTradeVolume()
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await broker.connect(tl).setDutchAuctionLength(1800)
    await rsrTrader.connect(tl).setMinTradeVolume(minTrade)
  })
  await usdcFiatColl.refresh()

  const dustAmount = bn('1e17')
  await getTokens(hre, usdc.address, toBNDecimals(dustAmount, 6), tester.address)
  await usdc.connect(tester).transfer(rsrTrader.address, toBNDecimals(dustAmount, 6))

  await expect(rsrTrader.manageTokens([usdc.address], [TradeKind.DUTCH_AUCTION])).to.emit(
    rsrTrader,
    'TradeStarted'
  )

  await runDutchTrade(hre, rsrTrader, usdc.address)

  // Restore values
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await rsrTrader.connect(tl).setMinTradeVolume(minTradePrev)
    await broker.connect(tl).setDutchAuctionLength(0)
  })

  console.log(`succesfully tested dust auctions`)

  /*
    Warmup period
  */

  console.log(`testing warmup period...`)

  const usdcChainlinkFeed = await hre.ethers.getContractAt(
    'AggregatorV3Interface',
    await usdcFiatColl.chainlinkFeed()
  )

  const roundData = await usdcChainlinkFeed.latestRoundData()
  await setOraclePrice(hre, usdcFiatColl.address, bn('0.8e8'))
  await assetRegistry.refresh()
  expect(await usdcFiatColl.status()).to.equal(CollateralStatus.IFFY)
  expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
  expect(await basketHandler.isReady()).to.equal(false)

  // Restore SOUND
  await setOraclePrice(hre, usdcFiatColl.address, roundData.answer)
  await assetRegistry.refresh()

  // Still cannot issue
  expect(await usdcFiatColl.status()).to.equal(CollateralStatus.SOUND)
  expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

  // If warmup period defined
  if ((await basketHandler.warmupPeriod()) > 0) {
    expect(await basketHandler.isReady()).to.equal(false)
    await expect(rToken.connect(tester).issue(fp('1'))).to.be.revertedWith('basket not ready')

    // Move post warmup period
    await advanceTime(hre, Number(await basketHandler.warmupPeriod()) + 1)
  }

  // Can issue now
  expect(await usdcFiatColl.status()).to.equal(CollateralStatus.SOUND)
  expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
  expect(await basketHandler.isReady()).to.equal(true)
  await expect(rToken.connect(tester).issue(fp('1'))).to.emit(rToken, 'Issuance')
  console.log(`succesfully tested warmup period`)

  // we pushed the chain forward, so we need to keep the rToken SOUND
  await pushOraclesForward(hre, rTokenAddress)

  /*
    Melting occurs when paused
  */

  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await main.connect(tl).pauseIssuance()
    await main.connect(tl).pauseTrading()

    await furnace.melt()

    await main.connect(tl).unpauseIssuance()
    await main.connect(tl).unpauseTrading()
  })
  console.log(`successfully tested melting during paused state`)

  /*
    Stake and delegate
  */

  console.log(`testing stakeAndDelegate...`)
  const stakeAmount = fp('4e6')
  await whileImpersonating(hre, whales[networkConfig['1'].tokens.RSR!], async (rsrSigner) => {
    expect(await stRSR.delegates(rsrSigner.address)).to.equal(ZERO_ADDRESS)
    expect(await stRSR.balanceOf(rsrSigner.address)).to.equal(0)

    await rsr.connect(rsrSigner).approve(stRSR.address, stakeAmount)
    await stRSR.connect(rsrSigner).stakeAndDelegate(stakeAmount, rsrSigner.address)

    expect(await stRSR.delegates(rsrSigner.address)).to.equal(rsrSigner.address)
    expect(await stRSR.balanceOf(rsrSigner.address)).to.be.gt(0)
  })
  console.log(`successfully tested stakeAndDelegate`)

  /*
    Withdrawal leak
  */

  console.log(`testing withrawalLeak...`)

  // Decrease withdrawal leak to be able to test with previous stake
  const withdrawalLeakPrev = await stRSR.withdrawalLeak()
  const withdrawalLeak = withdrawalLeakPrev.eq(bn(0)) ? bn(0) : bn('1e5')
  const unstakingDelay = await stRSR.unstakingDelay()

  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await stRSR.connect(tl).setWithdrawalLeak(withdrawalLeak)
  })

  await whileImpersonating(hre, whales[networkConfig['1'].tokens.RSR!], async (rsrSigner) => {
    const withdrawal = stakeAmount
    await stRSR.connect(rsrSigner).unstake(1)
    await stRSR.connect(rsrSigner).unstake(withdrawal)
    await stRSR.connect(rsrSigner).unstake(1)

    // Move forward past stakingWithdrawalDelay
    await advanceToTimestamp(hre, Number(await getLatestBlockTimestamp(hre)) + unstakingDelay)

    // we pushed the chain forward, so we need to keep the rToken SOUND
    await pushOraclesForward(hre, rTokenAddress)

    let lastRefresh = await assetRegistry.lastRefresh()

    // Should not refresh if withdrawal leak is applied
    await stRSR.connect(rsrSigner).withdraw(rsrSigner.address, 1)
    if (withdrawalLeak.gt(bn(0))) {
      expect(await assetRegistry.lastRefresh()).to.eq(lastRefresh)
    }

    // Should refresh
    await stRSR.connect(rsrSigner).withdraw(rsrSigner.address, 2)
    expect(await assetRegistry.lastRefresh()).to.be.gt(lastRefresh)
    lastRefresh = await assetRegistry.lastRefresh()

    // Should not refresh
    await stRSR.connect(rsrSigner).withdraw(rsrSigner.address, 3)
    if (withdrawalLeak.gt(bn(0))) {
      expect(await assetRegistry.lastRefresh()).to.eq(lastRefresh)
    }
  })

  // Restore values
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await stRSR.connect(tl).setWithdrawalLeak(withdrawalLeakPrev)
  })
  console.log(`successfully tested withrawalLeak`)

  // we pushed the chain forward, so we need to keep the rToken SOUND
  await pushOraclesForward(hre, rTokenAddress)

  /*
    RToken Asset
  */
  console.log(`swapping RTokenAsset...`)

  const rTokenAsset = await hre.ethers.getContractAt(
    'TestIAsset',
    await assetRegistry.toAsset(rToken.address)
  )
  const maxTradeVolumePrev = await rTokenAsset.maxTradeVolume()

  const newRTokenAsset = await (
    await hre.ethers.getContractFactory('RTokenAsset')
  ).deploy(rToken.address, maxTradeVolumePrev)

  // Swap RToken Asset
  await whileImpersonating(hre, timelockAddress, async (tl) => {
    await assetRegistry.connect(tl).swapRegistered(newRTokenAsset.address)
  })
  await assetRegistry.refresh()

  // Check interface behaves properly
  expect(await newRTokenAsset.isCollateral()).to.equal(false)
  expect(await newRTokenAsset.erc20()).to.equal(rToken.address)
  expect(await rToken.decimals()).to.equal(18)
  expect(await newRTokenAsset.version()).to.equal('3.0.0')
  expect(await newRTokenAsset.maxTradeVolume()).to.equal(maxTradeVolumePrev)

  const [lowPricePrev, highPricePrev] = await rTokenAsset.price()
  const [lowPrice, highPrice] = await newRTokenAsset.price()
  expect(lowPrice).to.equal(lowPricePrev)
  expect(highPrice).to.equal(highPricePrev)

  await expect(rTokenAsset.claimRewards()).to.not.emit(rTokenAsset, 'RewardsClaimed')
  console.log(`successfully tested RTokenAsset`)

  console.log('\n3.0.0 check succeeded!')
}

export const proposal_3_0_0: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
  const distributor = await hre.ethers.getContractAt('DistributorP1', await main.distributor())
  const furnace = await hre.ethers.getContractAt('FurnaceP1', await main.furnace())
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const rTokenTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rTokenTrader())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())

  // TODO: Uncomment and replace with deployed addresses once they are available
  /* 
  const mainImplAddr = '0x...'
  const batchTradeImplAddr = '0x...'
  const dutchTradeImplAddr = '0x...'
  const assetRegImplAddr = '0x...'
  const bckMgrImplAddr = '0x...'
  const bsktHdlImplAddr = '0x...'
  const brokerImplAddr = '0x...'
  const distImplAddr = '0x...'
  const furnaceImplAddr = '0x...'
  const rsrTraderImplAddr = '0x...'
  const rTokenTraderImplAddr = '0x...'
  const rTokenImplAddr = '0x...'
  const stRSRImplAddr = '0x...'  
 */

  // TODO: Remove code once addresses are available
  const implementations: IImplementations = await deployNewImplementations(hre)
  const mainImplAddr = implementations.main
  const batchTradeImplAddr = implementations.trading.gnosisTrade
  const dutchTradeImplAddr = implementations.trading.dutchTrade
  const assetRegImplAddr = implementations.components.assetRegistry
  const bckMgrImplAddr = implementations.components.backingManager
  const bsktHdlImplAddr = implementations.components.basketHandler
  const brokerImplAddr = implementations.components.broker
  const distImplAddr = implementations.components.distributor
  const furnaceImplAddr = implementations.components.furnace
  const rsrTraderImplAddr = implementations.components.rsrTrader
  const rTokenTraderImplAddr = implementations.components.rTokenTrader
  const rTokenImplAddr = implementations.components.rToken
  const stRSRImplAddr = implementations.components.stRSR

  // TODO: Uncomment and replace with deployed addresses once they are available
  /*
  const cUSDCVaultAddr = '0x...'
  const cUSDCNewCollateralAddr = '0x...'
  const cUSDTVaultAddr = '0x...'
  const cUSDTNewCollateralAddr = '0x...'
   */
  const saUSDCCollateralAddr = '0x60C384e226b120d93f3e0F4C502957b2B9C32B15'
  const saUSDTCollateralAddr = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'

  // TODO: Remove code once addresses are available
  // CUSDC Vault and collateral
  const [cUSDCVaultAddr, cUSDCVaultCollateralAddr] = await makeCTokenVaultCollateral(
    hre,
    networkConfig['1'].tokens.cUSDC!,
    await assetRegistry.toColl(networkConfig['1'].tokens.cUSDC!),
    networkConfig['1'].COMPTROLLER!
  )
  const [cUSDTVaultAddr, cUSDTVaultCollateralAddr] = await makeCTokenVaultCollateral(
    hre,
    networkConfig['1'].tokens.cUSDT!,
    await assetRegistry.toColl(networkConfig['1'].tokens.cUSDT!),
    networkConfig['1'].COMPTROLLER!
  )

  // Step 1 - Update implementations and config
  const txs = [
    await main.populateTransaction.upgradeTo(mainImplAddr),
    await assetRegistry.populateTransaction.upgradeTo(assetRegImplAddr),
    await backingManager.populateTransaction.upgradeTo(bckMgrImplAddr),
    await basketHandler.populateTransaction.upgradeTo(bsktHdlImplAddr),
    await broker.populateTransaction.upgradeTo(brokerImplAddr),
    await distributor.populateTransaction.upgradeTo(distImplAddr),
    await furnace.populateTransaction.upgradeTo(furnaceImplAddr),
    await rsrTrader.populateTransaction.upgradeTo(rsrTraderImplAddr),
    await rTokenTrader.populateTransaction.upgradeTo(rTokenTraderImplAddr),
    await rToken.populateTransaction.upgradeTo(rTokenImplAddr),
    await stRSR.populateTransaction.upgradeTo(stRSRImplAddr),
    await broker.populateTransaction.setBatchTradeImplementation(batchTradeImplAddr),
    await broker.populateTransaction.setDutchTradeImplementation(dutchTradeImplAddr),
    await backingManager.populateTransaction.cacheComponents(),
    await rsrTrader.populateTransaction.cacheComponents(),
    await rTokenTrader.populateTransaction.cacheComponents(),
    await distributor.populateTransaction.cacheComponents(),
    await basketHandler.populateTransaction.setWarmupPeriod(900),
    await stRSR.populateTransaction.setWithdrawalLeak(bn('5e16')),
    await broker.populateTransaction.setDutchAuctionLength(1800),
  ]

  // Step 2 - Basket change
  txs.push(
    await assetRegistry.populateTransaction.register(cUSDCVaultCollateralAddr),
    await assetRegistry.populateTransaction.register(cUSDTVaultCollateralAddr),
    await basketHandler.populateTransaction.setPrimeBasket(
      [saUSDCCollateralAddr, cUSDCVaultAddr, saUSDTCollateralAddr, cUSDTVaultAddr],
      [fp('0.25'), fp('0.25'), fp('0.25'), fp('0.25')]
    ),
    await basketHandler.populateTransaction.refreshBasket()
  )

  const description =
    'Upgrade implementations, set trade plugins, components, config values, and update basket'

  return buildProposal(txs, description)
}

// TODO: Remove once final addresses exist on Mainnet
const deployNewImplementations = async (
  hre: HardhatRuntimeEnvironment
): Promise<IImplementations> => {
  // Deploy new implementations
  const MainImplFactory = await hre.ethers.getContractFactory('MainP1')
  const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

  // Deploy TradingLib external library
  const TradingLibFactory = await hre.ethers.getContractFactory('RecollateralizationLibP1')
  const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
    await TradingLibFactory.deploy()
  )

  // Deploy BasketLib external library
  const BasketLibFactory = await hre.ethers.getContractFactory('BasketLibP1')
  const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()

  const AssetRegImplFactory = await hre.ethers.getContractFactory('AssetRegistryP1')
  const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

  const BackingMgrImplFactory = await hre.ethers.getContractFactory('BackingManagerP1', {
    libraries: {
      RecollateralizationLibP1: tradingLib.address,
    },
  })
  const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>await BackingMgrImplFactory.deploy()

  const BskHandlerImplFactory = await hre.ethers.getContractFactory('BasketHandlerP1', {
    libraries: { BasketLibP1: basketLib.address },
  })
  const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

  const DistribImplFactory = await hre.ethers.getContractFactory('DistributorP1')
  const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

  const RevTraderImplFactory = await hre.ethers.getContractFactory('RevenueTraderP1')
  const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

  const FurnaceImplFactory = await hre.ethers.getContractFactory('FurnaceP1')
  const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

  const GnosisTradeImplFactory = await hre.ethers.getContractFactory('GnosisTrade')
  const gnosisTrade: GnosisTrade = <GnosisTrade>await GnosisTradeImplFactory.deploy()

  const DutchTradeImplFactory = await hre.ethers.getContractFactory('DutchTrade')
  const dutchTrade: DutchTrade = <DutchTrade>await DutchTradeImplFactory.deploy()

  const BrokerImplFactory = await hre.ethers.getContractFactory('BrokerP1')
  const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

  const RTokenImplFactory = await hre.ethers.getContractFactory('RTokenP1')
  const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

  const StRSRImplFactory = await hre.ethers.getContractFactory('StRSRP1Votes')
  const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

  return {
    main: mainImpl.address,
    trading: { gnosisTrade: gnosisTrade.address, dutchTrade: dutchTrade.address },
    components: {
      assetRegistry: assetRegImpl.address,
      backingManager: backingMgrImpl.address,
      basketHandler: bskHndlrImpl.address,
      broker: brokerImpl.address,
      distributor: distribImpl.address,
      furnace: furnaceImpl.address,
      rsrTrader: revTraderImpl.address,
      rTokenTrader: revTraderImpl.address,
      rToken: rTokenImpl.address,
      stRSR: stRSRImpl.address,
    },
  }
}

// TODO: Remove once final addresses exist on Mainnet
const makeCTokenVaultCollateral = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  collAddress: string,
  comptrollerAddr: string
): Promise<[string, string]> => {
  const CTokenWrapperFactory = await hre.ethers.getContractFactory('CTokenWrapper')
  const CTokenCollateralFactory = await hre.ethers.getContractFactory('CTokenFiatCollateral')

  const erc20: IERC20Metadata = <IERC20Metadata>(
    await hre.ethers.getContractAt('CTokenMock', tokenAddress)
  )

  const currentColl: CTokenFiatCollateral = <CTokenFiatCollateral>(
    await hre.ethers.getContractAt('CTokenFiatCollateral', collAddress)
  )

  const vault = await CTokenWrapperFactory.deploy(
    erc20.address,
    `${await erc20.name()} Vault`,
    `${await erc20.symbol()}-VAULT`,
    comptrollerAddr
  )

  await vault.deployed()

  const coll = <CTokenFiatCollateral>await CTokenCollateralFactory.deploy(
    {
      priceTimeout: await currentColl.priceTimeout(),
      chainlinkFeed: await currentColl.chainlinkFeed(),
      oracleError: await currentColl.oracleError(),
      erc20: vault.address,
      maxTradeVolume: await currentColl.maxTradeVolume(),
      oracleTimeout: await currentColl.oracleTimeout(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125').toString(),
      delayUntilDefault: await currentColl.delayUntilDefault(),
    },
    fp('1e-6')
  )

  await coll.deployed()

  await (await coll.refresh()).wait()

  return [vault.address, coll.address]
}

import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { expect } from 'chai'
import { ProposalBuilder, buildProposal } from '../governance'
import { Proposal } from '#/utils/subgraph'
import { networkConfig } from '#/common/configuration'
import { bn, fp, toBNDecimals } from '#/common/numbers'
import { CollateralStatus, TradeKind, ZERO_ADDRESS } from '#/common/constants'
import { pushOraclesForward, setOraclePrice } from '../oracles'
import { whileImpersonating } from '#/utils/impersonation'
import { whales } from '../constants'
import { getTokens, runDutchTrade } from '../trades'
import { EURFiatCollateral, MockV3Aggregator } from '../../../../typechain'
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

  const mainImplAddr = '0xF5366f67FF66A3CefcB18809a762D5b5931FebF8'
  const batchTradeImplAddr = '0xe416Db92A1B27c4e28D5560C1EEC03f7c582F630'
  const dutchTradeImplAddr = '0x2387C22727ACb91519b80A15AEf393ad40dFdb2F'
  const assetRegImplAddr = '0x773cf50adCF1730964D4A9b664BaEd4b9FFC2450'
  const bckMgrImplAddr = '0x0A388FC05AA017b31fb084e43e7aEaFdBc043080'
  const bsktHdlImplAddr = '0x5ccca36CbB66a4E4033B08b4F6D7bAc96bA55cDc'
  const brokerImplAddr = '0x9A5F8A9bB91a868b7501139eEdB20dC129D28F04'
  const distImplAddr = '0x0e8439a17bA5cBb2D9823c03a02566B9dd5d96Ac'
  const furnaceImplAddr = '0x99580Fc649c02347eBc7750524CAAe5cAcf9d34c'
  const rsrTraderImplAddr = '0x1cCa3FBB11C4b734183f997679d52DeFA74b613A'
  const rTokenTraderImplAddr = '0x1cCa3FBB11C4b734183f997679d52DeFA74b613A'
  const rTokenImplAddr = '0xb6f01Aa21defA4a4DE33Bed16BcC06cfd23b6A6F'
  const stRSRImplAddr = '0xC98eaFc9F249D90e3E35E729e3679DD75A899c10'

  const cUSDCVaultAddr = '0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022'
  const cUSDCVaultCollateralAddr = '0x50a9d529EA175CdE72525Eaa809f5C3c47dAA1bB'
  const cUSDTVaultAddr = '0x4Be33630F92661afD646081BC29079A38b879aA0'
  const cUSDTVaultCollateralAddr = '0x5757fF814da66a2B4f9D11d48570d742e246CfD9'
  const saUSDCCollateralAddr = '0x60C384e226b120d93f3e0F4C502957b2B9C32B15'
  const saUSDTCollateralAddr = '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'

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

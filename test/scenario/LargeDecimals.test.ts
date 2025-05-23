import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp, pow10, toBNDecimals } from '../../common/numbers'
import {
  Asset,
  ERC20Mock,
  FacadeTest,
  GnosisMock,
  IAssetRegistry,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIBasketHandler,
  TestIFacade,
  TestIRevenueTrader,
  TestIRToken,
  TestIFurnace,
  TestIStRSR,
  TestIDistributor,
  AppreciatingMockDecimals,
  AppreciatingMockDecimalsCollateral,
  ERC20MockDecimals,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import {
  defaultFixtureNoBasket,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from '../fixtures'
import { BN_SCALE_FACTOR, CollateralStatus, FURNACE_DEST, STRSR_DEST } from '../../common/constants'
import { expectTrade, getTrade, toMinBuyAmt } from '../utils/trades'
import { expectPrice, expectRTokenPrice, setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
const MAX_TRADE_VOLUME = fp('1e7') // $10M

const point5Pct = (value: BigNumber): BigNumber => {
  return value.mul(5).div(1000)
}

describe(`Large Decimals Basket - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Non-backing assets
  let rsr: ERC20Mock
  let underlying: ERC20MockDecimals
  let rewardToken: ERC20MockDecimals
  let token: AppreciatingMockDecimals

  let erc20s: ERC20Mock[]

  let rsrAsset: Asset
  let rewardAsset: Asset
  let rTokenAsset: RTokenAsset

  // Trading
  let gnosis: GnosisMock
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Tokens and Assets
  let initialBal: BigNumber
  let rewardAmount: BigNumber

  let collateral: AppreciatingMockDecimalsCollateral
  let targetAmt: BigNumber

  let usdToken: ERC20Mock

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let distributor: TestIDistributor
  let furnace: TestIFurnace
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let assetRegistry: IAssetRegistry
  let basketHandler: TestIBasketHandler
  let facade: TestIFacade
  let facadeTest: FacadeTest
  let backingManager: TestIBackingManager

  // Perform tests for each of these decimal variations (> 18)
  const optDecimals = [21, 27]
  optDecimals.forEach((decimals) => {
    describe(`With decimals: ${decimals}`, () => {
      beforeEach(async () => {
        ;[owner, addr1] = await ethers.getSigners()

        // Deploy fixture
        ;({
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
          rTokenAsset,
        } = await loadFixture(defaultFixtureNoBasket))

        // Mint initial balances
        initialBal = bn('100000000').mul(pow10(decimals))

        usdToken = erc20s[0] // DAI Token

        // Setup Factories
        const ERC20MockDecimalsFactory: ContractFactory = await ethers.getContractFactory(
          'ERC20MockDecimals'
        )
        const AppreciatingMockDecimalsFactory: ContractFactory = await ethers.getContractFactory(
          'AppreciatingMockDecimals'
        )
        const AppreciatingMockDecimalsCollateralFactory: ContractFactory =
          await ethers.getContractFactory('AppreciatingMockDecimalsCollateral')
        const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
          'MockV3Aggregator'
        )

        // Replace RSRAsset
        const AssetFactory = await ethers.getContractFactory('Asset')
        const newRSRAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            PRICE_TIMEOUT,
            await rsrAsset.chainlinkFeed(),
            ORACLE_ERROR,
            rsr.address,
            MAX_TRADE_VOLUME,
            ORACLE_TIMEOUT
          )
        )
        await assetRegistry.connect(owner).swapRegistered(newRSRAsset.address)
        rsrAsset = newRSRAsset

        // Setup reward asset
        rewardToken = <ERC20MockDecimals>(
          await ERC20MockDecimalsFactory.deploy(
            `Reward Token ${decimals}`,
            `REWARD_TKN${decimals}`,
            decimals
          )
        )
        const rewardChainlinkFeed = <MockV3Aggregator>(
          await MockV3AggregatorFactory.deploy(8, bn('1e8'))
        )
        rewardAsset = <Asset>(
          await AssetFactory.deploy(
            PRICE_TIMEOUT,
            rewardChainlinkFeed.address,
            ORACLE_ERROR,
            rewardToken.address,
            MAX_TRADE_VOLUME,
            ORACLE_TIMEOUT
          )
        )
        await assetRegistry.connect(owner).register(rewardAsset.address)

        /*****  Setup Basket, Appreciating collateral with large decimals ***********/
        underlying = <ERC20MockDecimals>(
          await ERC20MockDecimalsFactory.deploy(`Token ${decimals}`, `TKN${decimals}`, decimals)
        )

        token = <AppreciatingMockDecimals>(
          await AppreciatingMockDecimalsFactory.deploy(
            `AppreciatingToken_${decimals}`,
            `AppreciatingToken_SYM_:${decimals}`,
            decimals,
            underlying.address
          )
        )
        await token.setExchangeRate(fp('1'))
        await token.setRewardToken(rewardToken.address)

        const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
        collateral = <AppreciatingMockDecimalsCollateral>(
          await AppreciatingMockDecimalsCollateralFactory.deploy(
            {
              priceTimeout: PRICE_TIMEOUT,
              chainlinkFeed: chainlinkFeed.address,
              oracleError: ORACLE_ERROR,
              erc20: token.address,
              maxTradeVolume: MAX_TRADE_VOLUME,
              oracleTimeout: ORACLE_TIMEOUT,
              targetName: ethers.utils.formatBytes32String('USD'),
              defaultThreshold: DEFAULT_THRESHOLD,
              delayUntilDefault: DELAY_UNTIL_DEFAULT,
            },
            REVENUE_HIDING
          )
        )
        await assetRegistry.connect(owner).register(collateral.address)

        targetAmt = fp('1')

        // Set basket
        await basketHandler.setPrimeBasket([token.address], [targetAmt])
        await basketHandler.connect(owner).refreshBasket()

        // Advance time post warmup period
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Mint and approve initial balances
        await token.mint(addr1.address, initialBal)
        await token.connect(addr1).approve(rToken.address, initialBal)

        // Mint backup token
        await usdToken.mint(addr1.address, initialBal)

        // Grant allowances
        await backingManager.grantRTokenAllowance(token.address)
      })

      it('Should Issue/Redeem correctly', async () => {
        // Basket
        expect(await basketHandler.fullyCollateralized()).to.equal(true)

        // Check other values
        expect(await basketHandler.timestamp()).to.be.gt(bn(0))
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
        await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

        const issueAmt = bn('10e18')

        // Get quotes
        const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmt)

        // Issue
        await rToken.connect(addr1).issue(issueAmt)
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)
        expect(await rToken.totalSupply()).to.equal(issueAmt)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          issueAmt,
          fp('0.5')
        )

        await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

        // Set expected quotes
        const expectedTkn: BigNumber = toBNDecimals(
          issueAmt.mul(targetAmt).div(await collateral.refPerTok()),
          decimals
        )

        // Check balances
        expect(await token.balanceOf(backingManager.address)).to.equal(expectedTkn)
        expect(await token.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn))
        expect(expectedTkn).to.equal(quotes[0])

        // Redeem
        await rToken.connect(addr1).redeem(issueAmt)
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        // Check balances - Back to initial status
        expect(await token.balanceOf(backingManager.address)).to.equal(0)
        expect(await token.balanceOf(addr1.address)).to.equal(initialBal)
      })

      it('Should claim rewards correctly - All RSR', async () => {
        // Set RSR price
        const rsrPrice = fp('0.005') // 0.005 usd
        await setOraclePrice(rsrAsset.address, toBNDecimals(rsrPrice, 8))

        // Set reward token price
        const rewardPrice = fp('50') // 50 usd
        await setOraclePrice(rewardAsset.address, toBNDecimals(rewardPrice, 8))

        // Set Reward amount  = approx 5 usd
        rewardAmount = bn('1').mul(pow10(decimals - 1))

        // Mint some RSR (arbitrary)
        await rsr.connect(owner).mint(addr1.address, initialBal)

        // Set f=1 // All revenues to RSR
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(10000) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(10000))

        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))

        // Set Rewards
        await token.setRewards(backingManager.address, rewardAmount)

        // Collect revenue - Called via poke
        const sellAmt: BigNumber = rewardAmount // all will be sold
        const minBuyAmt = toMinBuyAmt(
          sellAmt.div(pow10(decimals - 18)), // scale to 18 decimals (to obtain RSR amount)
          rewardPrice,
          rsrPrice,
          ORACLE_ERROR,
          config.maxTradeSlippage
        )

        await expectEvents(backingManager.claimRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [rewardToken.address, rewardAmount],
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
            args: [anyValue, rewardToken.address, rsr.address, sellAmt, minBuyAmt],
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
        //  RewardToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: rewardToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        //  Check funds in Market
        expect(await rewardToken.balanceOf(gnosis.address)).to.equal(rewardAmount)

        //  Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

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
            args: [anyValue, rewardToken.address, rsr.address, sellAmt, minBuyAmt],
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
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(minBuyAmt, 10000)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should sell collateral as it appreciates and handle revenue auction correctly', async () => {
        // Set RSR price
        const rsrPrice = fp('0.005') // 0.005 usd
        await setOraclePrice(rsrAsset.address, toBNDecimals(rsrPrice, 8))

        // Mint some RSR (arbitrary)
        await rsr.connect(owner).mint(addr1.address, initialBal)

        // Issue 1 RToken
        const issueAmount = bn('1e18')

        // Get quotes for RToken
        const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)

        // Issue 1 RToken
        await rToken.connect(addr1).issue(issueAmount)

        const origAssetValue = issueAmount
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          origAssetValue,
          fp('0.5')
        )
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate to double
        await token.setExchangeRate(fp('2'))

        // Get updated quotes
        const [, newQuotes] = await facade
          .connect(addr1)
          .callStatic.issue(rToken.address, issueAmount)

        await assetRegistry.refresh() // refresh to update refPerTok()
        const expectedNewTkn: BigNumber = toBNDecimals(
          issueAmount.mul(targetAmt).div(await collateral.refPerTok()),
          decimals
        )

        expect(expectedNewTkn).to.equal(newQuotes[0])
        expect(newQuotes[0]).to.equal(quotes[0].div(2)) // requires half the tokens now

        // Check Price and assets value
        // Excess token = 0.5 tok (50% of issued amount)
        const excessQuantity: BigNumber = quotes[0].sub(newQuotes[0])
        const excessQuantity18: BigNumber = excessQuantity.div(pow10(decimals - 18))

        const [lowPrice, highPrice] = await collateral.price()
        const excessValueLow: BigNumber = excessQuantity18.mul(lowPrice).div(BN_SCALE_FACTOR)
        const excessValueHigh: BigNumber = excessQuantity18.mul(highPrice).div(BN_SCALE_FACTOR)

        expect(excessQuantity).to.equal(toBNDecimals(issueAmount.div(2), decimals))
        await expectPrice(collateral.address, fp('2'), ORACLE_ERROR, true) // price doubled
        expect(excessValueLow).to.be.lt(fp('1'))
        expect(excessValueHigh).to.be.gt(fp('1'))

        // RToken price remains the same
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.lt(
          origAssetValue.add(excessValueHigh)
        )
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.gt(
          origAssetValue.add(excessValueLow)
        )

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values
        const currentTotalSupply: BigNumber = await rToken.totalSupply()

        // Excess Token will be minted into a full RToken
        const excessInRToken = issueAmount
        const expectedToTrader = excessInRToken.mul(60).div(100) // 60% of 1 RToken (0.6 RTokens)
        const expectedToFurnace = excessInRToken.sub(expectedToTrader) // Remainder (0.4 RTokens)
        expect(expectedToTrader).to.equal(fp('0.6'))
        expect(expectedToFurnace).to.equal(fp('0.4'))

        // Set expected values for first auction
        const sellAmt: BigNumber = expectedToTrader // everything is auctioned, below max auction
        const minBuyAmt = toMinBuyAmt(
          sellAmt,
          fp('1'),
          rsrPrice,
          ORACLE_ERROR,
          config.maxTradeSlippage
        )

        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        // Run auctions - Will detect excess (all will be minted in RToken, so no RToken auction)
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        //  Check auction registered
        //  RToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: rToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Check trades
        const trade = await getTrade(rsrTrader, rToken.address)
        const auctionId = await trade.auctionId()
        const [, , , auctionSellAmt, auctionbuyAmt] = await gnosis.auctions(auctionId)
        expect(sellAmt).to.be.closeTo(auctionSellAmt, point5Pct(auctionSellAmt))
        expect(minBuyAmt).to.be.closeTo(auctionbuyAmt, point5Pct(auctionbuyAmt))

        // Check Price (unchanged) and Assets value
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        // Value of backing doubled
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          origAssetValue.mul(2),
          point5Pct(origAssetValue.mul(2))
        )

        // Supply now doubled
        expect(await rToken.totalSupply()).to.be.closeTo(
          currentTotalSupply.mul(2),
          point5Pct(currentTotalSupply.mul(2))
        )

        //  Check destinations at this stage (RToken already sent to furnace)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          expectedToFurnace,
          point5Pct(expectedToFurnace)
        )

        // Check funds in Market and Traders
        expect(await rToken.balanceOf(gnosis.address)).to.be.closeTo(sellAmt, point5Pct(sellAmt))

        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(bn(0))
        expect(await rToken.balanceOf(rTokenTrader.address)).to.equal(bn(0))

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Mock auctions
        await rsr.connect(addr1).approve(gnosis.address, auctionbuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: auctionSellAmt,
          buyAmount: auctionbuyAmt,
        })

        // Close auctions - Will not open another auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, rToken.address, rsr.address, auctionSellAmt, auctionbuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
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

        // Check Price (unchanged) and Assets value (unchanged)
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          origAssetValue.mul(2),
          point5Pct(origAssetValue.mul(2))
        )

        expect(await rToken.totalSupply()).to.be.closeTo(
          currentTotalSupply.mul(2),
          point5Pct(currentTotalSupply.mul(2))
        )

        // Check destinations at this stage - RSR and RTokens already in StRSR and Furnace
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(
          auctionbuyAmt,
          point5Pct(auctionbuyAmt)
        )
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(
          expectedToFurnace,
          point5Pct(expectedToFurnace)
        )

        // Check no more funds in Market and Traders
        expect(await rToken.balanceOf(gnosis.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(rTokenTrader.address)).to.equal(0)
      })

      it('Should recollateralize basket correctly', async () => {
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
        const expectedTkn: BigNumber = toBNDecimals(
          issueAmount.mul(targetAmt).div(await collateral.refPerTok()),
          decimals
        )

        expect(quotes[0]).to.equal(toBNDecimals(fp('1'), decimals))
        expect(expectedTkn).to.equal(quotes[0])

        // Set Backup to DAI
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [usdToken.address])

        // Basket Swapping - Default token - should be replaced by DAI
        // Decrease rate to cause default
        await token.setExchangeRate(fp('0.8'))

        // Mark Collateral as Defaulted
        await collateral.refresh()

        expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

        // Ensure valid basket
        await basketHandler.refreshBasket()

        // Advance time post warmup period
        await advanceTime(Number(config.warmupPeriod) + 1)

        const [, newQuotes] = await facade
          .connect(addr1)
          .callStatic.issue(rToken.address, issueAmount)
        expect(newQuotes[0]).to.equal(fp('1'))

        // Check new basket status
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

        // Running auctions will trigger recollateralization - All balance of invalid tokens will be redeemed
        const sellAmt: BigNumber = await token.balanceOf(backingManager.address)
        const minBuyAmt = toMinBuyAmt(
          sellAmt.div(pow10(decimals - 18)), // scale down to 18 decimals
          fp('0.8'), // decrease 20%
          fp('1'),
          ORACLE_ERROR,
          config.maxTradeSlippage
        )

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token.address, usdToken.address, sellAmt, minBuyAmt],
            emitted: true,
          },
        ])

        const auctionTimestamp = await getLatestBlockTimestamp()

        // Token (Defaulted) -> DAI (only valid backup token for that target)
        await expectTrade(backingManager, {
          sell: token.address,
          buy: usdToken.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Check trade
        const trade = await getTrade(backingManager, token.address)
        const auctionId = await trade.auctionId()
        const [, , , auctionSellAmt] = await gnosis.auctions(auctionId)
        expect(sellAmt).to.be.closeTo(auctionSellAmt, point5Pct(auctionSellAmt))

        // Check funds in Market and Traders
        expect(await token.balanceOf(gnosis.address)).to.be.closeTo(sellAmt, point5Pct(sellAmt))
        expect(await token.balanceOf(backingManager.address)).to.equal(bn(0))

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Mock auction - Get 100% of value
        const auctionbuyAmt = fp('1')
        await usdToken.connect(addr1).approve(gnosis.address, auctionbuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: auctionSellAmt,
          buyAmount: auctionbuyAmt,
        })

        // Close auctions - Will not open new auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token.address, usdToken.address, auctionSellAmt, auctionbuyAmt],
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
    })
  })
})

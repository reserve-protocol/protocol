import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, upgrades, waffle } from 'hardhat'
import { IConfig } from '../common/configuration'
import {
  BN_SCALE_FACTOR,
  FURNACE_DEST,
  STRSR_DEST,
  ZERO_ADDRESS,
  ONE_ADDRESS,
} from '../common/constants'
import { expectEvents } from '../common/events'
import { bn, divCeil, divFloor, fp, near } from '../common/numbers'
import {
  Asset,
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeTest,
  GnosisMock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  RewardableLibP1,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIBroker,
  TestIDistributor,
  TestIFurnace,
  TestIRevenueTrader,
  TestIMain,
  TestIRToken,
  TestIStRSR,
  TradingLibP0,
  USDCMock,
  FiatCollateral,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import snapshotGasCost from './utils/snapshotGasCost'
import { advanceTime, getLatestBlockTimestamp } from './utils/time'
import {
  Collateral,
  defaultFixture,
  Implementation,
  IMPLEMENTATION,
  ORACLE_TIMEOUT,
} from './fixtures'
import { setOraclePrice } from './utils/oracles'
import { expectTrade, getTrade } from './utils/trades'

const createFixtureLoader = waffle.createFixtureLoader

const describeGas =
  IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS ? describe : describe.skip

describe(`Revenues - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Non-backing assets
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock

  // Trading
  let gnosis: GnosisMock
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let broker: TestIBroker

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: FiatCollateral
  let collateral1: FiatCollateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let collateral: Collateral[]
  let erc20s: ERC20Mock[]
  let basket: Collateral[]
  let rTokenAsset: RTokenAsset

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let furnace: TestIFurnace
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let distributor: TestIDistributor
  let oracleLib: OracleLib
  let main: TestIMain

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let AssetFactory: ContractFactory

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      compToken,
      aaveToken,
      compoundMock,
      erc20s,
      collateral,
      basket,
      config,
      assetRegistry,
      backingManager,
      basketHandler,
      distributor,
      rToken,
      furnace,
      stRSR,
      broker,
      gnosis,
      facadeTest,
      rsrTrader,
      rTokenTrader,
      oracleLib,
      main,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    AssetFactory = await ethers.getContractFactory('Asset')

    // Set backingBuffer to 0 to make math easy
    await backingManager.connect(owner).setBackingBuffer(0)

    // Get assets and tokens
    collateral0 = <FiatCollateral>basket[0]
    collateral1 = <FiatCollateral>basket[1]
    collateral2 = <ATokenFiatCollateral>basket[2]
    collateral3 = <CTokenFiatCollateral>basket[3]
    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
  })

  describe('Deployment', () => {
    it('Should setup RevenueTraders correctly', async () => {
      expect(await rsrTrader.main()).to.equal(main.address)
      expect(await rsrTrader.tokenToBuy()).to.equal(rsr.address)
      expect(await rsrTrader.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

      expect(await rTokenTrader.main()).to.equal(main.address)
      expect(await rTokenTrader.tokenToBuy()).to.equal(rToken.address)
      expect(await rTokenTrader.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
    })

    it('Should perform validations on init', async () => {
      if (IMPLEMENTATION == Implementation.P0) {
        // Deploy TradingLib external library
        const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP0')
        const tradingLib: TradingLibP0 = <TradingLibP0>await TradingLibFactory.deploy()

        // Create RevenueTrader Factory
        const RevenueTraderFactory: ContractFactory = await ethers.getContractFactory(
          'RevenueTraderP0',
          { libraries: { TradingLibP0: tradingLib.address } }
        )

        const newTrader = <TestIRevenueTrader>await RevenueTraderFactory.deploy()

        await expect(
          newTrader.init(main.address, ZERO_ADDRESS, bn('100'), config.minTradeVolume)
        ).to.be.revertedWith('invalid token address')
      } else if (IMPLEMENTATION == Implementation.P1) {
        // Deploy RewardableLib external library
        const RewardableLibFactory: ContractFactory = await ethers.getContractFactory(
          'RewardableLibP1'
        )
        const rewardableLib: RewardableLibP1 = <RewardableLibP1>await RewardableLibFactory.deploy()

        const RevenueTraderFactory: ContractFactory = await ethers.getContractFactory(
          'RevenueTraderP1',
          {
            libraries: { RewardableLibP1: rewardableLib.address },
          }
        )

        const newTrader = <TestIRevenueTrader>await upgrades.deployProxy(RevenueTraderFactory, [], {
          kind: 'uups',
          unsafeAllow: ['external-library-linking', 'delegatecall'], // TradingLib
        })

        await expect(
          newTrader.init(main.address, ZERO_ADDRESS, bn('100'), config.minTradeVolume)
        ).to.be.revertedWith('invalid token address')
      }
    })
  })

  describe('Config/Setup', function () {
    it('Should setup initial distribution correctly', async () => {
      // Configuration
      const [rTokenTotal, rsrTotal] = await distributor.totals()
      expect(rsrTotal).equal(bn(60))
      expect(rTokenTotal).equal(bn(40))
    })

    it('Should allow to set distribution if owner', async () => {
      // Check initial status
      const [rTokenTotal, rsrTotal] = await distributor.totals()
      expect(rsrTotal).equal(bn(60))
      expect(rTokenTotal).equal(bn(40))

      // Attempt to update with another account
      await expect(
        distributor
          .connect(other)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
      ).to.be.revertedWith('governance only')

      // Update with owner - Set f = 1
      await expect(
        distributor
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
      )
        .to.emit(distributor, 'DistributionSet')
        .withArgs(FURNACE_DEST, bn(0), bn(0))

      // Check updated status
      const [newRTokenTotal, newRsrTotal] = await distributor.totals()
      expect(newRsrTotal).equal(bn(60))
      expect(newRTokenTotal).equal(bn(0))
    })

    it('Should perform distribution validations', async () => {
      // Cannot set RSR > 0 for Furnace
      await expect(
        distributor
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })
      ).to.be.revertedWith('Furnace must get 0% of RSR')

      // Cannot set RToken > 0 for StRSR
      await expect(
        distributor
          .connect(owner)
          .setDistribution(STRSR_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })
      ).to.be.revertedWith('StRSR must get 0% of RToken')

      // Cannot set RSR distribution too high
      await expect(
        distributor
          .connect(owner)
          .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(10001) })
      ).to.be.revertedWith('RSR distribution too high')

      // Cannot set RToken distribution too high
      await expect(
        distributor
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(10001), rsrDist: bn(0) })
      ).to.be.revertedWith('RToken distribution too high')

      // Cannot set both distributions = 0
      await distributor
        .connect(owner)
        .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

      await expect(
        distributor
          .connect(owner)
          .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
      ).to.be.revertedWith('no distribution defined')
    })

    it('Should validate number of destinations', async () => {
      // Cannot set more than Max (100)
      const maxDestinations = 100

      for (let i = 0; i < maxDestinations - 2; i++) {
        const usr: Wallet = await ethers.Wallet.createRandom()
        await distributor
          .connect(owner)
          .setDistribution(usr.address, { rTokenDist: bn(40), rsrDist: bn(60) })
      }

      // Attempt to add an additional destination will revert
      await expect(
        distributor
          .connect(owner)
          .setDistribution(other.address, { rTokenDist: bn(40), rsrDist: bn(60) })
      ).to.be.revertedWith('Too many destinations')
    })
  })

  describe('Revenues', function () {
    context('With issued Rtokens', function () {
      let issueAmount: BigNumber
      let rewardAmountCOMP: BigNumber
      let rewardAmountAAVE: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should not trade if paused', async () => {
        await main.connect(owner).pause()
        await expect(rsrTrader.manageToken(ZERO_ADDRESS)).to.be.revertedWith('paused or frozen')
      })

      it('Should not trade if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(rTokenTrader.manageToken(ZERO_ADDRESS)).to.be.revertedWith('paused or frozen')
      })

      it('Should not claim rewards if paused', async () => {
        await main.connect(owner).pause()
        await expect(rTokenTrader.claimAndSweepRewards()).to.be.revertedWith('paused or frozen')
      })

      it('Should not claim rewards if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(rTokenTrader.claimAndSweepRewards()).to.be.revertedWith('paused or frozen')
      })

      it('Should not settle trade if paused', async () => {
        await main.connect(owner).pause()
        await expect(rTokenTrader.settleTrade(ZERO_ADDRESS)).to.be.revertedWith('paused or frozen')
      })

      it('Should not settle trade if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(rTokenTrader.settleTrade(ZERO_ADDRESS)).to.be.revertedWith('paused or frozen')
      })

      it('Should not launch revenue auction if IFFY', async () => {
        // Depeg one of the underlying tokens - Reducing price 20%
        await setOraclePrice(collateral0.address, bn('7e7'))
        await collateral0.refresh()

        await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
        await expect(rTokenTrader.manageToken(token0.address)).to.not.emit(
          rTokenTrader,
          'TradeStarted'
        )
      })

      it('Should not launch revenue auction if UNPRICED', async () => {
        await advanceTime(ORACLE_TIMEOUT.toString())
        await rsr.connect(addr1).transfer(rTokenTrader.address, issueAmount)
        await expect(rTokenTrader.manageToken(rsr.address)).to.be.revertedWith('StalePrice()')
      })

      it('Should launch revenue auction if DISABLED with minBuyAmount = 0', async () => {
        await setOraclePrice(collateral0.address, bn('0.5e8'))
        await collateral0.refresh()
        await advanceTime((await collateral0.delayUntilDefault()).toString())
        await token0.connect(addr1).transfer(rTokenTrader.address, issueAmount)
        await expect(rTokenTrader.manageToken(token0.address)).to.emit(rTokenTrader, 'TradeStarted')

        // Trade should have near-zero price worst-case price
        const trade = await getTrade(rTokenTrader, token0.address)
        expect(await trade.worstCasePrice()).to.be.lt(fp('0.0001'))
      })

      it('Should claim COMP and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountCOMP.mul(60).div(100) // due to f = 60%
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        const sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
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
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: compToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmountCOMP)

        // If we attempt to settle before auction ended it reverts
        await expect(rsrTrader.settleTrade(compToken.address)).to.be.revertedWith(
          'cannot settle yet'
        )

        await expect(rTokenTrader.settleTrade(compToken.address)).to.be.revertedWith(
          'cannot settle yet'
        )

        // Nothing occurs if we attempt to settle for a token that is not being traded
        await expect(rsrTrader.settleTrade(aaveToken.address)).to.not.emit
        await expect(rTokenTrader.settleTrade(aaveToken.address)).to.not.emit

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
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
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)
      })

      it('Should not auction 1qTok - Amount too small', async () => {
        // Set min trade volume for COMP to 1 qtok
        await backingManager.connect(owner).setMinTradeVolume(0)
        await rsrTrader.connect(owner).setMinTradeVolume(0)
        await rTokenTrader.connect(owner).setMinTradeVolume(0)

        // Set f = 1
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))

        // Avoid dropping 20 qCOMP by making there be exactly 1 distribution share.
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(1))

        // Set COMP tokens as reward -1 qtok
        rewardAmountCOMP = bn(1)

        // COMP Rewards - 1 qTok
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, bn(0)],
            emitted: true,
          },
        ])

        expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmountCOMP)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
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

        // Check no funds in Market, now in trader
        expect(await compToken.balanceOf(gnosis.address)).to.equal(bn(0))
        expect(await compToken.balanceOf(backingManager.address)).to.equal(bn(0))
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(rewardAmountCOMP)

        // Check destinations, nothing changed
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should claim AAVE and handle revenue auction correctly - small amount processed in single auction', async () => {
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(60).div(100) // due to f = 60%
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        // Can also claim through Facade
        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
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
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(rewardAmountAAVE)

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)
      })

      it('Should handle large auctions using maxTradeVolume with f=1 (RSR only)', async () => {
        // Set max trade volume for asset
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )
        const newAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            fp('1'),
            chainlinkFeed.address,
            compToken.address,
            ZERO_ADDRESS,
            fp('1'),
            ORACLE_TIMEOUT
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newAsset.address)
        await basketHandler.refreshBasket()

        // Set f = 1
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))

        // Avoid dropping 20 qCOMP by making there be exactly 1 distribution share.
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(1))

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('2e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue - Called via poke
        // Expected values based on Prices between COMP and RSR = 1 to 1 (for simplification)
        const sellAmt: BigNumber = bn('1e18') // due to max trade volume
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
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

        // Check auction registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Check funds in Market and Trader
        expect(await compToken.balanceOf(gnosis.address)).to.equal(sellAmt)
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(sellAmt)

        // Another call will not create a new auction (we only allow only one at a time per pair)
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
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

        // Perform Mock Bids for RSR (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions
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
            args: [anyValue, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check new auction
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check now all funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(sellAmt)
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(0)

        // Perform Mock Bids for RSR (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

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

        //  Check balances sent to corresponding destinations
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt.mul(2))
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should handle large auctions using maxTradeVolume with f=0 (RToken only)', async () => {
        // Set max trade volume for asset
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )
        const newAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            fp('1'),
            chainlinkFeed.address,
            aaveToken.address,
            aaveToken.address,
            fp('1'),
            ORACLE_TIMEOUT
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newAsset.address)
        await basketHandler.refreshBasket()

        // Set f = 0, avoid dropping tokens
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(1), bn(0))
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(0))

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RToken = 1 (for simplification)
        const sellAmt: BigNumber = bn('1e18') // due to max trade volume
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

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
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rToken.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Calculate pending amount
        const sellAmtRemainder: BigNumber = rewardAmountAAVE.sub(sellAmt)
        const minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Check funds in Market and Trader
        expect(await aaveToken.balanceOf(gnosis.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(sellAmtRemainder)

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Another call will create a new auction and close existing
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rToken.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRemainder,
              minBuyAmtRemainder,
            ],
            emitted: true,
          },

          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check new auction
        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRemainder)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Close auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRemainder,
              minBuyAmtRemainder,
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check balances in destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmt.add(minBuyAmtRemainder))
      })

      it('Should handle large auctions using maxTradeVolume with revenue split RSR/RToken', async () => {
        // Set max trade volume for asset
        const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )
        const newAsset: Asset = <Asset>(
          await AssetFactory.deploy(
            fp('1'),
            chainlinkFeed.address,
            compToken.address,
            compToken.address,
            fp('1'),
            ORACLE_TIMEOUT
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newAsset.address)
        await basketHandler.refreshBasket()

        // Set f = 0.8 (0.2 for Rtoken)
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(4) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(4))
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(1), bn(0))

        // Set COMP tokens as reward
        // Based on current f -> 1.6e18 to RSR and 0.4e18 to Rtoken
        rewardAmountCOMP = bn('2e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = bn('1e18') // due to max trade volume
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        const sellAmtRToken: BigNumber = rewardAmountCOMP.mul(20).div(100) // All Rtokens can be sold - 20% of total comp based on f
        const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
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
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: compToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Advance time till auctions ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        // Calculate pending amount
        const sellAmtRemainder: BigNumber = rewardAmountCOMP.sub(sellAmt).sub(sellAmtRToken)
        const minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Check funds in Market and Traders
        expect(await compToken.balanceOf(gnosis.address)).to.equal(sellAmt.add(sellAmtRToken))
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(sellAmtRemainder)
        expect(await compToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, compToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check destinations at this stage
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)

        // Run final auction until all funds are converted
        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmtRemainder)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder],
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

        // Check balances at destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt.add(minBuyAmtRemainder))
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)
      })

      it('Should allow anyone to call distribute', async () => {
        const distAmount: BigNumber = bn('100e18')

        // Transfer some RSR to BackingManager
        await rsr.connect(addr1).transfer(backingManager.address, distAmount)

        // Set f = 1
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(0), bn(0))
        // Avoid dropping 20 qCOMP by making there be exactly 1 distribution share.
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(1))

        // Check funds in Backing Manager and destinations
        expect(await rsr.balanceOf(backingManager.address)).to.equal(distAmount)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Distribute the RSR
        await whileImpersonating(backingManager.address, async (bmSigner) => {
          await rsr.connect(bmSigner).approve(distributor.address, distAmount)
        })
        await expect(distributor.distribute(rsr.address, backingManager.address, distAmount))
          .to.emit(distributor, 'RevenueDistributed')
          .withArgs(rsr.address, backingManager.address, distAmount)

        //  Check all funds distributed to StRSR
        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(distAmount)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should revert if no distribution exists for a specific token', async () => {
        // Check funds in Backing Manager and destinations
        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set f = 0, avoid dropping tokens
        await expect(
          distributor
            .connect(owner)
            .setDistribution(FURNACE_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(FURNACE_DEST, bn(1), bn(0))
        await expect(
          distributor
            .connect(owner)
            .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(STRSR_DEST, bn(0), bn(0))

        await expect(
          distributor.distribute(rsr.address, backingManager.address, bn(100))
        ).to.be.revertedWith('nothing to distribute')

        //  Check funds, nothing changed
        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should not trade dust when claiming rewards', async () => {
        // Set COMP tokens as reward - both halves are < dust
        rewardAmountCOMP = bn('0.01e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, bn(0)],
            emitted: true,
          },
        ])

        expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmountCOMP)

        // Set expected values, based on f = 0.6
        const expectedToTrader = rewardAmountCOMP.mul(60).div(100)
        const expectedToFurnace = rewardAmountCOMP.sub(expectedToTrader)

        // Check status of traders and destinations at this point
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await compToken.balanceOf(rTokenTrader.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Run auctions - should not start any auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
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

        // Check funds sent to traders
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(expectedToTrader)
        expect(await compToken.balanceOf(rTokenTrader.address)).to.equal(expectedToFurnace)

        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
      })

      it('Should report violation when auction behaves incorrectly', async () => {
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(60).div(100) // due to f = 60%
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        // Claim rewards

        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
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
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: aaveToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        // In order to force deactivation we provide an amount below minBuyAmt, this will represent for our tests an invalid behavior although in a real scenario would retrigger auction
        // NOTE: DIFFERENT BEHAVIOR WILL BE OBSERVED ON PRODUCTION GNOSIS AUCTIONS
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt.sub(10), // Forces in our mock an invalid behavior
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken.sub(10), // Forces in our mock an invalid behavior
        })

        // Close auctions - Will end trades and also report violation
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: broker,
            name: 'DisabledSet',
            args: [false, true],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt.sub(10)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              aaveToken.address,
              rToken.address,
              sellAmtRToken,
              minBuyAmtRToken.sub(10),
            ],
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

        // Check funds at destinations
        expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(minBuyAmt.sub(10), 50)
        expect(await rToken.balanceOf(furnace.address)).to.be.closeTo(minBuyAmtRToken.sub(10), 50)
      })

      it('Should not perform auction if Broker is disabled', async () => {
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Claim rewards
        await expectEvents(facadeTest.claimRewards(rToken.address), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check status of destinations and traders
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(0)

        // Disable broker
        await broker.connect(owner).setDisabled(true)

        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(60).div(100) // due to f = 60%
        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder

        // Attempt to run auctions
        await backingManager.manageTokens([aaveToken.address])
        await expect(rsrTrader.manageToken(aaveToken.address)).to.be.revertedWith('broker disabled')
        await expect(rTokenTrader.manageToken(aaveToken.address)).to.be.revertedWith(
          'broker disabled'
        )

        // Check funds - remain in traders
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(sellAmtRToken)
      })

      it('Should not distribute other tokens beyond RSR/RToken', async () => {
        // Set COMP tokens as reward
        rewardAmountCOMP = bn('1e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, bn(0)],
            emitted: true,
          },
        ])

        // Check funds in Backing Manager and destinations
        expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmountCOMP)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Attempt to distribute COMP token
        await whileImpersonating(basketHandler.address, async (signer) => {
          await expect(
            distributor
              .connect(signer)
              .distribute(compToken.address, backingManager.address, rewardAmountCOMP)
          ).to.be.revertedWith('RSR or RToken')
        })
        //  Check nothing changed
        expect(await compToken.balanceOf(backingManager.address)).to.equal(rewardAmountCOMP)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should handle custom destinations correctly', async () => {
        // Set distribution - 50% of each to another account
        await expect(
          distributor
            .connect(owner)
            .setDistribution(other.address, { rTokenDist: bn(40), rsrDist: bn(60) })
        )
          .to.emit(distributor, 'DistributionSet')
          .withArgs(other.address, bn(40), bn(60))

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('1e18')

        // COMP Rewards
        await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountCOMP.mul(60).div(100) // due to f = 60%
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        const sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expectEvents(backingManager.claimAndSweepRewards(), [
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [compToken.address, rewardAmountCOMP],
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
        expect(await rsr.balanceOf(other.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await rToken.balanceOf(other.address)).to.equal(0)

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
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: compToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmountCOMP)

        // Advance time till auctions ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
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
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        // StRSR - 50% to StRSR, 50% to other
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt.div(2))
        expect(await rsr.balanceOf(other.address)).to.equal(minBuyAmt.div(2))

        // Furnace - 50% to Furnace, 50% to other
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken.div(2))
        expect(await rToken.balanceOf(other.address)).to.equal(minBuyAmtRToken.div(2))
      })

      it('Should claim and sweep rewards to BackingManager from the Revenue Traders', async () => {
        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(rsrTrader.address, rewardAmountAAVE)

        // Check balance in main and Traders
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)

        // Collect revenue
        await expectEvents(rsrTrader.claimAndSweepRewards(), [
          {
            contract: rsrTrader,
            name: 'RewardsClaimed',
            args: [compToken.address, bn(0)],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
        ])

        // Check rewards sent to Main
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(rewardAmountAAVE)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
      })

      it('Should claim properly from multiple assets with the same Reward token', async () => {
        // Get aUSDT and register
        const newToken: StaticATokenMock = <StaticATokenMock>erc20s[9]
        const newATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>collateral[9]
        await assetRegistry.connect(owner).register(newATokenCollateral.address)

        // Setup new basket with two ATokens (same reward token)
        await basketHandler
          .connect(owner)
          .setPrimeBasket([token2.address, newToken.address], [fp('0.5'), fp('0.5')])

        // Switch basket
        await basketHandler.connect(owner).refreshBasket()

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)
        await newToken.setRewards(backingManager.address, rewardAmountAAVE.add(1))

        // Claim and sweep rewards
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
            args: [aaveToken.address, rewardAmountAAVE],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'RewardsClaimed',
            args: [aaveToken.address, rewardAmountAAVE.add(1)],
            emitted: true,
          },
        ])

        // Check status - should claim both rewards correctly
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(
          rewardAmountAAVE.mul(2).add(1)
        )
      })

      it('Should handle properly assets with invalid claim logic', async () => {
        // Setup a new aToken with invalid claim data
        const ATokenCollateralFactory = await ethers.getContractFactory(
          'InvalidATokenFiatCollateralMock',
          { libraries: { OracleLib: oracleLib.address } }
        )
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
        )

        const invalidATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
          await ATokenCollateralFactory.deploy(
            fp('1'),
            chainlinkFeed.address,
            token2.address,
            aaveToken.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String('USD'),
            await collateral2.defaultThreshold(),
            await collateral2.delayUntilDefault()
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(invalidATokenCollateral.address)

        // Setup new basket with the invalid AToken
        await basketHandler.connect(owner).setPrimeBasket([token2.address], [fp('1')])

        // Switch basket
        await basketHandler.connect(owner).refreshBasket()

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Claim and sweep rewards - Should not fail, only processes COMP rewards
        await expect(backingManager.claimAndSweepRewards())
          .to.emit(backingManager, 'RewardsClaimed')
          .withArgs(compToken.address, bn(0))

        // Check status - nothing claimed
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
      })
    })

    context('With simple basket of ATokens and CTokens', function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Setup new basket with ATokens and CTokens
        await basketHandler
          .connect(owner)
          .setPrimeBasket([token2.address, token3.address], [fp('0.5'), fp('0.5')])
        await basketHandler.connect(owner).refreshBasket()

        // Provide approvals
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should sell collateral as it appreciates and handle revenue auction correctly', async () => {
        // Check Price and Assets value
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken to double
        await token2.setExchangeRate(fp('2'))

        // Check Price (unchanged) and Assets value increment by 50%
        const excessValue: BigNumber = issueAmount.div(2)
        const excessQuantity: BigNumber = excessValue.div(2) // Because each unit is now worth $2
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessValue)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const expectedToTrader = excessQuantity.mul(60).div(100)
        const expectedToFurnace = excessQuantity.sub(expectedToTrader)

        const sellAmt: BigNumber = expectedToTrader // everything is auctioned, below max auction
        const minBuyAmt: BigNumber = sellAmt.mul(2).sub(sellAmt.mul(2).div(100)) // due to trade slippage 1% and because RSR/RToken are worth half
        const sellAmtRToken: BigNumber = expectedToFurnace // everything is auctioned, below max auction
        const minBuyAmtRToken: BigNumber = sellAmtRToken.mul(2).sub(sellAmtRToken.mul(2).div(100)) // due to trade slippage 1% and because RSR/RToken are worth half

        // Run auctions - Will detect excess
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [anyValue, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AToken -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: token2.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market and Traders
        expect(await token2.balanceOf(gnosis.address)).to.equal(sellAmt.add(sellAmtRToken))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToFurnace.sub(sellAmtRToken)
        )

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage - RSR and RTokens already in StRSR and Furnace
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)

        // Check no more funds in Market and Traders
        expect(await token2.balanceOf(gnosis.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
      })

      it('Should handle slight increase in collateral correctly - full cycle', async () => {
        // Check Price and Assets value
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken by 2%
        const rate: BigNumber = fp('1.02')
        await token2.setExchangeRate(rate)

        // Check Price (unchanged) and Assets value increment by 1% (only half of the basket increased in value)
        const excessValue: BigNumber = issueAmount.mul(1).div(100)
        const excessQuantity: BigNumber = divCeil(excessValue.mul(BN_SCALE_FACTOR), rate) // Because each unit is now worth $1.02
        expect(near(await rTokenAsset.strictPrice(), fp('1'), 1)).to.equal(true)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessValue)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const expectedToTrader = divCeil(excessQuantity.mul(60), bn(100)).sub(60)
        const expectedToFurnace = divCeil(excessQuantity.mul(40), bn(100)).sub(40) // excessQuantity.sub(expectedToTrader)

        // Auction values - using divCeil for dealing with Rounding
        const sellAmt: BigNumber = expectedToTrader
        const buyAmt: BigNumber = divCeil(sellAmt.mul(rate), BN_SCALE_FACTOR) // RSR quantity with no slippage
        const minBuyAmt: BigNumber = buyAmt.sub(divFloor(buyAmt, bn(100))) // due to trade slippage 1%

        const sellAmtRToken: BigNumber = expectedToFurnace
        const buyAmtRToken: BigNumber = divCeil(sellAmtRToken.mul(rate), BN_SCALE_FACTOR) // RToken quantity with no slippage
        const minBuyAmtRToken: BigNumber = buyAmtRToken.sub(divFloor(buyAmtRToken, bn(100))) // due to trade slippage 1%

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [anyValue, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        expect(near(await rTokenAsset.strictPrice(), fp('1'), 1)).to.equal(true)
        expect(
          near(await facadeTest.callStatic.totalAssetValue(rToken.address), issueAmount, 100)
        ).to.equal(true)
        expect(
          (await facadeTest.callStatic.totalAssetValue(rToken.address)).gt(issueAmount)
        ).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AToken -> RToken Auction
        await expectTrade(rTokenTrader, {
          sell: token2.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market and Traders
        expect(near(await token2.balanceOf(gnosis.address), excessQuantity, 100)).to.equal(true)
        expect(await token2.balanceOf(gnosis.address)).to.equal(sellAmt.add(sellAmtRToken))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToFurnace.sub(sellAmtRToken)
        )
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [anyValue, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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

        //  Check Price (unchanged) and Assets value (unchanged)
        expect(near(await rTokenAsset.strictPrice(), fp('1'), 1)).to.equal(true)
        expect(
          near(await facadeTest.callStatic.totalAssetValue(rToken.address), issueAmount, 100)
        ).to.equal(true)
        expect(
          (await facadeTest.callStatic.totalAssetValue(rToken.address)).gt(issueAmount)
        ).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check balances sent to corresponding destinations
        // StRSR
        expect(near(await rsr.balanceOf(stRSR.address), minBuyAmt, 100)).to.equal(true)
        // Furnace
        expect(near(await rToken.balanceOf(furnace.address), minBuyAmtRToken, 100)).to.equal(true)
      })

      it('Should not overspend if backingManager.manageTokens() is called with duplicate tokens', async () => {
        expect(await basketHandler.fullyCollateralized()).to.be.true

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('1.2'))

        await expect(
          backingManager.manageTokens([token2.address, token2.address])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.manageTokens([
            token2.address,
            token2.address,
            token2.address,
            token2.address,
          ])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.manageTokens([token2.address, token1.address, token2.address])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.manageTokens([
            token1.address,
            token2.address,
            token3.address,
            token2.address,
          ])
        ).to.be.revertedWith('duplicate tokens')

        await expect(
          backingManager.manageTokens([
            token1.address,
            token2.address,
            token3.address,
            token3.address,
          ])
        ).to.be.revertedWith('duplicate tokens')

        // Remove duplicates, should work
        await expect(backingManager.manageTokens([token1.address, token2.address, token3.address]))
          .to.not.be.reverted
      })

      it('Should not overspend if backingManager.manageTokensSortedOrder() is called with duplicate tokens', async () => {
        expect(await basketHandler.fullyCollateralized()).to.be.true

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('1.2'))

        await expect(
          backingManager.manageTokensSortedOrder([token2.address, token2.address])
        ).to.be.revertedWith('duplicate/unsorted tokens')

        await expect(
          backingManager.manageTokensSortedOrder([
            token2.address,
            token2.address,
            token2.address,
            token2.address,
          ])
        ).to.be.revertedWith('duplicate/unsorted tokens')

        await expect(
          backingManager.manageTokensSortedOrder([token2.address, token1.address, token2.address])
        ).to.be.revertedWith('duplicate/unsorted tokens')

        await expect(
          backingManager.manageTokensSortedOrder([
            token1.address,
            token2.address,
            token3.address,
            token2.address,
          ])
        ).to.be.revertedWith('duplicate/unsorted tokens')

        await expect(
          backingManager.manageTokensSortedOrder([
            token1.address,
            token2.address,
            token3.address,
            token3.address,
          ])
        ).to.be.revertedWith('duplicate/unsorted tokens')

        // Remove duplicates but unsort
        const sorted = [token1.address, token2.address, token3.address].sort((a, b) => {
          const x = BigNumber.from(a)
          const y = BigNumber.from(b)
          if (x.lt(y)) return -1
          if (x.gt(y)) return 1
          return 0
        })
        const unsorted = [sorted[2], sorted[0], sorted[1]]
        await expect(backingManager.manageTokensSortedOrder(unsorted)).to.be.revertedWith(
          'duplicate/unsorted tokens'
        )

        // Remove duplicates and sort, should work
        await expect(backingManager.manageTokensSortedOrder(sorted)).to.not.be.reverted
      })

      it('Should mint RTokens when collateral appreciates and handle revenue auction correctly - Even quantity', async () => {
        // Check Price and Assets value
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('2'))

        // Check Price (unchanged) and Assets value (now doubled)
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set expected minting, based on f = 0.6
        const expectedToTrader = issueAmount.mul(60).div(100)
        const expectedToFurnace = issueAmount.sub(expectedToTrader)

        // Set expected auction values
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const newTotalSupply: BigNumber = currentTotalSupply.mul(2)
        const sellAmt: BigNumber = expectedToTrader // everything is auctioned, due to max trade volume
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        // Collect revenue and mint new tokens - Will also launch auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rToken,
            name: 'Transfer',
            args: [ZERO_ADDRESS, backingManager.address, issueAmount],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, rToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value - Supply has doubled
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )
        expect(await rToken.totalSupply()).to.equal(newTotalSupply)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await rToken.balanceOf(furnace.address)).to.equal(expectedToFurnace)

        // Check funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(sellAmt)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: rToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Perform Mock Bids for RSR(addr1 has balance)
        await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction - will not start new one
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, rToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check Price and Assets value - RToken price increases due to melting
        const updatedRTokenPrice: BigNumber = newTotalSupply
          .mul(BN_SCALE_FACTOR)
          .div(await rToken.totalSupply())
        expect(await rTokenAsset.strictPrice()).to.equal(updatedRTokenPrice)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )

        // Check no funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(0)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
      })

      it('Should mint RTokens and handle remainder when collateral appreciates - Uneven quantity', async () => {
        // Check Price and Assets value
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rates for AToken and CToken - Higher for the AToken
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('1.6'))

        // Check Price (unchanged) and Assets value (now 80% higher)
        const excessTotalValue: BigNumber = issueAmount.mul(80).div(100)
        expect(near(await rTokenAsset.strictPrice(), fp('1'), 1)).to.equal(true)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessTotalValue)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations and traders at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set expected values based on f=0.6
        const currentTotalSupply: BigNumber = await rToken.totalSupply()
        const excessRToken: BigNumber = issueAmount.mul(60).div(100)
        const excessCollateralValue: BigNumber = excessTotalValue.sub(excessRToken)
        const excessCollateralQty: BigNumber = excessCollateralValue.div(2) // each unit of this collateral is worth now $2
        const expectedToTraderFromRToken = divCeil(excessRToken.mul(60), bn(100))
        const expectedToFurnaceFromRToken = excessRToken.sub(expectedToTraderFromRToken)
        const expectedToRSRTraderFromCollateral = divCeil(excessCollateralQty.mul(60), bn(100))
        const expectedToRTokenTraderFromCollateral = excessCollateralQty.sub(
          expectedToRSRTraderFromCollateral
        )

        //  Set expected auction values
        const newTotalSupply: BigNumber = currentTotalSupply.mul(160).div(100)
        const sellAmtFromRToken: BigNumber = expectedToTraderFromRToken // all will be processed at once, due to max trade volume of 50%
        const minBuyAmtFromRToken: BigNumber = sellAmtFromRToken.sub(sellAmtFromRToken.div(100)) // due to trade slippage 1%
        const sellAmtRSRFromCollateral: BigNumber = expectedToRSRTraderFromCollateral // all will be processed at once, due to max trade volume of 50%
        const minBuyAmtRSRFromCollateral: BigNumber = sellAmtRSRFromCollateral
          .mul(2)
          .sub(sellAmtRSRFromCollateral.mul(2).div(100)) // due to trade slippage 1% and because RSR/RToken is worth half
        const sellAmtRTokenFromCollateral: BigNumber = expectedToRTokenTraderFromCollateral // all will be processed at once, due to max trade volume of 50%
        const minBuyAmtRTokenFromCollateral: BigNumber = sellAmtRTokenFromCollateral
          .mul(2)
          .sub(sellAmtRTokenFromCollateral.mul(2).div(100)) // due to trade slippage 1% and because RSR/RToken is worth half

        //  Collect revenue and mint new tokens - Will also launch auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rToken,
            name: 'Transfer',
            args: [ZERO_ADDRESS, backingManager.address, excessRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [anyValue, rToken.address, rsr.address, sellAmtFromRToken, minBuyAmtFromRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              rsr.address,
              sellAmtRSRFromCollateral,
              minBuyAmtRSRFromCollateral,
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              rToken.address,
              sellAmtRTokenFromCollateral,
              minBuyAmtRTokenFromCollateral,
            ],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (excess collateral not counted anymore) - Supply has increased
        expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessRToken)
        )
        expect(await rToken.totalSupply()).to.equal(newTotalSupply)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(
          expectedToTraderFromRToken.sub(sellAmtFromRToken)
        )
        expect(await rToken.balanceOf(furnace.address)).to.equal(expectedToFurnaceFromRToken)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(
          expectedToRSRTraderFromCollateral.sub(sellAmtRSRFromCollateral)
        )
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToRTokenTraderFromCollateral.sub(sellAmtRTokenFromCollateral)
        )

        // Check funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(sellAmtFromRToken)
        expect(await token2.balanceOf(gnosis.address)).to.equal(
          sellAmtRSRFromCollateral.add(sellAmtRTokenFromCollateral)
        )

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: rToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Collateral -> RSR Auction
        await expectTrade(rsrTrader, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Collateral -> Rtoken Auction
        await expectTrade(rTokenTrader, {
          sell: token2.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('2'),
        })

        //  Perform Mock Bids for RSR/RToken (addr1 has balance)
        await rsr
          .connect(addr1)
          .approve(gnosis.address, minBuyAmtFromRToken.add(minBuyAmtRSRFromCollateral))
        await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRTokenFromCollateral)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmtFromRToken,
          buyAmount: minBuyAmtFromRToken,
        })

        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRSRFromCollateral,
          buyAmount: minBuyAmtRSRFromCollateral,
        })

        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRTokenFromCollateral,
          buyAmount: minBuyAmtRTokenFromCollateral,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction, should start a new one with same amount
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [anyValue, rToken.address, rsr.address, sellAmtFromRToken, minBuyAmtFromRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              token2.address,
              rsr.address,
              sellAmtRSRFromCollateral,
              minBuyAmtRSRFromCollateral,
            ],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [
              anyValue,
              token2.address,
              rToken.address,
              sellAmtRTokenFromCollateral,
              minBuyAmtRTokenFromCollateral,
            ],
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

        // Check no funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(0)
        expect(await token2.balanceOf(gnosis.address)).to.equal(0)

        //  Check Price and Assets value - RToken price increases due to melting
        const updatedRTokenPrice: BigNumber = newTotalSupply
          .mul(BN_SCALE_FACTOR)
          .div(await rToken.totalSupply())
        expect(await rTokenAsset.strictPrice()).to.equal(updatedRTokenPrice)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(excessRToken)
        )

        //  Check destinations
        expect(await rsr.balanceOf(stRSR.address)).to.equal(
          minBuyAmtFromRToken.add(minBuyAmtRSRFromCollateral)
        )
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
      })
    })
  })

  describeGas('Gas Reporting', () => {
    let issueAmount: BigNumber
    let rewardAmountCOMP: BigNumber
    let rewardAmountAAVE: BigNumber

    beforeEach(async function () {
      issueAmount = bn('100e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Mint some RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)
    })

    it('Claim and Sweep Rewards', async () => {
      // Claim and sweep Rewards - Nothing to claim
      await snapshotGasCost(backingManager.claimAndSweepRewards())
      await snapshotGasCost(rsrTrader.claimAndSweepRewards())
      await snapshotGasCost(rTokenTrader.claimAndSweepRewards())
      await snapshotGasCost(rToken.claimAndSweepRewards())

      // Set Rewards
      rewardAmountCOMP = bn('0.8e18')
      rewardAmountAAVE = bn('0.6e18')

      // COMP Rewards
      await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)
      await compoundMock.setRewards(rsrTrader.address, rewardAmountCOMP)
      await compoundMock.setRewards(rTokenTrader.address, rewardAmountCOMP)
      await compoundMock.setRewards(rToken.address, rewardAmountCOMP)

      // AAVE Rewards
      await token2.setRewards(backingManager.address, rewardAmountAAVE)
      await token2.setRewards(rsrTrader.address, rewardAmountAAVE)
      await token2.setRewards(rTokenTrader.address, rewardAmountAAVE)
      await token2.setRewards(rToken.address, rewardAmountAAVE)

      // Claim and sweep Rewards - With Rewards
      await snapshotGasCost(backingManager.claimAndSweepRewards())
      await snapshotGasCost(rsrTrader.claimAndSweepRewards())
      await snapshotGasCost(rTokenTrader.claimAndSweepRewards())
      await snapshotGasCost(rToken.claimAndSweepRewards())
    })

    it('Settle Trades / Manage Funds', async () => {
      // Set max auction size for asset
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )
      const newAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          fp('1'),
          chainlinkFeed.address,
          compToken.address,
          compToken.address,
          config.rTokenMaxTradeVolume,
          ORACLE_TIMEOUT
        )
      )

      // Perform asset swap
      await assetRegistry.connect(owner).swapRegistered(newAsset.address)
      await basketHandler.refreshBasket()

      // Set f = 0.8 (0.2 for Rtoken)
      await distributor
        .connect(owner)
        .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(4) })

      await distributor
        .connect(owner)
        .setDistribution(FURNACE_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })

      // Set COMP tokens as reward
      rewardAmountCOMP = bn('2e18')

      // COMP Rewards
      await compoundMock.setRewards(backingManager.address, rewardAmountCOMP)

      // Collect revenue
      // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
      const sellAmt: BigNumber = bn('1e18') // due to max auction size
      const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

      const sellAmtRToken: BigNumber = rewardAmountCOMP.mul(20).div(100) // All Rtokens can be sold - 20% of total comp based on f
      const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

      await backingManager.claimAndSweepRewards()

      // Manage Funds
      await backingManager.manageTokens([compToken.address])
      await snapshotGasCost(rsrTrader.manageToken(compToken.address))
      await snapshotGasCost(rTokenTrader.manageToken(compToken.address))

      // Advance time till auctions ended
      await advanceTime(config.auctionLength.add(100).toString())

      // Perform Mock Bids for RSR and RToken (addr1 has balance)
      await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
      await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmt,
        buyAmount: minBuyAmt,
      })
      await gnosis.placeBid(1, {
        bidder: addr1.address,
        sellAmount: sellAmtRToken,
        buyAmount: minBuyAmtRToken,
      })

      // Close auctions
      // Calculate pending amount
      const sellAmtRemainder: BigNumber = rewardAmountCOMP.sub(sellAmt).sub(sellAmtRToken)
      const minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

      // Run auctions - Order: Settle trades, then manage funds
      // Settle trades
      await snapshotGasCost(rsrTrader.settleTrade(compToken.address))
      await snapshotGasCost(rTokenTrader.settleTrade(compToken.address))

      // Manage Funds
      await snapshotGasCost(rsrTrader.manageToken(compToken.address))
      await snapshotGasCost(rTokenTrader.manageToken(compToken.address))

      // Run final auction until all funds are converted
      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // Perform Mock Bids for RSR and RToken (addr1 has balance)
      await rsr.connect(addr1).approve(gnosis.address, minBuyAmtRemainder)
      await gnosis.placeBid(2, {
        bidder: addr1.address,
        sellAmount: sellAmtRemainder,
        buyAmount: minBuyAmtRemainder,
      })

      // Run auctions - Order: Settle trades, then Manage funds
      // Settle trades
      await snapshotGasCost(rsrTrader.settleTrade(compToken.address))
      await snapshotGasCost(rTokenTrader.settleTrade(compToken.address))
    })
  })
})

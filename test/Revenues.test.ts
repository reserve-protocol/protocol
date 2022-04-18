import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  BN_SCALE_FACTOR,
  FURNACE_DEST,
  STRSR_DEST,
  ZERO_ADDRESS,
  MAX_UINT256,
} from '../common/constants'
import { expectEvents } from '../common/events'
import { bn, divCeil, divFloor, fp, near, shortString } from '../common/numbers'
import {
  AaveLendingPoolMock,
  AavePricedAsset,
  AaveOracleMock,
  AssetRegistryP0,
  ATokenFiatCollateral,
  BackingManagerP0,
  BasketHandlerP0,
  BrokerP0,
  CompoundPricedAsset,
  ComptrollerMock,
  CompoundOracleMock,
  CTokenFiatCollateral,
  CTokenMock,
  DistributorP0,
  ERC20Mock,
  FacadeP0,
  FurnaceP0,
  GnosisTrade,
  MainP0,
  GnosisMock,
  RevenueTradingP0,
  RTokenAsset,
  TestIRToken,
  StaticATokenMock,
  TestIStRSR,
  USDCMock,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import { advanceTime, getLatestBlockTimestamp } from './utils/time'
import { Collateral, defaultFixture, IConfig, SLOW } from './fixtures'
import { expectTrade } from './utils/trades'
import { cartesianProduct } from './utils/cases'
import { issueMany } from './utils/issue'

const createFixtureLoader = waffle.createFixtureLoader

describe('Revenues', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Non-backing assets
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock
  let aaveMock: AaveLendingPoolMock
  let compoundOracleInternal: CompoundOracleMock
  let aaveOracleInternal: AaveOracleMock

  // Trading
  let gnosis: GnosisMock
  let rsrTrader: RevenueTradingP0
  let rTokenTrader: RevenueTradingP0
  let broker: BrokerP0

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let collateral: Collateral[]
  let erc20s: ERC20Mock[]
  let basket: Collateral[]

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let furnace: FurnaceP0
  let main: MainP0
  let facade: FacadeP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let distributor: DistributorP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

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
      aaveMock,
      erc20s,
      collateral,
      basket,
      config,
      main,
      assetRegistry,
      backingManager,
      basketHandler,
      distributor,
      rToken,
      furnace,
      stRSR,
      broker,
      gnosis,
      facade,
      rsrTrader,
      rTokenTrader,
      compoundOracleInternal,
      aaveOracleInternal,
    } = await loadFixture(defaultFixture))

    // Set backingBuffer to 0 to make math easy
    await backingManager.connect(owner).setBackingBuffer(0)

    // Get assets and tokens
    collateral0 = <Collateral>basket[0]
    collateral1 = <Collateral>basket[1]
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

  describe('Config/Setup', function () {
    it('Should setup initial distribution correctly', async () => {
      // Configuration
      const totals = await distributor.totals()
      expect(totals.rsrTotal).equal(bn(60))
      expect(totals.rTokenTotal).equal(bn(40))
    })

    it('Should allow to set distribution if owner', async () => {
      // Check initial status
      let totals = await distributor.totals()
      expect(totals.rsrTotal).equal(bn(60))
      expect(totals.rTokenTotal).equal(bn(40))

      // Attempt to update with another account
      await expect(
        distributor
          .connect(other)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
      ).to.be.revertedWith('Component: caller is not the owner')

      // Update with owner - Set f = 1
      await expect(
        distributor
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
      )
        .to.emit(distributor, 'DistributionSet')
        .withArgs(FURNACE_DEST, bn(0), bn(0))

      // Check updated status
      totals = await distributor.totals()
      expect(totals.rsrTotal).equal(bn(60))
      expect(totals.rTokenTotal).equal(bn(0))
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

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, 0, {
          sell: compToken.address,
          buy: rToken.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmountCOMP)

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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        await expectEvents(facade.claimRewards(), [
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, 0, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAsset')
        const newCompAsset: CompoundPricedAsset = <CompoundPricedAsset>(
          await AssetFactory.deploy(compToken.address, fp('1'), compoundMock.address)
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newCompAsset.address)

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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
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
        await expectTrade(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Check funds in Market and Trader
        expect(await compToken.balanceOf(gnosis.address)).to.equal(sellAmt)
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(sellAmt)

        // Another call will not create a new auction (we only allow only one at a time per pair)
        await expectEvents(facade.runAuctionsForAllTraders(), [
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [1, compToken.address, rsr.address, sellAmt, minBuyAmt],
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
        await expectTrade(rsrTrader, 1, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [1, compToken.address, rsr.address, sellAmt, minBuyAmt],
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
        const AssetFactory: ContractFactory = await ethers.getContractFactory('AavePricedAsset')
        const newAaveAsset: AavePricedAsset = <AavePricedAsset>(
          await AssetFactory.deploy(
            aaveToken.address,
            fp('1'),
            compoundMock.address,
            aaveMock.address
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newAaveAsset.address)

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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, aaveToken.address, rToken.address, sellAmt, minBuyAmt],
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
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, aaveToken.address, rToken.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [1, aaveToken.address, rToken.address, sellAmtRemainder, minBuyAmtRemainder],
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
        await expectTrade(rTokenTrader, 1, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [1, aaveToken.address, rToken.address, sellAmtRemainder, minBuyAmtRemainder],
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
        const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAsset')
        const newCompAsset: CompoundPricedAsset = <CompoundPricedAsset>(
          await AssetFactory.deploy(compToken.address, fp('1'), compoundMock.address)
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(newCompAsset.address)

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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [1, compToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder],
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

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [1, compToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder],
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
        await distributor.distribute(rsr.address, backingManager.address, distAmount)

        //  Check all funds distributed to StRSR
        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(distAmount)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it('Should not trade dust when claiming rewards', async () => {
        // Set COMP tokens as reward - Dust
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
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

        await expectEvents(facade.claimRewards(), [
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectTrade(rsrTrader, 0, {
          sell: aaveToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AAVE -> RToken Auction
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: broker,
            name: 'DisabledSet',
            args: [false, true],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, aaveToken.address, rsr.address, sellAmt, minBuyAmt.sub(10)],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken.sub(10)],
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
        await expectEvents(facade.claimRewards(), [
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
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

        // Check funds - remain in traders
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(sellAmtRToken)
      })

      it('Should try/catch errors when opening trade on Broker', async () => {
        // Set an invalid Broker that reverts
        const InvalidBrokerFactory: ContractFactory = await ethers.getContractFactory(
          'InvalidBrokerMock'
        )
        const invalidBroker: BrokerP0 = <BrokerP0>await InvalidBrokerFactory.deploy()

        // Set broker
        await invalidBroker.init(main.address, gnosis.address, config.auctionLength)
        await main.connect(owner).setBroker(invalidBroker.address)

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(backingManager.address, rewardAmountAAVE)

        // Claim rewards
        await expectEvents(facade.claimRewards(), [
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

        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        const sellAmt: BigNumber = rewardAmountAAVE.mul(60).div(100) // due to f = 60%
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%
        const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        const minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        // Attempt to run auctions - should catch exception
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeBlocked',
            args: [aaveToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeBlocked',
            args: [aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check funds - remain in traders
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await aaveToken.balanceOf(backingManager.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(sellAmtRToken)
      })

      it('Should try/catch errors when settling an auction', async () => {
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

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        // Check funds in Market
        expect(await compToken.balanceOf(gnosis.address)).to.equal(rewardAmountCOMP)

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

        // Cause failure by arbitrary removing the RSR obtained from market
        await rsr.connect(owner).burn(gnosis.address, minBuyAmt)

        // Close auctions - Will revert but catch errors
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettlementBlocked',
            args: [0],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
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

        // Check balances - no changes on StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)
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
        await expect(
          distributor.distribute(compToken.address, backingManager.address, rewardAmountCOMP)
        ).to.be.revertedWith('RSR or RToken')

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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectTrade(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // COMP -> RToken Auction
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        await basketHandler.connect(owner).switchBasket()

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
          'InvalidATokenFiatCollateralMock'
        )
        const invalidATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
          await ATokenCollateralFactory.deploy(
            token2.address,
            await collateral2.maxTradeVolume(),
            await collateral2.defaultThreshold(),
            await collateral2.delayUntilDefault(),
            token0.address,
            compoundMock.address,
            aaveMock.address,
            aaveToken.address
          )
        )

        // Perform asset swap
        await assetRegistry.connect(owner).swapRegistered(invalidATokenCollateral.address)

        // Setup new basket with the invalid AToken
        await basketHandler.connect(owner).setPrimeBasket([token2.address], [fp('1')])

        // Switch basket
        await basketHandler.connect(owner).switchBasket()

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
        await basketHandler.connect(owner).switchBasket()

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
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken to double
        await token2.setExchangeRate(fp('2'))

        // Check Price (unchanged) and Assets value increment by 50%
        const excessValue: BigNumber = issueAmount.div(2)
        const excessQuantity: BigNumber = excessValue.div(2) // Because each unit is now worth $2
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.add(excessValue))
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectTrade(rsrTrader, 0, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AToken -> RToken Auction
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
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
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken by 2%
        const rate: BigNumber = fp('1.02')
        await token2.setExchangeRate(rate)

        // Check Price (unchanged) and Assets value increment by 1% (only half of the basket increased in value)
        const excessValue: BigNumber = issueAmount.mul(1).div(100)
        const excessQuantity: BigNumber = divCeil(excessValue.mul(BN_SCALE_FACTOR), rate) // Because each unit is now worth $1.02
        expect(near(await rToken.price(), fp('1'), 1)).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.add(excessValue))
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

        console.log(sellAmt, minBuyAmt, sellAmtRToken, minBuyAmtRToken)
        // Run auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeStarted',
            args: [0, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        expect(near(await rToken.price(), fp('1'), 1)).to.equal(true)
        expect(near(await facade.callStatic.totalAssetValue(), issueAmount, 100)).to.equal(true)
        expect((await facade.callStatic.totalAssetValue()).gt(issueAmount)).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectTrade(rsrTrader, 0, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // AToken -> RToken Auction
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, token2.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: rTokenTrader,
            name: 'TradeSettled',
            args: [0, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken],
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
        expect(near(await rToken.price(), fp('1'), 1)).to.equal(true)
        expect(near(await facade.callStatic.totalAssetValue(), issueAmount, 100)).to.equal(true)
        expect((await facade.callStatic.totalAssetValue()).gt(issueAmount)).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check balances sent to corresponding destinations
        // StRSR
        expect(near(await rsr.balanceOf(stRSR.address), minBuyAmt, 100)).to.equal(true)
        // Furnace
        expect(near(await rToken.balanceOf(furnace.address), minBuyAmtRToken, 100)).to.equal(true)
      })

      it('Should mint RTokens when collateral appreciates and handle revenue auction correctly - Even quantity', async () => {
        // Check Price and Assets value
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('2'))

        // Check Price (unchanged) and Assets value (now doubled)
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(2))
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rToken,
            name: 'Transfer',
            args: [ZERO_ADDRESS, backingManager.address, issueAmount],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, rToken.address, rsr.address, sellAmt, minBuyAmt],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value - Supply has doubled
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(2))
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
        await expectTrade(rsrTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, rToken.address, rsr.address, sellAmt, minBuyAmt],
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
        expect(await rToken.price()).to.equal(updatedRTokenPrice)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(2))

        // Check no funds in Market
        expect(await rToken.balanceOf(gnosis.address)).to.equal(0)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
      })

      it('Should mint RTokens and handle remainder when collateral appreciates - Uneven quantity', async () => {
        // Check Price and Assets value
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rates for AToken and CToken - Higher for the AToken
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('1.6'))

        // Check Price (unchanged) and Assets value (now 80% higher)
        const excessTotalValue: BigNumber = issueAmount.mul(80).div(100)
        expect(near(await rToken.price(), fp('1'), 1)).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rToken,
            name: 'Transfer',
            args: [ZERO_ADDRESS, backingManager.address, excessRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [0, rToken.address, rsr.address, sellAmtFromRToken, minBuyAmtFromRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeStarted',
            args: [
              1,
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
              0,
              token2.address,
              rToken.address,
              sellAmtRTokenFromCollateral,
              minBuyAmtRTokenFromCollateral,
            ],
            emitted: true,
          },
        ])

        // Check Price (unchanged) and Assets value (excess collateral not counted anymore) - Supply has increased
        expect(await rToken.price()).to.equal(fp('1'))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.add(excessRToken))
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
        await expectTrade(rsrTrader, 0, {
          sell: rToken.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Collateral -> RSR Auction
        await expectTrade(rsrTrader, 1, {
          sell: token2.address,
          buy: rsr.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Collateral -> Rtoken Auction
        await expectTrade(rTokenTrader, 0, {
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
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [0, rToken.address, rsr.address, sellAmtFromRToken, minBuyAmtFromRToken],
            emitted: true,
          },
          {
            contract: rsrTrader,
            name: 'TradeSettled',
            args: [
              1,
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
              0,
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
        expect(await rToken.price()).to.equal(updatedRTokenPrice)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.add(excessRToken))

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
})

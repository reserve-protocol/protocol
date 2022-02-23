import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { CompoundClaimAdapterP0 } from '@typechain/CompoundClaimAdapterP0'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import {
  AuctionStatus,
  BN_SCALE_FACTOR,
  FURNACE_DEST,
  STRSR_DEST,
  ZERO_ADDRESS,
} from '../../common/constants'
import { bn, divCeil, fp, near } from '../../common/numbers'
import {
  AaveLendingPoolMockP0,
  AssetP0,
  ATokenFiatCollateralP0,
  CollateralP0,
  ComptrollerMockP0,
  CTokenFiatCollateralP0,
  CTokenMock,
  DeployerP0,
  ERC20Mock,
  ExplorerFacadeP0,
  FurnaceP0,
  MainP0,
  MarketMock,
  RevenueTraderP0,
  RTokenAssetP0,
  RTokenP0,
  StaticATokenMock,
  StRSRP0,
  TraderP0,
  USDCMock,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig, IRevenueShare } from './utils/fixtures'

interface IAuctionInfo {
  sell: string
  buy: string
  sellAmount: BigNumber
  minBuyAmount: BigNumber
  startTime: number
  endTime: number
  clearingSellAmount: BigNumber
  clearingBuyAmount: BigNumber
  externalAuctionId: BigNumber
  status: AuctionStatus
}

const expectAuctionInfo = async (
  trader: TraderP0,
  index: number,
  auctionInfo: Partial<IAuctionInfo>
) => {
  const {
    sell,
    buy,
    sellAmount,
    minBuyAmount,
    startTime,
    endTime,
    clearingSellAmount,
    clearingBuyAmount,
    externalAuctionId,
    status,
  } = await trader.auctions(index)
  expect(sell).to.equal(auctionInfo.sell)
  expect(buy).to.equal(auctionInfo.buy)
  expect(sellAmount).to.equal(auctionInfo.sellAmount)
  expect(minBuyAmount).to.equal(auctionInfo.minBuyAmount)
  expect(startTime).to.equal(auctionInfo.startTime)
  expect(endTime).to.equal(auctionInfo.endTime)
  expect(clearingSellAmount).to.equal(auctionInfo.clearingSellAmount)
  expect(clearingBuyAmount).to.equal(auctionInfo.clearingBuyAmount)
  expect(externalAuctionId).to.equal(auctionInfo.externalAuctionId)
  expect(status).to.equal(auctionInfo.status)
}

const expectAuctionStatus = async (
  trader: TraderP0,
  index: number,
  expectedStatus: AuctionStatus
) => {
  const { status } = await trader.auctions(index)
  expect(status).to.equal(expectedStatus)
}

const createFixtureLoader = waffle.createFixtureLoader

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: AssetP0
  let compToken: ERC20Mock
  let compAsset: AssetP0
  let compoundMock: ComptrollerMockP0
  let aaveToken: ERC20Mock
  let aaveAsset: AssetP0
  let aaveMock: AaveLendingPoolMockP0

  // Trading
  let market: MarketMock
  let rsrTrader: RevenueTraderP0
  let rTokenTrader: RevenueTraderP0

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: ATokenFiatCollateralP0
  let collateral3: CTokenFiatCollateralP0
  let basketsNeededAmts: BigNumber[]

  // Config values
  let config: IConfig
  let dist: IRevenueShare

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let rTokenAsset: RTokenAssetP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let facade: ExplorerFacadeP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    let erc20s: ERC20Mock[]
    let basket: Collateral[]

      // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      aaveToken,
      compAsset,
      aaveAsset,
      compoundMock,
      aaveMock,
      erc20s,
      collateral,
      basket,
      basketsNeededAmts,
      config,
      deployer,
      dist,
      main,
      rToken,
      rTokenAsset,
      furnace,
      stRSR,
      market,
      facade,
    } = await loadFixture(defaultFixture))
    token0 = erc20s[collateral.indexOf(basket[0])]
    token1 = erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Set backingBuffer to 0 to make math easy
    await main.connect(owner).setMinRevenueAuctionSize(0)

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = <ATokenFiatCollateralP0>basket[2]
    collateral3 = <CTokenFiatCollateralP0>basket[3]

    rsrTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rsrTrader())
    )
    rTokenTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rTokenTrader())
    )

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
      let rsrCut = await main.rsrCut()
      expect(rsrCut.rsrShares).equal(bn(60))
      expect(rsrCut.totalShares).equal(bn(100))

      let rtokenCut = await main.rTokenCut()
      expect(rtokenCut.rTokenShares).equal(bn(40))
      expect(rtokenCut.totalShares).equal(bn(100))
    })

    it('Should allow to set distribution if owner', async () => {
      // Check initial status
      let rsrCut = await main.rsrCut()
      expect(rsrCut.rsrShares).equal(bn(60))
      expect(rsrCut.totalShares).equal(bn(100))

      let rtokenCut = await main.rTokenCut()
      expect(rtokenCut.rTokenShares).equal(bn(40))
      expect(rtokenCut.totalShares).equal(bn(100))

      // Attempt to update with another account
      await expect(
        main.connect(other).setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
      ).to.be.revertedWith('Ownable: caller is not the owner')

      // Update with owner - Set f = 1
      await main.connect(owner).setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

      // Check updated status
      rsrCut = await main.rsrCut()
      expect(rsrCut.rsrShares).equal(bn(60))
      expect(rsrCut.totalShares).equal(bn(60))

      rtokenCut = await main.rTokenCut()
      expect(rtokenCut.rTokenShares).equal(bn(0))
      expect(rtokenCut.totalShares).equal(bn(60))
    })

    it('Should perform distribution validations', async () => {
      // Cannot set RSR > 0 for Furnace
      await expect(
        main.connect(owner).setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })
      ).to.be.revertedWith('Furnace must get 0% of RSR')

      // Cannot set RToken > 0 for StRSR
      await expect(
        main.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })
      ).to.be.revertedWith('StRSR must get 0% of RToken')

      // Cannot set RSR distribution too high
      await expect(
        main.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(10001) })
      ).to.be.revertedWith('RSR distribution too high')

      // Cannot set RToken distribution too high
      await expect(
        main.connect(owner).setDistribution(FURNACE_DEST, { rTokenDist: bn(10001), rsrDist: bn(0) })
      ).to.be.revertedWith('RSR distribution too high')
    })
  })

  describe('Revenues', function () {
    context('With issued Rtokens', async function () {
      let issueAmount: BigNumber
      let rewardAmountCOMP: BigNumber
      let rewardAmountAAVE: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Provide approvals
        await token0.connect(addr1).approve(main.address, initialBal)
        await token1.connect(addr1).approve(main.address, initialBal)
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should not allow to claim more than once for each rewardPeriod', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)
        await expect(main.claimRewards()).to.emit(main, 'RewardsClaimed')

        // Set new rewards and attempt to claim again
        await compoundMock.setRewards(main.address, rewardAmountCOMP)
        await expect(main.claimRewards()).to.not.emit(main, 'RewardsClaimed')

        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Now should be able to claim rewards again
        await expect(main.claimRewards()).to.emit(main, 'RewardsClaimed')
      })

      it('Should claim COMP and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('0.8e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountCOMP.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.claimRewards()).to.emit(main, 'RewardsClaimed')

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check funds in Market
        expect(await compToken.balanceOf(market.address)).to.equal(rewardAmountCOMP)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check previous auctions closed
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          externalAuctionId: bn('0'),
          status: AuctionStatus.DONE,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          externalAuctionId: bn('1'),
          status: AuctionStatus.DONE,
        })

        // Check balances sent to corresponding destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)
        const { amount, start } = await furnace.batches(0)
        expect(amount).to.equal(minBuyAmtRToken)
        expect(start).to.equal(await getLatestBlockTimestamp())
      })

      it('Should claim AAVE and handle revenue auction correctly - small amount processed in single auction', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(main.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountAAVE.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        // Can also claim through Facade
        await expect(facade.claimAndSweepRewardsForAllTraders()).to.emit(main, 'RewardsClaimed')

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, aaveToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

        // Check auctions registered
        // AAVE -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: aaveToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // AAVE -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: aaveToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check funds in Market
        expect(await aaveToken.balanceOf(market.address)).to.equal(rewardAmountAAVE)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, aaveToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)

        // Check balances sent to corresponding destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)
        const { amount, start } = await furnace.batches(0)
        expect(amount).to.equal(minBuyAmtRToken)
        expect(start).to.equal(await getLatestBlockTimestamp())
      })

      it('Should handle large auctions for using maxAuctionSize with f=1 (RSR only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 1
        await main
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })
        // Avoid dropping 20 qCOMP by making there be exactly 1 distribution share.
        await main.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('1e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.claimRewards()).to.emit(main, 'RewardsClaimed')

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Check funds in Market and still in Trader
        expect(await compToken.balanceOf(market.address)).to.equal(sellAmt)
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(0)

        // Check existing auctions still open
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.OPEN)

        // Check now all funds in Market
        expect(await compToken.balanceOf(market.address)).to.equal(rewardAmountCOMP)

        // Perform Mock Bids for RSR (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Close auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check existing auctions are closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)

        // Check balances sent to corresponding destinations
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
      })

      it.skip('Should handle large auctions for using maxAuctionSize with f=0 (RToken only)', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 0, avoid dropping tokens
        await main
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })
        await main.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

        // Set AAVE tokens as reward
        rewardAmountAAVE = bn('1.5e18')

        // AAVE Rewards
        await token2.setRewards(main.address, rewardAmountAAVE)

        // Collect revenue
        // Expected values based on Prices between AAVE and RToken = 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        await expect(main.claimRewards()).to.emit(main, 'RewardsClaimed')

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, aaveToken.address, rToken.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auction registered
        // AAVE -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: aaveToken.address,
          buy: rToken.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountAAVE.sub(sellAmt)
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Check funds in Market and still in Trader
        expect(await aaveToken.balanceOf(market.address)).to.equal(sellAmt)
        expect(await aaveToken.balanceOf(rTokenTrader.address)).to.equal(sellAmtRemainder)

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Another call will create a new auction and close existing
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(1, aaveToken.address, rToken.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, aaveToken.address, rToken.address, sellAmt, minBuyAmt)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')

        // AAVE -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 1, {
          sell: aaveToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check previous auction is closed
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)

        // Check destinations at this stage
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmt)
        let { amount, start } = await furnace.batches(0)
        expect(amount).to.equal(minBuyAmt)
        expect(start).to.equal(await getLatestBlockTimestamp())

        // Perform Mock Bids for RToken (addr1 has balance)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRemainder)
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Close auction
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(1, aaveToken.address, rToken.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')
          .and.to.not.emit(rsrTrader, 'AuctionStarted')

        // Check existing auctions are closed
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 1, AuctionStatus.DONE)

        // Check balances in destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        // Furnace - some melting occurred already at this point
        let { melted } = await furnace.batches(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(
          minBuyAmt.add(minBuyAmtRemainder).sub(melted)
        )
        ;({ amount, start } = await furnace.batches(1))
        expect(amount).to.equal(minBuyAmtRemainder)
        expect(start).to.equal(await getLatestBlockTimestamp())
      })

      it.skip('Should handle large auctions using maxAuctionSize with revenue split RSR/RToken', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set f = 0.8 (0.2 for Rtoken)
        await main.connect(owner).setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(4) })
        await main
          .connect(owner)
          .setDistribution(FURNACE_DEST, { rTokenDist: bn(1), rsrDist: bn(0) })

        // Set COMP tokens as reward
        // Based on current f -> 1.6e18 to RSR and 0.4e18 to Rtoken
        rewardAmountCOMP = bn('2e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = (await rToken.totalSupply()).div(100) // due to 1% max auction size
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountCOMP.mul(20).div(100) // All Rtokens can be sold - 20% of total comp based on f
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.claimRewards()).to.emit(main, 'RewardsClaimed')

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

        const auctionTimestamp: number = await getLatestBlockTimestamp()
        // Check auctions registered
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        // Calculate pending amount
        let sellAmtRemainder: BigNumber = rewardAmountCOMP.sub(sellAmt).sub(sellAmtRToken)
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Check funds in Market and still in Trader
        expect(await compToken.balanceOf(market.address)).to.equal(sellAmt.add(sellAmtRToken))
        expect(await compToken.balanceOf(rsrTrader.address)).to.equal(sellAmtRemainder)
        expect(await compToken.balanceOf(rTokenTrader.address)).to.equal(0)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(1, compToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check previous auctions closed
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          externalAuctionId: bn('0'),
          status: AuctionStatus.DONE,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          externalAuctionId: bn('1'),
          status: AuctionStatus.DONE,
        })

        await expectAuctionInfo(rsrTrader, 1, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('2'),
          status: AuctionStatus.OPEN,
        })

        // Check destinations at this stage
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        // Furnace
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken)
        let { amount, start } = await furnace.batches(0)
        expect(amount).to.equal(minBuyAmtRToken)
        expect(start).to.equal(await getLatestBlockTimestamp())

        // Run final auction until all funds are converted
        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmtRemainder)
        await market.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(1, compToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check all auctions are closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rsrTrader, 1, AuctionStatus.DONE)

        // Check balances at destinations
        // StRSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt.add(minBuyAmtRemainder))
        // Furnace - Some melting occurred at this point
        const { melted } = await furnace.batches(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken.sub(melted))
      })

      it('Should handle custom destinations correctly', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set distribution - 50% of each to another account
        await main
          .connect(owner)
          .setDistribution(other.address, { rTokenDist: bn(40), rsrDist: bn(60) })

        // Set COMP tokens as reward
        rewardAmountCOMP = bn('1e18')

        // COMP Rewards
        await compoundMock.setRewards(main.address, rewardAmountCOMP)

        // Collect revenue
        // Expected values based on Prices between COMP and RSR/RToken = 1 to 1 (for simplification)
        let sellAmt: BigNumber = rewardAmountCOMP.mul(6).div(10) // due to f = 60%
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = rewardAmountCOMP.sub(sellAmt) // Remainder
        let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1%

        await expect(main.claimRewards())
          .to.emit(main, 'RewardsClaimed')
          .withArgs(compToken.address, rewardAmountCOMP)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rsr.balanceOf(other.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)
        expect(await rToken.balanceOf(other.address)).to.equal(0)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check funds in Market
        expect(await compToken.balanceOf(market.address)).to.equal(rewardAmountCOMP)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Perform Mock Bids for RSR and RToken (addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, compToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, compToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        // Check previous auctions closed
        // COMP -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: compToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmt,
          clearingBuyAmount: minBuyAmt,
          externalAuctionId: bn('0'),
          status: AuctionStatus.DONE,
        })

        // COMP -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: compToken.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: sellAmtRToken,
          clearingBuyAmount: minBuyAmtRToken,
          externalAuctionId: bn('1'),
          status: AuctionStatus.DONE,
        })

        // Check balances sent to corresponding destinations
        // StRSR - 50% to StRSR, 50% to other
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt.div(2))
        expect(await rsr.balanceOf(other.address)).to.equal(minBuyAmt.div(2))

        // Furnace - 50% to Furnace, 50% to other
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmtRToken.div(2))
        expect(await rToken.balanceOf(other.address)).to.equal(minBuyAmtRToken.div(2))
        const { amount, start } = await furnace.batches(0)
        expect(amount).to.equal(minBuyAmtRToken.div(2))
        expect(start).to.equal(await getLatestBlockTimestamp())
      })

      it('Should claim and sweep rewards to Main from the Revenue Traders', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        rewardAmountAAVE = bn('0.5e18')

        // AAVE Rewards
        await token2.setRewards(rsrTrader.address, rewardAmountAAVE)

        // Check balance in main and Traders
        expect(await aaveToken.balanceOf(main.address)).to.equal(0)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)

        // Collect revenue
        await expect(rsrTrader.claimAndSweepRewardsToMain()).to.emit(rsrTrader, 'RewardsClaimed')

        // Check rewards sent to Main
        expect(await aaveToken.balanceOf(main.address)).to.equal(rewardAmountAAVE)
        expect(await aaveToken.balanceOf(rsrTrader.address)).to.equal(0)
      })
    })

    context('With non-valid Claim Adapters', async function () {
      let issueAmount: BigNumber
      let newATokenCollateral: ATokenFiatCollateralP0
      let newCTokenCollateral: CTokenFiatCollateralP0
      let nonTrustedClaimer: CompoundClaimAdapterP0

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Deploy new AToken with no claim adapter
        const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateralP0')
        newATokenCollateral = <ATokenFiatCollateralP0>(
          await ATokenCollateralFactory.deploy(
            token2.address,
            await collateral2.maxAuctionSize(),
            token0.address,
            main.address,
            compoundMock.address,
            aaveMock.address,
            ZERO_ADDRESS
          )
        )

        // Deploy non trusted Compound claimer - with invalid Comptroller address
        const CompoundClaimAdapterFactory = await ethers.getContractFactory(
          'CompoundClaimAdapterP0'
        )
        nonTrustedClaimer = <CompoundClaimAdapterP0>(
          await CompoundClaimAdapterFactory.deploy(other.address, await compAsset.erc20())
        )

        // Deploy new CToken with non-trusted claim adapter
        const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateralP0')
        newCTokenCollateral = <CTokenFiatCollateralP0>(
          await CTokenCollateralFactory.deploy(
            token3.address,
            await collateral3.maxAuctionSize(),
            token0.address,
            main.address,
            compoundMock.address,
            nonTrustedClaimer.address
          )
        )
      })

      it('Should ignore claiming if no adapter defined', async () => {
        await main.swapRegisteredAsset(newATokenCollateral.address)

        // Setup new basket with AToken with no claim adapter
        await main.connect(owner).setPrimeBasket([token2.address], [fp('1')])
        await main.connect(owner).switchBasket()

        // Provide approvals
        await token2.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Set AAVE Rewards
        await token2.setRewards(main.address, bn('0.5e18'))

        // Attempt to claim, no rewards claimed (0 amount)
        await expect(main.claimRewards()).to.emit(main, 'RewardsClaimed')
      })

      it('Should revert for non-trusted adapters', async () => {
        await main.swapRegisteredAsset(newCTokenCollateral.address)

        // Setup new basket with CToken with untrusted adapter
        await main.connect(owner).setPrimeBasket([token3.address], [fp('1')])
        await main.connect(owner).switchBasket()

        // Provide approvals
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Will revert when attempting to get rewards
        await expect(main.claimRewards()).to.be.revertedWith('claim adapter is not trusted')
      })
    })

    context('With simple basket of ATokens and CTokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Setup new basket with ATokens and CTokens
        await main
          .connect(owner)
          .setPrimeBasket([token2.address, token3.address], [fp('0.5'), fp('0.5')])
        await main.connect(owner).switchBasket()

        // Provide approvals
        await token2.connect(addr1).approve(main.address, initialBal)
        await token3.connect(addr1).approve(main.address, initialBal)

        // Issue rTokens
        await main.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it.skip('Should sell collateral as it appreciates and handle revenue auction correctly', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Check Price and Assets value
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken to double
        await token2.setExchangeRate(fp('2'))

        // Check Price (unchanged) and Assets value increment by 50%
        const excessValue: BigNumber = issueAmount.div(2)
        const excessQuantity: BigNumber = excessValue.div(2) // Because each unit is now worth $2
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount.add(excessValue))
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values
        let currentTotalSupply: BigNumber = await rToken.totalSupply()
        const expectedToTrader = excessQuantity.mul(60).div(100)
        const expectedToFurnace = excessQuantity.sub(expectedToTrader)

        const maxAuction: BigNumber = divCeil(currentTotalSupply, bn(100)).div(2) // due to max auction = 1% and because token is worth double
        let sellAmt: BigNumber = maxAuction
        let minBuyAmt: BigNumber = sellAmt.mul(2).sub(sellAmt.mul(2).div(100)) // due to trade slippage 1% and because RSR/RToken are worth half

        // Call Poke to detect excess and launch auction
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, token2.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, token2.address, rToken.address, sellAmt, minBuyAmt)

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        let auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: token2.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // AToken -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: token2.address,
          buy: rToken.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check funds in Market and Traders
        expect(await token2.balanceOf(market.address)).to.equal(sellAmt.mul(2))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToFurnace.sub(sellAmt)
        )

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Close auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, token2.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, token2.address, rToken.address, sellAmt, minBuyAmt)
          .and.to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(1, token2.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(1, token2.address, rToken.address, sellAmt, minBuyAmt)

        // Check Price (unchanged) and Assets value (unchanged)
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage - RSR and RTokens already in StRSR and Furnace
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        expect(await rToken.balanceOf(furnace.address)).to.equal(minBuyAmt)

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check previous auctions are already closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)

        // Check auctions registered
        // AToken -> RSR Auction
        await expectAuctionInfo(rsrTrader, 1, {
          sell: token2.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('2'),
          status: AuctionStatus.OPEN,
        })

        // AToken -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 1, {
          sell: token2.address,
          buy: rToken.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('3'),
          status: AuctionStatus.OPEN,
        })

        // Check funds in Market and Traders at this stage (more auctions will occur if we continue the process)
        expect(await token2.balanceOf(market.address)).to.equal(sellAmt.mul(2))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(
          expectedToTrader.sub(sellAmt.mul(2))
        )
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToFurnace.sub(sellAmt.mul(2))
        )
      })

      it('Should handle slight increase in collateral correctly - full cycle', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Check Price and Assets value
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Increase redemption rate for AToken by 2%
        const rate: BigNumber = fp('1.02')
        await token2.setExchangeRate(rate)

        // Check Price (unchanged) and Assets value increment by 1% (only half of the basket increased in value)
        const excessValue: BigNumber = issueAmount.mul(1).div(100)
        const excessQuantity: BigNumber = divCeil(excessValue.mul(BN_SCALE_FACTOR), rate) // Because each unit is now worth $1.02
        expect(near(await main.rTokenPrice(), fp('1'), 1)).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(issueAmount.add(excessValue))
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Expected values
        let currentTotalSupply: BigNumber = await rToken.totalSupply()
        const expectedToTrader = divCeil(excessQuantity.mul(60), bn(100))
        const expectedToFurnace = divCeil(excessQuantity.mul(40), bn(100)) // excessQuantity.sub(expectedToTrader)

        // Auction values - using divCeil for dealing with Rounding
        let sellAmt: BigNumber = expectedToTrader
        let buyAmt: BigNumber = divCeil(sellAmt.mul(rate), BN_SCALE_FACTOR) // RSR quantity with no slippage
        let minBuyAmt: BigNumber = buyAmt.sub(divCeil(buyAmt, bn(100))) // due to trade slippage 1%

        let sellAmtRToken: BigNumber = expectedToFurnace
        let buyAmtRToken: BigNumber = divCeil(sellAmtRToken.mul(rate), BN_SCALE_FACTOR) // RToken quantity with no slippage
        let minBuyAmtRToken: BigNumber = buyAmtRToken.sub(buyAmtRToken.div(100)) // due to trade slippage 1%

        // Call Poke to detect excess and launch auction
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, token2.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(0, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

        // Check Price (unchanged) and Assets value (restored) - Supply remains constant
        expect(near(await main.rTokenPrice(), fp('1'), 1)).to.equal(true)
        expect(near(await facade.totalAssetValue(), issueAmount, 2)).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check destinations at this stage
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        let auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // AToken -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: token2.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // AToken -> RToken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: token2.address,
          buy: rToken.address,
          sellAmount: sellAmtRToken,
          minBuyAmount: minBuyAmtRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check funds in Market and Traders
        expect(near(await token2.balanceOf(market.address), excessQuantity, 1)).to.equal(true)
        expect(await token2.balanceOf(market.address)).to.equal(sellAmt.add(sellAmtRToken))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(
          expectedToFurnace.sub(sellAmtRToken)
        )
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // Mock auction by minting the buy tokens (in this case RSR and RToken)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await rToken.connect(addr1).approve(market.address, minBuyAmtRToken)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRToken,
          buyAmount: minBuyAmtRToken,
        })

        // Close auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, token2.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(0, token2.address, rToken.address, sellAmtRToken, minBuyAmtRToken)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        //  Check Price (unchanged) and Assets value (unchanged)
        expect(near(await main.rTokenPrice(), fp('1'), 1)).to.equal(true)
        expect(near(await facade.totalAssetValue(), issueAmount, 2)).to.equal(true)
        expect(await rToken.totalSupply()).to.equal(currentTotalSupply)

        // Check previous auctions are already closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)

        // Check balances sent to corresponding destinations
        // StRSR
        expect(near(await rsr.balanceOf(stRSR.address), minBuyAmt, 1)).to.equal(true)
        // Furnace
        expect(near(await rToken.balanceOf(furnace.address), minBuyAmtRToken, 1)).to.equal(true)
        const { amount, start } = await furnace.batches(0)
        expect(near(amount, minBuyAmtRToken, 1)).to.equal(true)
        expect(start).to.equal(await getLatestBlockTimestamp())
      })

      it.skip('Should mint RTokens when collateral appreciates and handle revenue auction correctly - Even quantity', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Check Price and Assets value
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rate for AToken and CToken to double
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('2'))

        // Check Price (unchanged) and Assets value (now doubled)
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2))
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set expected minting, based on f = 0.6
        const expectedToTrader = issueAmount.mul(60).div(100)
        const expectedToFurnace = issueAmount.sub(expectedToTrader)

        // Set expected auction values
        let currentTotalSupply: BigNumber = await rToken.totalSupply()
        let newTotalSupply: BigNumber = currentTotalSupply.mul(2)
        let sellAmt: BigNumber = divCeil(newTotalSupply, bn(4)) // due to max auction size of 25% - rounding logic included
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // due to trade slippage 1%

        // Call Poke to collect revenue and mint new tokens - Will also launch auction
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rToken, 'Transfer')
          .withArgs(ZERO_ADDRESS, main.address, issueAmount)
          .and.to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, rToken.address, rsr.address, sellAmt, minBuyAmt)

        // Check Price (unchanged) and Assets value - Supply has doubled
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2))
        expect(await rToken.totalSupply()).to.equal(newTotalSupply)

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(expectedToTrader.sub(sellAmt))
        expect(await rToken.balanceOf(furnace.address)).to.equal(expectedToFurnace)

        // Check funds in Market
        expect(await rToken.balanceOf(market.address)).to.equal(sellAmt)

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: rToken.address,
          buy: rsr.address,
          sellAmount: sellAmt,
          minBuyAmount: minBuyAmt,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Perform Mock Bids for RSR(addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        // Calculate pending amount
        let sellAmtRemainder: BigNumber = expectedToTrader.sub(sellAmt)
        let minBuyAmtRemainder: BigNumber = sellAmtRemainder.sub(sellAmtRemainder.div(100)) // due to trade slippage 1%

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        //  End current auction, should start a new one with same amount
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, rToken.address, rsr.address, sellAmt, minBuyAmt)
          .and.to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(1, rToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder)

        // Check Price and Assets value - RToken price increases due to melting
        let updatedRTokenPrice: BigNumber = newTotalSupply
          .mul(BN_SCALE_FACTOR)
          .div(await rToken.totalSupply())
        expect(await main.rTokenPrice()).to.equal(updatedRTokenPrice)
        expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2))
        let { melted } = await furnace.batches(0)
        expect(await rToken.totalSupply()).to.equal(newTotalSupply.sub(melted))

        // Check destinations after newly minted tokens
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(expectedToFurnace.sub(melted))

        // Check funds in Market
        expect(await rToken.balanceOf(market.address)).to.equal(expectedToTrader.sub(sellAmt))

        // Check previous auction closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)

        // Check new auction
        await expectAuctionInfo(rsrTrader, 1, {
          sell: rToken.address,
          buy: rsr.address,
          sellAmount: sellAmtRemainder,
          minBuyAmount: minBuyAmtRemainder,
          startTime: await getLatestBlockTimestamp(),
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Perform Mock Bids for RSR(addr1 has balance)
        await rsr.connect(addr1).approve(market.address, minBuyAmtRemainder)
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRemainder,
          buyAmount: minBuyAmtRemainder,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // End current auction, should not start a new one
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(1, rToken.address, rsr.address, sellAmtRemainder, minBuyAmtRemainder)
          .and.to.not.emit(rsrTrader, 'AuctionStarted')

        // Check Price and Assets value - RToken price increases due to melting
        updatedRTokenPrice = newTotalSupply.mul(BN_SCALE_FACTOR).div(await rToken.totalSupply())
        expect(await main.rTokenPrice()).to.equal(updatedRTokenPrice)
        expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2))
        ;({ melted } = await furnace.batches(0))
        expect(await rToken.totalSupply()).to.equal(newTotalSupply.sub(melted))

        // Check destinations
        expect(await rsr.balanceOf(stRSR.address)).to.equal(minBuyAmt.add(minBuyAmtRemainder))
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(expectedToFurnace.sub(melted))
      })

      it('Should mint RTokens and handle remainder when collateral appreciates - Uneven quantity', async () => {
        // Advance time to get next reward
        await advanceTime(config.rewardPeriod.toString())

        // Check Price and Assets value
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Change redemption rates for AToken and CToken - Higher for the AToken
        await token2.setExchangeRate(fp('2'))
        await token3.setExchangeRate(fp('1.6'))

        // Check Price (unchanged) and Assets value (now 80% higher)
        const excessTotalValue: BigNumber = issueAmount.mul(80).div(100)
        expect(near(await main.rTokenPrice(), fp('1'), 1)).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(issueAmount.add(excessTotalValue))
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check status of destinations and traders at this point
        expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(0)

        // Set expected values based on f=0.6
        let currentTotalSupply: BigNumber = await rToken.totalSupply()
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
        let newTotalSupply: BigNumber = currentTotalSupply.mul(160).div(100)
        let sellAmtFromRToken: BigNumber = expectedToTraderFromRToken // all will be processed at once, due to max auction size of 50%
        let minBuyAmtFromRToken: BigNumber = sellAmtFromRToken.sub(sellAmtFromRToken.div(100)) // due to trade slippage 1%
        let sellAmtRSRFromCollateral: BigNumber = expectedToRSRTraderFromCollateral // all will be processed at once, due to max auction size of 50%
        let minBuyAmtRSRFromCollateral: BigNumber = sellAmtRSRFromCollateral
          .mul(2)
          .sub(sellAmtRSRFromCollateral.mul(2).div(100)) // due to trade slippage 1% and because RSR/RToken is worth half
        let sellAmtRTokenFromCollateral: BigNumber = expectedToRTokenTraderFromCollateral // all will be processed at once, due to max auction size of 50%
        let minBuyAmtRTokenFromCollateral: BigNumber = sellAmtRTokenFromCollateral
          .mul(2)
          .sub(sellAmtRTokenFromCollateral.mul(2).div(100)) // due to trade slippage 1% and because RSR/RToken is worth half

        //  Collect revenue and mint new tokens - Will also launch auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rToken, 'Transfer')
          .withArgs(ZERO_ADDRESS, main.address, excessRToken)
          .and.to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(0, rToken.address, rsr.address, sellAmtFromRToken, minBuyAmtFromRToken)
          .and.to.emit(rsrTrader, 'AuctionStarted')
          .withArgs(
            1,
            token2.address,
            rsr.address,
            sellAmtRSRFromCollateral,
            minBuyAmtRSRFromCollateral
          )
          .and.to.emit(rTokenTrader, 'AuctionStarted')
          .withArgs(
            0,
            token2.address,
            rToken.address,
            sellAmtRTokenFromCollateral,
            minBuyAmtRTokenFromCollateral
          )

        // Check Price (unchanged) and Assets value (excess collateral not counted anymore) - Supply has increased
        expect(await main.rTokenPrice()).to.equal(fp('1'))
        expect(await facade.totalAssetValue()).to.equal(issueAmount.add(excessRToken))
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
        expect(await rToken.balanceOf(market.address)).to.equal(sellAmtFromRToken)
        expect(await token2.balanceOf(market.address)).to.equal(
          sellAmtRSRFromCollateral.add(sellAmtRTokenFromCollateral)
        )

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auctions registered
        // RToken -> RSR Auction
        await expectAuctionInfo(rsrTrader, 0, {
          sell: rToken.address,
          buy: rsr.address,
          sellAmount: sellAmtFromRToken,
          minBuyAmount: minBuyAmtFromRToken,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Collateral -> RSR Auction
        await expectAuctionInfo(rsrTrader, 1, {
          sell: token2.address,
          buy: rsr.address,
          sellAmount: sellAmtRSRFromCollateral,
          minBuyAmount: minBuyAmtRSRFromCollateral,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Collateral -> Rtoken Auction
        await expectAuctionInfo(rTokenTrader, 0, {
          sell: token2.address,
          buy: rToken.address,
          sellAmount: sellAmtRTokenFromCollateral,
          minBuyAmount: minBuyAmtRTokenFromCollateral,
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionPeriod),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('2'),
          status: AuctionStatus.OPEN,
        })

        //  Perform Mock Bids for RSR/RToken (addr1 has balance)
        await rsr
          .connect(addr1)
          .approve(market.address, minBuyAmtFromRToken.add(minBuyAmtRSRFromCollateral))
        await rToken.connect(addr1).approve(market.address, minBuyAmtRTokenFromCollateral)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmtFromRToken,
          buyAmount: minBuyAmtFromRToken,
        })

        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRSRFromCollateral,
          buyAmount: minBuyAmtRSRFromCollateral,
        })

        await market.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRTokenFromCollateral,
          buyAmount: minBuyAmtRTokenFromCollateral,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionPeriod.add(100).toString())

        // End current auction, should start a new one with same amount
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(0, rToken.address, rsr.address, sellAmtFromRToken, minBuyAmtFromRToken)
          .and.to.emit(rsrTrader, 'AuctionEnded')
          .withArgs(
            1,
            token2.address,
            rsr.address,
            sellAmtRSRFromCollateral,
            minBuyAmtRSRFromCollateral
          )
          .and.to.emit(rTokenTrader, 'AuctionEnded')
          .withArgs(
            0,
            token2.address,
            rToken.address,
            sellAmtRTokenFromCollateral,
            minBuyAmtRTokenFromCollateral
          )
          .and.to.not.emit(rsrTrader, 'AuctionStarted')
          .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        //  Check previous auctions closed
        await expectAuctionStatus(rsrTrader, 0, AuctionStatus.DONE)
        await expectAuctionStatus(rsrTrader, 1, AuctionStatus.DONE)
        await expectAuctionStatus(rTokenTrader, 0, AuctionStatus.DONE)

        // Check no funds in Market
        expect(await rToken.balanceOf(market.address)).to.equal(0)
        expect(await token2.balanceOf(market.address)).to.equal(0)

        //  Check Price and Assets value - RToken price increases due to melting
        let updatedRTokenPrice: BigNumber = newTotalSupply
          .mul(BN_SCALE_FACTOR)
          .div(await rToken.totalSupply())
        expect(await main.rTokenPrice()).to.equal(updatedRTokenPrice)
        expect(await facade.totalAssetValue()).to.equal(issueAmount.add(excessRToken))
        let { melted } = await furnace.batches(0)
        expect(await rToken.totalSupply()).to.equal(newTotalSupply.sub(melted))

        //  Check destinations
        expect(await rsr.balanceOf(stRSR.address)).to.equal(
          minBuyAmtFromRToken.add(minBuyAmtRSRFromCollateral)
        )
        expect(await rToken.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rsrTrader.address)).to.equal(0)
        expect(await token2.balanceOf(rTokenTrader.address)).to.equal(0)
        expect(await rToken.balanceOf(furnace.address)).to.equal(
          expectedToFurnaceFromRToken.add(minBuyAmtRTokenFromCollateral).sub(melted)
        )
      })
    })
  })
})

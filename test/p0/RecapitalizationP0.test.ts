import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import {
  AuctionStatus,
  BN_SCALE_FACTOR,
  CollateralStatus,
  ZERO_ADDRESS,
} from '../../common/constants'
import { bn, divCeil, fp, near, toBNDecimals } from '../../common/numbers'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { AssetP0 } from '../../typechain/AssetP0'
import { ATokenFiatCollateralP0 } from '../../typechain/ATokenFiatCollateralP0'
import { CollateralP0 } from '../../typechain/CollateralP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CTokenFiatCollateralP0 } from '../../typechain/CTokenFiatCollateralP0'
import { CTokenMock } from '../../typechain/CTokenMock'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { ExplorerFacadeP0 } from '../../typechain/ExplorerFacadeP0'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { MainP0 } from '../../typechain/MainP0'
import { MarketMock } from '../../typechain/MarketMock'
import { RevenueTraderP0 } from '../../typechain/RevenueTraderP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { TraderP0 } from '../../typechain/TraderP0'
import { USDCMock } from '../../typechain/USDCMock'
import {
  AssetRegistryP0,
  BackingManagerP0,
  BasketHandlerP0,
  RTokenIssuerP0,
  RevenueDistributorP0,
  SettingsP0,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig, IRevenueShare } from './utils/fixtures'

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
  let compoundOracleInternal: CompoundOracleMockP0
  let aaveToken: ERC20Mock
  let aaveAsset: AssetP0
  let aaveMock: AaveLendingPoolMockP0
  let aaveOracleInternal: AaveOracleMockP0

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
  let backupToken1: ERC20Mock
  let backupToken2: ERC20Mock
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: ATokenFiatCollateralP0
  let collateral3: CTokenFiatCollateralP0
  let backupCollateral1: CollateralP0
  let backupCollateral2: CollateralP0
  let basketsNeededAmts: BigNumber[]
  let basket: Collateral[]

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
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let rTokenIssuer: RTokenIssuerP0
  let revenueDistributor: RevenueDistributorP0
  let settings: SettingsP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  interface IBackingInfo {
    tokens: string[]
    quantities: BigNumber[]
  }

  const expectCurrentBacking = async (
    facade: ExplorerFacadeP0,
    backingInfo: Partial<IBackingInfo>
  ) => {
    const { tokens, quantities } = await facade.currentBacking()

    expect(tokens).to.eql(backingInfo.tokens)
    expect(quantities).to.eql(backingInfo.quantities)
  }

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    let erc20s: ERC20Mock[]

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
      compoundOracleInternal,
      aaveOracleInternal,
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
      assetRegistry,
      backingManager,
      basketHandler,
      rTokenIssuer,
      revenueDistributor,
      settings,
    } = await loadFixture(defaultFixture))
    token0 = erc20s[collateral.indexOf(basket[0])]
    token1 = erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = <ATokenFiatCollateralP0>basket[2]
    collateral3 = <CTokenFiatCollateralP0>basket[3]

    // Backup tokens and collaterals - USDT and cUSDT
    backupToken1 = erc20s[2]
    backupCollateral1 = collateral[2]
    backupToken2 = erc20s[9]
    backupCollateral2 = collateral[9]

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)
    await backupToken1.connect(owner).mint(addr1.address, initialBal)
    await backupToken2.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
    await backupToken1.connect(owner).mint(addr1.address, initialBal)
    await backupToken2.connect(owner).mint(addr1.address, initialBal)
  })

  describe('Default Handling - Basket Selection', function () {
    context('With issued Rtokens', async function () {
      let issueAmount: BigNumber
      let initialTokens: string[]
      let initialQuantities: BigNumber[]
      let initialQuotes: BigNumber[]
      let quotes: BigNumber[]

      beforeEach(async function () {
        issueAmount = bn('100e18')
        initialQuotes = [bn('0.25e18'), bn('0.25e6'), bn('0.25e18'), bn('0.25e8')]
        initialQuantities = initialQuotes.map((q) => {
          return q.mul(issueAmount).div(BN_SCALE_FACTOR)
        })

        initialTokens = await Promise.all(
          basket.map(async (c): Promise<string> => {
            return await c.erc20()
          })
        )

        // Provide approvals
        await token0.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await token1.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await token2.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await token3.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await backupToken1.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await backupToken2.connect(addr1).approve(rTokenIssuer.address, initialBal)

        // Issue rTokens
        await rTokenIssuer.connect(addr1).issue(issueAmount)
      })

      it('Should select backup config correctly - Single backup token', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).registerAsset(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking(facade, {
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))

        // Mark default as probable
        await collateral1.forceUpdates()

        // Check state - No changes
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        // quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        // expect(quotes).to.eql(initialQuotes)
        await expectCurrentBacking(facade, {
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should not switch yet
        await expect(basketHandler.ensureValidBasket()).to.not.emit(basketHandler, 'BasketSet')

        // Advance time post defaultDelay
        await advanceTime(config.defaultDelay.toString())

        // Confirm default
        await collateral1.forceUpdates()

        // Check state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(bn('75e18')) // 25% defaulted, value = 0
        await expectCurrentBacking(facade, {
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should switch
        await expect(basketHandler.ensureValidBasket()).to.emit(basketHandler, 'BasketSet')

        // Check state - Basket switch
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking(facade, {
          tokens: [initialTokens[0], initialTokens[2], initialTokens[3], backupToken1.address],
          quantities: [initialQuantities[0], initialQuantities[2], initialQuantities[3], bn('0')],
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql([initialQuotes[0], initialQuotes[2], initialQuotes[3], bn('0.25e18')])
      })

      it('Should select backup config correctly - Multiple backup tokens', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).registerAsset(backupCollateral1.address)
        await assetRegistry.connect(owner).registerAsset(backupCollateral2.address)

        // Set backup configuration - USDT and cUSDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            backupToken1.address,
            backupToken2.address,
          ])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking(facade, {
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token2 to hard default - Decrease rate
        await token2.setExchangeRate(fp('0.99'))

        // Basket should switch as default is detected immediately
        // Perform via facade (same result)
        await expect(facade.ensureValidBasket()).to.emit(basketHandler, 'BasketSet')

        // Check state - Basket switch
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking(facade, {
          tokens: [
            initialTokens[0],
            initialTokens[1],
            initialTokens[3],
            backupToken1.address,
            backupToken2.address,
          ],
          quantities: [
            initialQuantities[0],
            initialQuantities[1],
            initialQuantities[3],
            bn('0'),
            bn('0'),
          ],
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql([
          initialQuotes[0],
          initialQuotes[1],
          initialQuotes[3],
          bn('0.125e18'),
          bn('0.125e18'),
        ])
      })

      it('Should replace ATokens/CTokens if underlying erc20 defaults', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).registerAsset(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking(facade, {
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))
        await compoundOracleInternal.setPrice(await token0.symbol(), bn('0.5e6'))

        // Mark default as probable
        await collateral0.forceUpdates()

        // Check state - No changes
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking(facade, {
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should not switch yet
        await expect(basketHandler.ensureValidBasket()).to.not.emit(basketHandler, 'BasketSet')

        // Advance time post defaultDelay
        await advanceTime(config.defaultDelay.toString())

        // Basket should switch, default is confirmed
        await expect(basketHandler.ensureValidBasket()).to.emit(basketHandler, 'BasketSet')

        // Check state - Basket switch
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking(facade, {
          tokens: [initialTokens[1], backupToken1.address],
          quantities: [initialQuantities[1], bn('0')],
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql([initialQuotes[1], bn('0.75e18')])
      })

      it('Should combine weights if collateral is merged in the new basket', async () => {
        // Set backup configuration - USDT and cDAI as backup (cDai will be ignored as will be defaulted later)
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            token0.address,
            token3.address,
          ])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking(facade, {
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token3 to hard default - Decrease rate (cDai)
        await token3.setExchangeRate(fp('0.8'))

        // Basket should switch as default is detected immediately
        await expect(basketHandler.ensureValidBasket()).to.emit(basketHandler, 'BasketSet')

        // Check state - Basket switch
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking(facade, {
          tokens: [initialTokens[0], initialTokens[1], initialTokens[2]],
          quantities: [initialQuantities[0], initialQuantities[1], initialQuantities[2]],
        })
        quotes = await rTokenIssuer.connect(addr1).callStatic.issue(bn('1e18'))
        // Incremented the weight for token0
        expect(quotes).to.eql([bn('0.5e18'), initialQuotes[1], initialQuotes[2]])
      })
    })
  })

  describe('Recapitalization', function () {
    context('With very simple Basket - Single stablecoin', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')

        // Setup new basket with single token
        await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
        await basketHandler.connect(owner).switchBasket()

        // Provide approvals
        await token0.connect(addr1).approve(rTokenIssuer.address, initialBal)

        // Issue rTokens
        await rTokenIssuer.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should recapitalize correctly when switching basket - Full amount covered', async () => {
        // Setup prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket()).to.emit(
          basketHandler,
          'BasketSet'
        )

        // Check state remains SOUND
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Trigger recapitalization
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionStarted')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectAuctionInfo(backingManager, 0, {
          sell: token0.address,
          buy: token1.address,
          sellAmount: sellAmt,
          minBuyAmount: toBNDecimals(minBuyAmt, 6),
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionLength),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Check state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, everything was moved to the Market
        expect(await facade.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Check Market
        expect(await token0.balanceOf(market.address)).to.equal(issueAmount)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(
          backingManager,
          'AuctionStarted'
        )

        //  expect(await main.state()).to.equal(State.TRADING)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Get fair price - all tokens
        await token1.connect(addr1).approve(market.address, toBNDecimals(sellAmt, 6))
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: toBNDecimals(sellAmt, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction, should  not start any new auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionEnded')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(sellAmt, 6))
          .and.to.not.emit(backingManager, 'AuctionStarted')

        // Check previous auction is closed
        await expectAuctionStatus(backingManager, 0, AuctionStatus.DONE)

        // Check state - Order restablished
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(
          toBNDecimals(issueAmount, 6)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))
      })

      it('Should recapitalize correctly when switching basket - Taking Haircut - No RSR', async () => {
        // Set prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket()).to.emit(
          basketHandler,
          'BasketSet'
        )

        // Check state remains SOUND
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Trigger recapitalization
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionStarted')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectAuctionInfo(backingManager, 0, {
          sell: token0.address,
          buy: token1.address,
          sellAmount: sellAmt,
          minBuyAmount: toBNDecimals(minBuyAmt, 6),
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionLength),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Check state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, everything was moved to the Market
        expect(await facade.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Check Market
        expect(await token0.balanceOf(market.address)).to.equal(issueAmount)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(
          backingManager,
          'AuctionStarted'
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Only cover minBuyAmount - 10% less
        await token1.connect(addr1).approve(market.address, toBNDecimals(sellAmt, 6))
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: toBNDecimals(minBuyAmt, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction, should  not start any new auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionEnded')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))
          .and.to.not.emit(backingManager, 'AuctionStarted')

        // Check previous auction is closed
        await expectAuctionStatus(backingManager, 0, AuctionStatus.DONE)

        // Check state - Haircut taken, price of RToken has been reduced
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(minBuyAmt)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(toBNDecimals(minBuyAmt, 6))
        expect(await rToken.totalSupply()).to.equal(issueAmount) // Supply remains constant

        //  Check price in USD of the current RToken - Haircut of 10% taken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('0.99'))
      })

      it('Should recapitalize correctly when switching basket - Using RSR for remainder', async () => {
        // Set prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Perform stake
        const stkAmount: BigNumber = bn('100e18')
        await rsr.connect(addr1).approve(stRSR.address, stkAmount)
        await stRSR.connect(addr1).stake(stkAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket()).to.emit(
          basketHandler,
          'BasketSet'
        )

        // Check state remains SOUND
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Trigger recapitalization
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionStarted')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        let auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectAuctionInfo(backingManager, 0, {
          sell: token0.address,
          buy: token1.address,
          sellAmount: sellAmt,
          minBuyAmount: toBNDecimals(minBuyAmt, 6),
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionLength),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Check state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, everything was moved to the Market
        expect(await facade.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Check Market
        expect(await token0.balanceOf(market.address)).to.equal(issueAmount)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(
          backingManager,
          'AuctionStarted'
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Get fair price - minBuyAmt
        await token1.connect(addr1).approve(market.address, toBNDecimals(sellAmt, 6))
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: toBNDecimals(minBuyAmt, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction, should start a new one to sell RSR for collateral
        // Only 1e18 Tokens left to buy - Sets Buy amount as independent value
        let buyAmtBidRSR: BigNumber = sellAmt.sub(minBuyAmt)
        let sellAmtRSR: BigNumber = buyAmtBidRSR.mul(BN_SCALE_FACTOR).div(fp('0.99')) // Due to trade slippage 1% - Calculation to match Solidity

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionEnded')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))
          .and.to.emit(backingManager, 'AuctionStarted')
          .withArgs(1, rsr.address, token1.address, sellAmtRSR, toBNDecimals(buyAmtBidRSR, 6))

        // Check previous auction is closed
        await expectAuctionStatus(backingManager, 0, AuctionStatus.DONE)

        auctionTimestamp = await getLatestBlockTimestamp()

        // RSR -> Token1 Auction
        await expectAuctionInfo(backingManager, 1, {
          sell: rsr.address,
          buy: token1.address,
          sellAmount: sellAmtRSR,
          minBuyAmount: toBNDecimals(buyAmtBidRSR, 6),
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionLength),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('1'),
          status: AuctionStatus.OPEN,
        })

        // Check state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(toBNDecimals(minBuyAmt, 6))
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Check Market
        expect(await rsr.balanceOf(market.address)).to.equal(sellAmtRSR)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(
          backingManager,
          'AuctionStarted'
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Cover buyAmtBidRSR which is all the RSR required
        await token1.connect(addr1).approve(market.address, toBNDecimals(sellAmtRSR, 6))
        await market.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR,
          buyAmount: toBNDecimals(buyAmtBidRSR, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction, should  not start any new auctions
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionEnded')
          .withArgs(1, rsr.address, token1.address, sellAmtRSR, toBNDecimals(buyAmtBidRSR, 6))
          .and.to.not.emit(backingManager, 'AuctionStarted')

        // Check previous auction is closed
        await expectAuctionStatus(backingManager, 1, AuctionStatus.DONE)

        // Check state - Order restablished
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(
          toBNDecimals(issueAmount, 6)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))
      })

      it('Should recapitalize correctly in case of default - Taking Haircut - No RSR', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).registerAsset(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))

        // Running auctions will not trigger recapitalization until collateral defauls
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(
          backingManager,
          'AuctionStarted'
        )

        // Mark default as probable
        await collateral0.forceUpdates()
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.IFFY)

        // Advance time post defaultDelay
        await advanceTime(config.defaultDelay.toString())

        // Confirm default
        await collateral0.forceUpdates()
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.DISABLED)

        // Ensure valid basket
        await basketHandler.ensureValidBasket()

        // Check new state after basket switch
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RTokenc- Remains the same
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        // Running auctions will trigger recapitalization - All balance will be redeemed
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionStarted')
          .withArgs(0, token0.address, backupToken1.address, sellAmt, bn('0'))

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectAuctionInfo(backingManager, 0, {
          sell: token0.address,
          buy: backupToken1.address,
          sellAmount: sellAmt,
          minBuyAmount: bn(0),
          startTime: auctionTimestamp,
          endTime: auctionTimestamp + Number(config.auctionLength),
          clearingSellAmount: bn('0'),
          clearingBuyAmount: bn('0'),
          externalAuctionId: bn('0'),
          status: AuctionStatus.OPEN,
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(
          backingManager,
          'AuctionStarted'
        )

        //  Check existing auction still open
        await expectAuctionStatus(backingManager, 0, AuctionStatus.OPEN)

        // Check state
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Reduced 50%
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1'))

        //  Perform Mock Bids for the new Token (addr1 has balance)
        //  Assume fair price, get half of the tokens (because price reduction was 50%)
        const minBuyAmt: BigNumber = sellAmt.div(2)
        await backupToken1.connect(addr1).approve(market.address, minBuyAmt)
        await market.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current, will not open any new auctions (no RSR)
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'AuctionEnded')
          .withArgs(0, token0.address, backupToken1.address, sellAmt, minBuyAmt)
          .and.not.to.emit(backingManager, 'AuctionStarted')

        // Check previous auction is closed
        await expectAuctionStatus(backingManager, 0, AuctionStatus.DONE)

        // Check state - Haircut taken, price of RToken has been reduced
        expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.totalAssetValue()).to.equal(minBuyAmt)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt)
        expect(await rToken.totalSupply()).to.equal(issueAmount) // Supply remains constant

        //  Check price in USD of the current RToken - Haircut of 50% taken
        expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1').div(2))
      })

      // it('Should recapitalize correctly in case of default - Using RSR for remainder', async () => {
      //   // Save current RToken Supply
      //   const startingTotalSupply: BigNumber = await rToken.totalSupply()

      //   // Mint some RSR
      //   await rsr.connect(owner).mint(addr1.address, initialBal)

      //   // Perform stake
      //   const stkAmount: BigNumber = bn('100e18')
      //   await rsr.connect(addr1).approve(stRSR.address, stkAmount)
      //   await stRSR.connect(addr1).stake(stkAmount)

      //   // Check stakes
      //   expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
      //   expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

      //   // Check RToken supply
      //   expect(await rToken.totalSupply()).to.equal(issueAmount)

      //   // Set Max auction to 25% and migration chunk to 100% (so everything is redeemd at once)
      //   const newConfig: IConfig = {
      //     rewardPeriod: config.rewardPeriod,
      //     auctionLength: config.auctionLength,
      //     unstakingDelay: config.unstakingDelay,
      //     defaultDelay: config.defaultDelay,
      //     maxTradeSlippage: config.maxTradeSlippage,
      //     maxAuctionSize: fp('0.25'), // 25%
      //     minRecapitalizationAuctionSize: config.minRecapitalizationAuctionSize,
      //     backingBuffer: config.backingBuffer,
      //     migrationChunk: fp('1'), // 100% - Migrate all together
      //     issuanceRate: config.issuanceRate,
      //     defaultThreshold: config.defaultThreshold,
      //     f: config.f,
      //   }

      //   // update config
      //   await main.connect(owner).setConfig(newConfig)

      //   // Check price in USD of the current RToken
      //   expect(await rTokenAsset.priceUSD(main.address)).to.equal(fp('1'))

      //   // Set Token0 to default - 50% price reduction
      //   await aaveOracle.setPrice(token0.address, bn('1.25e14'))

      //   // Check initial state
      //   expect(await main.state()).to.equal(State.CALM)

      //   // Notice default
      //   await expect(main.noticeDefault()).to.emit(main, 'SystemStateChanged').withArgs(State.CALM, State.DOUBT)

      //   // Check state
      //   expect(await main.state()).to.equal(State.DOUBT)
      //   expect(await assetManager.vault()).to.equal(defVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(true)

      //   // Advance time post defaultDelay
      //   await advanceTime(config.defaultDelay.toString())

      //   await expect(main.noticeDefault()).to.emit(main, 'SystemStateChanged').withArgs(State.DOUBT, State.TRADING)

      //   // Check state
      //   expect(await main.state()).to.equal(State.TRADING)
      //   expect(await assetManager.vault()).to.equal(backupVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(false)
      //   expect(await token0.balanceOf(defVault.address)).to.equal(issueAmount)
      //   expect(await defVault.basketUnits(assetManager.address)).to.equal(issueAmount)
      //   expect(await token1.balanceOf(backupVault.address)).to.equal(0)
      //   expect(await backupVault.basketUnits(assetManager.address)).to.equal(0)

      //   // Set expected auction amount - Based on Migration chunk of 100% but using 50% max auction size
      //   let sellAmt: BigNumber = (await token0.balanceOf(defVault.address)).div(2)

      //   // Run recapitalization auction
      //   // Buy amount = 0 when token is defaulted
      //   await expect(main.poke())
      //     .to.emit(assetManager, 'AuctionStarted')
      //     .withArgs(0, token0.address, token1.address, sellAmt, bn('0'), Fate.Stay)

      //   // Check new auction created
      //   expectAuctionInfo(0, {
      //     sell: token0.address,
      //     buy: token1.address,
      //     sellAmount: sellAmt,
      //     minBuyAmount: bn('0'),
      //     startTime: await getLatestBlockTimestamp(),
      //     endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
      //     clearingSellAmount: bn('0'),
      //     clearingBuyAmount: bn('0'),
      //     fate: Fate.Stay,
      //     isOpen: true,
      //   })

      //   // Check state
      //   expect(await main.state()).to.equal(State.TRADING)
      //   expect(await assetManager.vault()).to.equal(backupVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(false)
      //   expect(await token0.balanceOf(defVault.address)).to.equal(0) // Everything was sent to auction (market)
      //   expect(await defVault.basketUnits(assetManager.address)).to.equal(0) // All was redeemed
      //   expect(await token1.balanceOf(backupVault.address)).to.equal(0) // Nothing obtained from auction yet
      //   expect(await backupVault.basketUnits(assetManager.address)).to.equal(0)

      //   // Check RToken supply - Unchanged
      //   expect(await rToken.totalSupply()).to.equal(issueAmount)

      //   // Perform Mock Bids (addr1 has balance)
      //   // Assume fair price, get half of the tokens (because price reduction was 50%)
      //   let buyAmtBid: BigNumber = sellAmt.div(2)
      //   await token1.connect(addr1).approve(trading.address, buyAmtBid)
      //   await trading.placeBid(0, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: buyAmtBid })

      //   // Advance time till auction ended
      //   await advanceTime(newConfig.auctionLength.add(100).toString())

      //   // Call poke to end current auction, should start a new one with same amount
      //   await expect(main.poke())
      //     .to.emit(assetManager, 'AuctionEnded')
      //     .withArgs(0, token0.address, token1.address, sellAmt, buyAmtBid, Fate.Stay)
      //     .and.to.emit(assetManager, 'AuctionStarted')
      //     .withArgs(1, token0.address, token1.address, sellAmt, bn('0'), Fate.Stay)

      //   // Check first auction is closed
      //   expectAuctionOpen(0, false)

      //   // Check new auction
      //   expectAuctionInfo(1, {
      //     sell: token0.address,
      //     buy: token1.address,
      //     sellAmount: sellAmt,
      //     minBuyAmount: bn('0'),
      //     startTime: await getLatestBlockTimestamp(),
      //     endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
      //     clearingSellAmount: bn('0'),
      //     clearingBuyAmount: bn('0'),
      //     fate: Fate.Stay,
      //     isOpen: true,
      //   })

      //   // Check state
      //   expect(await main.state()).to.equal(State.TRADING)
      //   expect(await assetManager.vault()).to.equal(backupVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(false)
      //   expect(await token0.balanceOf(defVault.address)).to.equal(0)
      //   expect(await defVault.basketUnits(assetManager.address)).to.equal(0)
      //   expect(await token1.balanceOf(backupVault.address)).to.equal(buyAmtBid) // Amount obtained from auction
      //   expect(await backupVault.basketUnits(assetManager.address)).to.equal(buyAmtBid) // Already issued BUs based from auction

      //   // Check RToken supply - Unchanged
      //   expect(await rToken.totalSupply()).to.equal(issueAmount)

      //   // Perform Mock Bids (addr1 has balance)
      //   // Assume fair price, get half of the tokens (because price reduction was 50%)
      //   await token1.connect(addr1).approve(trading.address, buyAmtBid)
      //   await trading.placeBid(1, { bidder: addr1.address, sellAmount: sellAmt, buyAmount: buyAmtBid })

      //   // Advance time till auction ended
      //   await advanceTime(newConfig.auctionLength.add(100).toString())

      //   // Check staking situation remains unchanged
      //   expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
      //   expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

      //   // Call poke to end current auction, should start a new one seizing RSR for RToken - Need a total of 50e18 RTokens
      //   // Expected amount to be based max auction size (25e18 because RSR price = 1)
      //   let sellAmtRSR: BigNumber = sellAmt.div(2)
      //   let buyAmtBidRSR: BigNumber = sellAmtRSR.sub(sellAmtRSR.div(100)) // Due to trade slippage 1%
      //   await expect(main.poke())
      //     .to.emit(assetManager, 'AuctionEnded')
      //     .withArgs(1, token0.address, token1.address, sellAmt, buyAmtBid, Fate.Stay)
      //     .and.to.emit(assetManager, 'AuctionStarted')
      //     .withArgs(2, rsr.address, rTokenAsset.address, sellAmtRSR, buyAmtBidRSR, Fate.Burn)

      //   // Check new auction
      //   expectAuctionInfo(2, {
      //     sell: rsr.address,
      //     buy: rTokenAsset.address,
      //     sellAmount: sellAmtRSR,
      //     minBuyAmount: buyAmtBidRSR,
      //     startTime: await getLatestBlockTimestamp(),
      //     endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
      //     clearingSellAmount: bn('0'),
      //     clearingBuyAmount: bn('0'),
      //     fate: Fate.Burn,
      //     isOpen: true,
      //   })

      //   // Check previous auctions are closed
      //   expectAuctionOpen(0, false)
      //   expectAuctionOpen(1, false)

      //   // Check state
      //   expect(await main.state()).to.equal(State.TRADING)
      //   expect(await assetManager.vault()).to.equal(backupVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(false)
      //   expect(await token0.balanceOf(defVault.address)).to.equal(0)
      //   expect(await defVault.basketUnits(assetManager.address)).to.equal(0)
      //   expect(await token1.balanceOf(backupVault.address)).to.equal(buyAmtBid.mul(2)) // Received from both auctions
      //   expect(await backupVault.basketUnits(assetManager.address)).to.equal(buyAmtBid.mul(2)) // All issued from both auctions

      //   // Should have seized RSR
      //   expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)
      //   expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Seized from user

      //   // Check RToken supply - Unchanged
      //   expect(await rToken.totalSupply()).to.equal(issueAmount)

      //   // Perform Mock Bids for RSR (addr1 has balance)
      //   // Assume fair price RSR = 1 to 1 - Get all of them
      //   await rToken.connect(addr1).approve(trading.address, sellAmtRSR)
      //   await trading.placeBid(2, {
      //     bidder: addr1.address,
      //     sellAmount: sellAmtRSR,
      //     buyAmount: sellAmtRSR,
      //   })

      //   // Advance time till auction ended
      //   await advanceTime(newConfig.auctionLength.add(100).toString())

      //   // Call poke to end current auction, should start a new one with remaining RSR to seize
      //   // Will apply max auction size (25%) over the new RToken supply of 75e18 (100e18 - 25e18) = 18.75e18
      //   let sellAmtRSRRemain: BigNumber = (await rToken.totalSupply()).sub(sellAmtRSR).mul(25).div(100)
      //   let buyAmtBidRSRRemain: BigNumber = sellAmtRSRRemain.sub(sellAmtRSRRemain.div(100)) // Due to trade slippage 1%

      //   await expect(main.poke())
      //     .to.emit(assetManager, 'AuctionEnded')
      //     .withArgs(2, rsr.address, rTokenAsset.address, sellAmtRSR, sellAmtRSR, Fate.Burn)
      //     .and.to.emit(assetManager, 'AuctionStarted')
      //     .withArgs(3, rsr.address, rTokenAsset.address, sellAmtRSRRemain, buyAmtBidRSRRemain, Fate.Burn)

      //   // Check new auction
      //   expectAuctionInfo(3, {
      //     sell: rsr.address,
      //     buy: rTokenAsset.address,
      //     sellAmount: sellAmtRSRRemain,
      //     minBuyAmount: buyAmtBidRSRRemain,
      //     startTime: await getLatestBlockTimestamp(),
      //     endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
      //     clearingSellAmount: bn('0'),
      //     clearingBuyAmount: bn('0'),
      //     fate: Fate.Burn,
      //     isOpen: true,
      //   })

      //   // Check previous auctions are closed
      //   expectAuctionOpen(0, false)
      //   expectAuctionOpen(1, false)
      //   expectAuctionOpen(2, false)

      //   // Should have seized RSR
      //   expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR).sub(sellAmtRSRRemain)) // Sent to market (auction)
      //   expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount.sub(sellAmtRSR).sub(sellAmtRSRRemain)) // Seized from user

      //   // Check state
      //   expect(await main.state()).to.equal(State.TRADING)
      //   expect(await assetManager.vault()).to.equal(backupVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(false)
      //   expect(await token0.balanceOf(defVault.address)).to.equal(0)
      //   expect(await defVault.basketUnits(assetManager.address)).to.equal(0)
      //   expect(await token1.balanceOf(backupVault.address)).to.equal(buyAmtBid.mul(2))
      //   expect(await backupVault.basketUnits(assetManager.address)).to.equal(buyAmtBid.mul(2))

      //   // Check RToken supply - Should have burnt the obtained amount from auctions
      //   expect(await rToken.totalSupply()).to.equal(issueAmount.sub(sellAmtRSR))

      //   // Perform Mock Bids for RSR (addr1 has balance)
      //   // Assume fair price RSR = 1 to 1 - Get all of them
      //   await rToken.connect(addr1).approve(trading.address, sellAmtRSRRemain)
      //   await trading.placeBid(3, {
      //     bidder: addr1.address,
      //     sellAmount: sellAmtRSRRemain,
      //     buyAmount: sellAmtRSRRemain,
      //   })
      //   // Advance time till auction ended
      //   await advanceTime(newConfig.auctionLength.add(100).toString())

      //   // Call poke to end current auction, should start a new one with remaining RSR to seize
      //   // Only 6.25e18 Tokens left to buy (50e18 - (25e18 + 18.75e18)) = 6.25e18
      //   // Note:  Sets Buy amount as independent value - Check if this has to be done in previous RSR auctions (Potential issue)
      //   let buyAmtBidRSRFinal: BigNumber = sellAmt.sub(sellAmtRSR).sub(sellAmtRSRRemain)
      //   let sellAmtRSRFinal: BigNumber = buyAmtBidRSRFinal.add(buyAmtBidRSRFinal.div(100)) // Due to trade slippage 1%

      //   await expect(main.poke())
      //     .to.emit(assetManager, 'AuctionEnded')
      //     .withArgs(3, rsr.address, rTokenAsset.address, sellAmtRSRRemain, sellAmtRSRRemain, Fate.Burn)
      //     .and.to.emit(assetManager, 'AuctionStarted')
      //     .withArgs(4, rsr.address, rTokenAsset.address, sellAmtRSRFinal, buyAmtBidRSRFinal, Fate.Burn)

      //   // Check new auction
      //   expectAuctionInfo(4, {
      //     sell: rsr.address,
      //     buy: rTokenAsset.address,
      //     sellAmount: sellAmtRSRFinal,
      //     minBuyAmount: buyAmtBidRSRFinal,
      //     startTime: await getLatestBlockTimestamp(),
      //     endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
      //     clearingSellAmount: bn('0'),
      //     clearingBuyAmount: bn('0'),
      //     fate: Fate.Burn,
      //     isOpen: true,
      //   })

      //   // Check previous auctions are closed
      //   expectAuctionOpen(0, false)
      //   expectAuctionOpen(1, false)
      //   expectAuctionOpen(2, false)
      //   expectAuctionOpen(3, false)

      //   // Should have seized RSR
      //   expect(await rsr.balanceOf(stRSR.address)).to.equal(
      //     stkAmount.sub(sellAmtRSR).sub(sellAmtRSRRemain).sub(sellAmtRSRFinal)
      //   ) // Sent to market (auction)
      //   expect(await stRSR.balanceOf(addr1.address)).to.equal(
      //     stkAmount.sub(sellAmtRSR).sub(sellAmtRSRRemain).sub(sellAmtRSRFinal)
      //   ) // Seized from user

      //   // Check state
      //   expect(await main.state()).to.equal(State.TRADING)
      //   expect(await assetManager.vault()).to.equal(backupVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(false)
      //   expect(await token0.balanceOf(defVault.address)).to.equal(0)
      //   expect(await defVault.basketUnits(assetManager.address)).to.equal(0)
      //   expect(await token1.balanceOf(backupVault.address)).to.equal(buyAmtBid.mul(2))
      //   expect(await backupVault.basketUnits(assetManager.address)).to.equal(buyAmtBid.mul(2))

      //   // Check RToken supply - Should have burnt the obtained amount from auctions
      //   expect(await rToken.totalSupply()).to.equal(issueAmount.sub(sellAmtRSR).sub(sellAmtRSRRemain))

      //   // Perform Mock Bids for RSR (addr1 has balance)
      //   // Assume fair price RSR = 1 to 1 - Get all of them
      //   await rToken.connect(addr1).approve(trading.address, buyAmtBidRSRFinal)
      //   await trading.placeBid(4, {
      //     bidder: addr1.address,
      //     sellAmount: buyAmtBidRSRFinal,
      //     buyAmount: buyAmtBidRSRFinal,
      //   })

      //   // Advance time till auction ended
      //   await advanceTime(newConfig.auctionLength.add(100).toString())

      //   // Call auction to be processed
      //   await expect(main.poke())
      //     .to.emit(assetManager, 'AuctionEnded')
      //     .withArgs(4, rsr.address, rTokenAsset.address, buyAmtBidRSRFinal, buyAmtBidRSRFinal, Fate.Burn)
      //     .and.not.to.emit(assetManager, 'AuctionStarted')

      //   // Check previous auctions are closed
      //   expectAuctionOpen(0, false)
      //   expectAuctionOpen(1, false)
      //   expectAuctionOpen(2, false)
      //   expectAuctionOpen(3, false)
      //   expectAuctionOpen(4, false)

      //   // Check final state - All traded OK
      //   expect(await main.state()).to.equal(State.CALM)
      //   expect(await assetManager.vault()).to.equal(backupVault.address)
      //   expect(await assetManager.fullyCapitalized()).to.equal(true)
      //   expect(await token0.balanceOf(defVault.address)).to.equal(0)
      //   expect(await defVault.basketUnits(assetManager.address)).to.equal(0)
      //   expect(await token1.balanceOf(backupVault.address)).to.equal(buyAmtBid.mul(2))
      //   expect(await backupVault.basketUnits(assetManager.address)).to.equal(buyAmtBid.mul(2))

      //   // Check RToken supply - Should have burnt the obtained amount from auctions
      //   // It should at the end be half of the original supply (because we took a 50% reduction in collateral)
      //   expect(await rToken.totalSupply()).to.equal(
      //     issueAmount.sub(sellAmtRSR).sub(sellAmtRSRRemain).sub(buyAmtBidRSRFinal)
      //   )
      //   expect(await rToken.totalSupply()).to.equal(startingTotalSupply.div(2))

      //   // Check Rtoken price is stable
      //   expect(await rTokenAsset.priceUSD(main.address)).to.equal(fp('1'))
      // })
    })

    context('With issued Rtokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        issueAmount = bn('100e18')

        // Provide approvals
        await token0.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await token1.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await token2.connect(addr1).approve(rTokenIssuer.address, initialBal)
        await token3.connect(addr1).approve(rTokenIssuer.address, initialBal)

        // Issue rTokens
        await rTokenIssuer.connect(addr1).issue(issueAmount)
      })

      it.skip('Should recapitalize correctly when basket changes', async () => {
        // TODO
      })
    })
  })
})

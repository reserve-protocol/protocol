import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import {
  CollateralStatus,
  FURNACE_DEST,
  STRSR_DEST,
  ZERO_ADDRESS,
  BN_SCALE_FACTOR,
} from '../common/constants'
import { bn, fp, toBNDecimals, divCeil } from '../common/numbers'
import { IConfig } from '../common/configuration'
import { advanceTime } from './utils/time'
import { withinQuad } from './utils/matchers'
import {
  ATokenFiatCollateral,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeAct,
  FiatCollateral,
  GnosisMock,
  IBasketHandler,
  StaticATokenMock,
  TestIBackingManager,
  TestIDistributor,
  TestIRevenueTrader,
  TestIRToken,
  USDCMock,
  FacadeMonitor,
} from '../typechain'
import {
  Collateral,
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  defaultFixture,
} from './fixtures'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describe('FacadeMonitor Contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Tokens
  let initialBal: BigNumber
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let aaveToken: ERC20Mock
  let rsr: ERC20Mock
  let basket: Collateral[]

  // Assets
  let tokenAsset: FiatCollateral
  let usdcAsset: FiatCollateral
  let aTokenAsset: ATokenFiatCollateral
  let cTokenAsset: CTokenFiatCollateral

  let config: IConfig

  // Facade
  let facadeAct: FacadeAct
  let facadeMonitor: FacadeMonitor

  // Main
  let rToken: TestIRToken
  let basketHandler: IBasketHandler
  let backingManager: TestIBackingManager
  let distributor: TestIDistributor
  let gnosis: GnosisMock
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Computes the minBuyAmt for a sellAmt at two prices
  // sellPrice + buyPrice should not be the low and high estimates, but rather the oracle prices
  const toMinBuyAmt = async (
    sellAmt: BigNumber,
    sellPrice: BigNumber,
    buyPrice: BigNumber
  ): Promise<BigNumber> => {
    // do all muls first so we don't round unnecessarily
    // a = loss due to max trade slippage
    // b = loss due to selling token at the low price
    // c = loss due to buying token at the high price
    // mirrors the math from TradeLib ~L:57

    const lowSellPrice = sellPrice.sub(sellPrice.mul(ORACLE_ERROR).div(BN_SCALE_FACTOR))
    const highBuyPrice = buyPrice.add(buyPrice.mul(ORACLE_ERROR).div(BN_SCALE_FACTOR))
    const product = sellAmt
      .mul(fp('1').sub(await backingManager.maxTradeSlippage())) // (a)
      .mul(lowSellPrice) // (b)

    return divCeil(divCeil(product, highBuyPrice), fp('1')) // (c)
  }

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({
      aaveToken,
      backingManager,
      basketHandler,
      distributor,
      rsr,
      basket,
      facadeAct,
      facadeMonitor,
      rToken,
      config,
      rTokenTrader,
      rsrTrader,
      gnosis,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenAsset = <FiatCollateral>basket[0]
    usdcAsset = <FiatCollateral>basket[1]
    aTokenAsset = <ATokenFiatCollateral>basket[2]
    cTokenAsset = <CTokenFiatCollateral>basket[3]

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())
  })

  // P1 only
  describeP1('Keepers - Facade Monitor', () => {
    let issueAmount: BigNumber

    beforeEach(async () => {
      // Mint Tokens
      initialBal = bn('10000000000e18')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cToken.connect(owner).mint(addr1.address, initialBal)

      await token.connect(owner).mint(addr2.address, initialBal)
      await usdc.connect(owner).mint(addr2.address, initialBal)
      await aToken.connect(owner).mint(addr2.address, initialBal)
      await cToken.connect(owner).mint(addr2.address, initialBal)

      // Mint RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)

      // Issue some RTokens
      issueAmount = bn('100e18')

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cToken.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('No Trades Available', async () => {
      const response = await facadeMonitor.callStatic.getTradesForBackingManager(rToken.address)

      expect(response.tradesToBeSettled.length).to.equal(0)
      expect(response.tradesToBeStarted.length).to.equal(0)
    })

    it('Trades in Backing Manager', async () => {
      await basketHandler.connect(owner).setPrimeBasket([usdc.address], [fp('1')])

      await expect(basketHandler.connect(owner).refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [usdc.address], [fp('1')], false)

      const sellAmt: BigNumber = await token.balanceOf(backingManager.address)
      const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

      const response = await facadeMonitor.callStatic.getTradesForBackingManager(rToken.address)

      expect(response.tradesToBeStarted.length > 0).to.be.true

      // Run auction via Facade
      let [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(backingManager, 'TradeStarted')
        .withArgs(anyValue, token.address, usdc.address, sellAmt, toBNDecimals(minBuyAmt, 6).add(1))

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)

      // Perform Mock Bids for the new Token (addr1 has balance)
      // Get fair price - all tokens
      await usdc.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmt,
        buyAmount: toBNDecimals(sellAmt, 6),
      })

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      const response2 = await facadeMonitor.callStatic.getTradesForBackingManager(rToken.address)

      expect(
        response2.tradesToBeSettled.filter((e) => e != ethers.constants.AddressZero).length > 0
      ).to.be.true

      // Trade is ready to be settled - Call settle trade via  Facade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // End current auction
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(backingManager, 'TradeSettled')
        .withArgs(anyValue, token.address, usdc.address, sellAmt, toBNDecimals(sellAmt, 6))

      const response3 = await facadeMonitor.callStatic.getTradesForBackingManager(rToken.address)

      expect(
        response3.tradesToBeSettled.filter((e) => e != ethers.constants.AddressZero).length == 0
      ).to.be.true
    })

    it('Revenues/Rewards - Traders', async () => {
      const rewardAmountAAVE = bn('0.5e18')

      // AAVE Rewards
      await aToken.setRewards(backingManager.address, rewardAmountAAVE)

      // Via Facade get next call - will claim rewards from backingManager
      let [addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // Claim and sweep rewards
      await owner.sendTransaction({
        to: addr,
        data,
      })

      // Collect revenue
      // Expected values based on Prices between AAVE and RSR/RToken = 1 to 1 (for simplification)
      const sellAmt: BigNumber = rewardAmountAAVE.mul(60).div(100) // due to f = 60%
      const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

      const sellAmtRToken: BigNumber = rewardAmountAAVE.sub(sellAmt) // Remainder
      const minBuyAmtRToken: BigNumber = await toMinBuyAmt(sellAmtRToken, fp('1'), fp('1'))

      // Via Facade get next call - will transfer RToken to Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in Backing Manager
      await owner.sendTransaction({
        to: addr,
        data,
      })

      // Next call would start Revenue auction - RTokenTrader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rTokenTrader.address)
      expect(data).to.not.equal('0x')

      const response = await facadeMonitor.callStatic.getTradesForRevenueTraders(rToken.address)

      expect(
        response.rTokenTraderResponse.tradesToBeStarted.filter(
          (e) => e != ethers.constants.AddressZero
        ).length > 0
      ).to.be.true
      expect(
        response.rsrTraderResponse.tradesToBeStarted.filter(
          (e) => e != ethers.constants.AddressZero
        ).length > 0
      ).to.be.true

      // Manage tokens in RTokenTrader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rTokenTrader, 'TradeStarted')
        .withArgs(
          anyValue,
          aaveToken.address,
          rToken.address,
          sellAmtRToken,
          withinQuad(minBuyAmtRToken)
        )

      // Via Facade get next call - will open RSR trade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rsrTrader.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in RSRTrader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rsrTrader, 'TradeStarted')
        .withArgs(anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt)

      // Check funds in Market
      expect(await aaveToken.balanceOf(gnosis.address)).to.equal(rewardAmountAAVE)

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // Mock auction by minting the buy tokens (in this case RSR and RToken)
      await rsr.connect(addr1).approve(gnosis.address, minBuyAmt)
      await rToken.connect(addr1).approve(gnosis.address, minBuyAmtRToken)
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmtRToken,
        buyAmount: minBuyAmtRToken,
      })
      await gnosis.placeBid(1, {
        bidder: addr1.address,
        sellAmount: sellAmt,
        buyAmount: minBuyAmt,
      })

      const response2 = await facadeMonitor.callStatic.getTradesForRevenueTraders(rToken.address)

      expect(
        response2.rTokenTraderResponse.tradesToBeSettled.filter(
          (e) => e != ethers.constants.AddressZero
        ).length > 0
      ).to.be.true
      expect(
        response2.rsrTraderResponse.tradesToBeSettled.filter(
          (e) => e != ethers.constants.AddressZero
        ).length > 0
      ).to.be.true

      // Settle RToken trades via Facade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rTokenTrader.address)
      expect(data).to.not.equal('0x')

      // Close auction in RToken Trader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rTokenTrader, 'TradeSettled')
        .withArgs(anyValue, aaveToken.address, rToken.address, sellAmtRToken, minBuyAmtRToken)

      // Now settle trade in RSR Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rsrTrader.address)
      expect(data).to.not.equal('0x')

      // Close auction in RSR Trader
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rsrTrader, 'TradeSettled')
        .withArgs(anyValue, aaveToken.address, rsr.address, sellAmt, minBuyAmt)

      const response3 = await facadeMonitor.callStatic.getTradesForRevenueTraders(rToken.address)

      expect(
        response3.rTokenTraderResponse.tradesToBeSettled.filter(
          (e) => e != ethers.constants.AddressZero
        ).length == 0
      ).to.be.true
      expect(
        response3.rsrTraderResponse.tradesToBeSettled.filter(
          (e) => e != ethers.constants.AddressZero
        ).length == 0
      ).to.be.true

      // Check no new calls to make from Facade
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(ZERO_ADDRESS)
      expect(data).to.equal('0x')

      // distribute Revenue from RToken trader
      await rTokenTrader.manageToken(rToken.address)

      // Claim additional Revenue but only send to RSR (to trigger RSR trader directly)
      // Set f = 1
      await distributor
        .connect(owner)
        .setDistribution(FURNACE_DEST, { rTokenDist: bn(0), rsrDist: bn(0) })

      // Avoid dropping 20 qCOMP by making there be exactly 1 distribution share.
      await distributor
        .connect(owner)
        .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: bn(1) })

      // Set new rewards
      await aToken.setRewards(backingManager.address, rewardAmountAAVE)

      // Claim new rewards
      await backingManager.claimRewards()

      // Via Facade get next call - will transfer RSR to Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(backingManager.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in Backing Manager
      await owner.sendTransaction({
        to: addr,
        data,
      })

      // Next call would start Revenue auction - RSR Trader
      ;[addr, data] = await facadeAct.callStatic.getActCalldata(rToken.address)
      expect(addr).to.equal(rsrTrader.address)
      expect(data).to.not.equal('0x')

      // Manage tokens in RTokenTrader
      const minBuyAmtAAVE = await toMinBuyAmt(rewardAmountAAVE, fp('1'), fp('1'))
      await expect(
        owner.sendTransaction({
          to: addr,
          data,
        })
      )
        .to.emit(rsrTrader, 'TradeStarted')
        .withArgs(
          anyValue,
          aaveToken.address,
          rsr.address,
          rewardAmountAAVE,
          withinQuad(minBuyAmtAAVE)
        )
    })
  })
})

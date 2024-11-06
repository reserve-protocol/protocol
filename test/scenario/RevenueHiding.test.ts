import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { bn, fp, divCeil } from '../../common/numbers'
import { IConfig } from '../../common/configuration'
import { CollateralStatus, TradeKind } from '../../common/constants'
import {
  CTokenMock,
  CTokenFiatCollateral,
  ERC20Mock,
  IAssetRegistry,
  SelfReferentialCollateral,
  TestIBackingManager,
  TestIBasketHandler,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
} from '../../typechain'
import { advanceTime } from '../utils/time'
import { getTrade } from '../utils/trades'
import {
  Collateral,
  defaultFixtureNoBasket,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
const REVENUE_HIDING = fp('1e-6') // 1 part in a million

describe(`RevenueHiding basket collateral (/w CTokenFiatCollateral) - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Tokens and Assets
  let dai: ERC20Mock
  let daiCollateral: SelfReferentialCollateral
  let cDAI: CTokenMock
  let cDAICollateral: CTokenFiatCollateral

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  let initialBal: BigNumber

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

    const lowSellPrice = sellPrice.sub(sellPrice.mul(ORACLE_ERROR).div(fp('1')))
    const highBuyPrice = buyPrice.add(buyPrice.mul(ORACLE_ERROR).div(fp('1')))
    const product = sellAmt
      .mul(fp('1').sub(await rTokenTrader.maxTradeSlippage())) // (a)
      .mul(lowSellPrice) // (b)

    return divCeil(divCeil(product, highBuyPrice), fp('1')) // (c)
  }

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    let erc20s: ERC20Mock[]

      // Deploy fixture
    ;({
      rsr,
      stRSR,
      erc20s,
      collateral,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixtureNoBasket))

    // Main ERC20
    dai = <ERC20Mock>erc20s[0]
    daiCollateral = collateral[0]
    cDAI = <CTokenMock>erc20s[4]
    cDAICollateral = await (
      await ethers.getContractFactory('CTokenFiatCollateral')
    ).deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: await collateral[0].chainlinkFeed(),
        oracleError: ORACLE_ERROR,
        erc20: cDAI.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: DELAY_UNTIL_DEFAULT,
      },
      REVENUE_HIDING
    )

    // Basket configuration
    await assetRegistry.connect(owner).register(daiCollateral.address)
    await assetRegistry.connect(owner).swapRegistered(cDAICollateral.address)
    await basketHandler.setPrimeBasket([cDAI.address, dai.address], [fp('1'), fp('1')])
    await basketHandler
      .connect(owner)
      .setBackupConfig(await ethers.utils.formatBytes32String('USD'), 1, [dai.address])
    await basketHandler.refreshBasket()

    // Advance time post warmup period - SOUND just regained
    await advanceTime(Number(config.warmupPeriod) + 1)

    await backingManager.grantRTokenAllowance(cDAI.address)
    await backingManager.grantRTokenAllowance(dai.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await dai.connect(owner).mint(addr1.address, initialBal)
    await dai.connect(owner).mint(addr2.address, initialBal)
    await cDAI.connect(owner).mint(addr1.address, initialBal)
    await cDAI.connect(owner).mint(addr2.address, initialBal)

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  describe('Scenarios', function () {
    let issueAmt: BigNumber
    let cTokenAmt: BigNumber
    let initialExchangeRate: BigNumber
    let initialRefPerTok: BigNumber
    let initialQuantity: BigNumber

    beforeEach(async () => {
      // Should hide REVENUE_HIDING of the exchange rate
      initialExchangeRate = await cDAI.exchangeRateStored()
      initialRefPerTok = await cDAICollateral.refPerTok()

      const expectedRefPerTok = initialExchangeRate.mul(fp('1').sub(REVENUE_HIDING)).div(fp('1'))
      expect(initialRefPerTok).to.equal(expectedRefPerTok.div(bn('1e10')))

      // Issue
      issueAmt = initialBal.div(100)
      await cDAI.connect(addr1).approve(rToken.address, issueAmt)
      await dai.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await rToken.totalSupply()).to.equal(issueAmt)
      cTokenAmt = await cDAI.balanceOf(backingManager.address)
      expect(cTokenAmt).to.be.gt(issueAmt.mul(50).div(bn('1e10')))
    })

    it('should appreciate and redeem', async () => {
      // A 10% increase should result in a 10% decrease in basket quantity
      initialQuantity = await basketHandler.quantity(cDAI.address)
      await cDAI.setExchangeRate(fp('1.1')) // 10% increase
      await cDAICollateral.refresh()
      const q2 = await basketHandler.quantity(cDAI.address)
      expect(q2).to.equal(initialQuantity.mul(10).div(11)) // 10% decrease

      // Redeem half
      const balBefore = await cDAI.balanceOf(addr1.address)
      const redeemAmt = issueAmt.div(2)
      await rToken.connect(addr1).redeem(redeemAmt)
      const balAfter = await cDAI.balanceOf(addr1.address)
      const cTokenRedeemAmt = q2.mul(redeemAmt.div(bn('1e10'))).div(fp('1'))
      expect(balAfter).to.equal(balBefore.add(cTokenRedeemAmt))
    })

    it('should detect default after fall more than revenue hiding but not before', async () => {
      // Fall equal to REVENUE_HIDING percentage should not default
      await cDAI.setExchangeRate(fp('1').sub(REVENUE_HIDING))
      await cDAICollateral.refresh()
      expect(await cDAICollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.quantity(cDAI.address)).to.equal(initialQuantity)

      // Increase halfway back to initial rate shouldn't matter
      await cDAI.setExchangeRate(fp('1').sub(REVENUE_HIDING.div(2)))
      await cDAICollateral.refresh()
      expect(await cDAICollateral.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.quantity(cDAI.address)).to.equal(initialQuantity)

      // But 1 more atto than REVENUE_HIDING should be enough to default
      await cDAI.setExchangeRate(fp('1').sub(REVENUE_HIDING.add(1)))
      await cDAICollateral.refresh()
      expect(await cDAICollateral.status()).to.equal(CollateralStatus.DISABLED)
      // Basket quantity should have continued to grow
      expect(await basketHandler.quantity(cDAI.address)).to.be.gt(initialQuantity)

      // Should switch to DAI at targetPerRefs of 1
      await basketHandler.refreshBasket()
      expect(await basketHandler.quantity(dai.address)).to.equal(fp('2'))
      expect(await basketHandler.quantity(cDAI.address)).to.equal(fp('0'))
    })

    it('prices should be correct', async () => {
      const [low, high] = await cDAICollateral.price()
      let mid = fp('1').div(50)
      expect(low).to.equal(mid.sub(mid.mul(ORACLE_ERROR).div(fp('1'))))
      expect(high).to.equal(mid.add(mid.mul(ORACLE_ERROR).div(fp('1'))))

      // BasketHandler BU price - should overprice at the high end
      const [lowBaskets, highBaskets] = await basketHandler.price(false)
      mid = fp('2') // because DAI collateral
      const delta = mid.mul(ORACLE_ERROR).div(fp('1'))

      // We expect both lowBaskets + highBaskets to be above their exact values by 1 part in a million
      // due to BasketHandler.quantity() rounding up with a CEIL
      expect(lowBaskets).to.be.gt(mid.sub(delta))
      expect(lowBaskets).to.be.closeTo(mid.sub(delta), mid.sub(delta).div(bn('1e6')))
      expect(highBaskets).to.be.gt(mid.add(delta)) // should be above expected
      expect(highBaskets).to.be.closeTo(mid.add(delta), mid.add(delta).div(bn('1e6')))

      // Same goes for RToken price
      const [lowRToken, highRToken] = await basketHandler.price(false)
      expect(lowRToken).to.be.gt(mid.sub(delta))
      expect(lowRToken).to.be.closeTo(mid.sub(delta), mid.sub(delta).div(bn('1e6')))
      expect(highRToken).to.be.gt(mid.add(delta)) // should be above expected
      expect(highRToken).to.be.closeTo(mid.add(delta), mid.add(delta).div(bn('1e6')))
    })

    it('auction should be launched at low price ignoring revenueHiding', async () => {
      // Double exchange rate and launch auctions
      await cDAI.setExchangeRate(fp('2')) // double rate
      await backingManager.forwardRevenue([cDAI.address]) // transfers tokens to Traders
      await expect(rTokenTrader.manageTokens([cDAI.address], [TradeKind.BATCH_AUCTION])).to.emit(
        rTokenTrader,
        'TradeStarted'
      )
      await expect(rsrTrader.manageTokens([cDAI.address], [TradeKind.BATCH_AUCTION])).to.emit(
        rsrTrader,
        'TradeStarted'
      )

      // Auctions launched should be at discounted low price
      const t = await getTrade(rsrTrader, cDAI.address)
      const sellAmt = await t.initBal()
      const minBuyAmt = await toMinBuyAmt(sellAmt, fp('2').div(50), fp('1'))
      const expectedPrice = minBuyAmt.mul(fp('1')).div(sellAmt).mul(bn('1e10')).mul(bn('1e9')) // shift 10 decimals for cDAI; D27 precision
      // price should be within 1 part in a 1 trillion of our discounted rate
      expect(await t.worstCasePrice()).to.be.closeTo(expectedPrice, expectedPrice.div(bn('1e9')))
    })
  })
})

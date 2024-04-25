import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { TradeKind } from '../../common/constants'
import { bn, divCeil, fp } from '../../common/numbers'
import {
  BadERC20,
  ERC20Mock,
  IAssetRegistry,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIBasketHandler,
  TestIFurnace,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
} from '../../typechain'
import { setOraclePrice } from '../utils/oracles'
import { getTrade } from '../utils/trades'
import { advanceTime } from '../utils/time'
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

describe(`Bad ERC20 - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: BadERC20
  let backupToken: ERC20Mock
  let collateral0: Collateral
  let backupCollateral: Collateral
  let rTokenAsset: RTokenAsset

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let furnace: TestIFurnace
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let rTokenTrader: TestIRevenueTrader
  let rsrTrader: TestIRevenueTrader
  let basketHandler: TestIBasketHandler

  // Computes the minBuyAmt for a sellAmt at two prices
  // sellPrice + buyPrice should not be the low and high estimates, but rather the oracle prices
  const toMinBuyAmt = (
    sellAmt: BigNumber,
    sellPrice: BigNumber,
    buyPrice: BigNumber,
    oracleError: BigNumber,
    maxTradeSlippage: BigNumber
  ): BigNumber => {
    // do all muls first so we don't round unnecessarily
    // a = loss due to max trade slippage
    // b = loss due to selling token at the low price
    // c = loss due to buying token at the high price
    // mirrors the math from TradeLib ~L:57

    const lowSellPrice = sellPrice.sub(sellPrice.mul(oracleError).div(fp('1')))
    const highBuyPrice = buyPrice.add(buyPrice.mul(oracleError).div(fp('1')))
    const product = sellAmt
      .mul(fp('1').sub(maxTradeSlippage)) // (a)
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
      furnace,
      assetRegistry,
      backingManager,
      basketHandler,
      rTokenTrader,
      rsrTrader,
      rTokenAsset,
    } = await loadFixture(defaultFixtureNoBasket))

    // Main ERC20
    token0 = await (await ethers.getContractFactory('BadERC20')).deploy('Bad ERC20', 'BERC20')
    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    collateral0 = await (
      await ethers.getContractFactory('FiatCollateral')
    ).deploy({
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: chainlinkFeed.address,
      oracleError: ORACLE_ERROR,
      erc20: token0.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD,
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
    })

    // Backup
    backupToken = erc20s[2] // USDT
    backupCollateral = <Collateral>collateral[2]

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(backupCollateral.address)
    await basketHandler.setPrimeBasket([token0.address], [fp('1')])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('USD'), 1, [
      token0.address,
      backupToken.address,
    ])
    await basketHandler.refreshBasket()
    await advanceTime(config.warmupPeriod.toNumber() + 1)
    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(backupToken.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await backupToken.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await backupToken.connect(owner).mint(addr2.address, initialBal)

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  // This test is mostly to check that our BadERC20 implementation works like a regular ERC20
  it('should act honestly without modification', async () => {
    const issueAmt = initialBal.div(100)
    await token0.connect(addr1).approve(rToken.address, issueAmt)
    await rToken.connect(addr1).issue(issueAmt)
    await rToken.connect(addr1).transfer(addr2.address, issueAmt)
    expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmt)
    await token0.connect(addr2).approve(rToken.address, issueAmt)
    await rToken.connect(addr2).issue(issueAmt)
    expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmt.mul(2))
    expect(await rToken.decimals()).to.equal(18)
  })

  describe('with reverting decimals', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      await token0.setRevertDecimals(true)
    })

    it('should revert during atomic issuance', async () => {
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.revertedWith('No Decimals')

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should revert during slow issuance', async () => {
      issueAmt = initialBal.div(10)
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.revertedWith('No Decimals')

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should revert during redemption', async () => {
      await expect(rToken.connect(addr1).redeem(issueAmt)).to.be.revertedWith('No Decimals')

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr1).redeem(issueAmt)
    })

    it('should revert during trading', async () => {
      await setOraclePrice(collateral0.address, bn('1e7')) // default
      await assetRegistry.refresh()
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [backupToken.address], [fp('1')], false)
      await advanceTime(config.warmupPeriod.toNumber() + 1)
      await expect(backingManager.forwardRevenue([])).to.be.reverted // can't catch No Decimals
      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.reverted // can't catch No Decimals
    })

    it('should keep collateral working', async () => {
      await collateral0.refresh()
      await collateral0.price()
      await collateral0.targetPerRef()
      expect(await collateral0.status()).to.equal(0)
    })

    it('should still transfer', async () => {
      await rToken.connect(addr1).transfer(addr2.address, issueAmt)
    })

    it('should still approve / transferFrom', async () => {
      await rToken.connect(addr1).approve(addr2.address, issueAmt)
      await rToken.connect(addr2).transferFrom(addr1.address, addr2.address, issueAmt)
    })

    it('should still be able to claim rewards', async () => {
      await backingManager.connect(addr1).claimRewards()
    })

    it('should still melt', async () => {
      await rToken.connect(addr1).transfer(furnace.address, issueAmt)
      await furnace.melt()
    })

    it('should be able to unregister and use RSR to recollateralize', async () => {
      await assetRegistry.connect(owner).unregister(collateral0.address)
      expect(await assetRegistry.isRegistered(collateral0.address)).to.equal(false)
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [backupToken.address], [fp('1')], false)

      // Advance time post warmup period - SOUND just regained
      await advanceTime(Number(config.warmupPeriod) + 1)

      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.emit(
        backingManager,
        'TradeStarted'
      )

      // Should be trading RSR for backup token
      const trade = await getTrade(backingManager, rsr.address)
      expect(await trade.status()).to.equal(1) // OPEN state
      expect(await trade.sell()).to.equal(rsr.address)
      expect(await trade.buy()).to.equal(backupToken.address)
    })
  })

  describe('with censorship', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      await token0.setCensored(backingManager.address, true)
      await token0.setCensored(rToken.address, true)
    })

    it('should revert on issuance', async () => {
      // Will revert even on approval
      await expect(token0.connect(addr2).approve(rToken.address, issueAmt)).to.be.revertedWith(
        'censored'
      )

      // Allow approval temporarily
      await token0.setCensored(rToken.address, false)
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await token0.setCensored(rToken.address, true)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.revertedWith('censored')

      // Should work now
      await token0.setCensored(backingManager.address, false)
      await token0.setCensored(rToken.address, false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should revert during redemption', async () => {
      await expect(rToken.connect(addr1).redeem(issueAmt)).to.be.revertedWith('censored')

      // Should work now
      await token0.setCensored(backingManager.address, false)
      await token0.setCensored(rToken.address, false)
      await rToken.connect(addr1).redeem(issueAmt)
    })

    it('should revert during trading', async () => {
      await setOraclePrice(collateral0.address, bn('1e7')) // default
      await collateral0.refresh()
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [backupToken.address], [fp('1')], false)

      // Advance time post warmup period - SOUND just regained
      await advanceTime(Number(config.warmupPeriod) + 1)

      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith('censored')

      // Should work now
      await token0.setCensored(backingManager.address, false)
      await backingManager.rebalance(TradeKind.BATCH_AUCTION)
    })

    it('should keep collateral working', async () => {
      await collateral0.refresh()
      await collateral0.price()
      await collateral0.targetPerRef()
      expect(await collateral0.status()).to.equal(0)
    })

    it('should still transfer', async () => {
      await rToken.connect(addr1).transfer(addr2.address, issueAmt)
    })

    it('should still approve / transferFrom', async () => {
      await rToken.connect(addr1).approve(addr2.address, issueAmt)
      await rToken.connect(addr2).transferFrom(addr1.address, addr2.address, issueAmt)
    })

    it('should still be able to claim rewards', async () => {
      await backingManager.connect(addr1).claimRewards()
    })

    it('should still have price', async () => {
      await rTokenAsset.price()
    })

    it('should still melt', async () => {
      await rToken.connect(addr1).transfer(furnace.address, issueAmt)
      await furnace.melt()
    })

    it('should be able to unregister and use RSR to recollateralize', async () => {
      await assetRegistry.connect(owner).unregister(collateral0.address)
      expect(await assetRegistry.isRegistered(collateral0.address)).to.equal(false)
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [backupToken.address], [fp('1')], false)

      // Advance time post warmup period - SOUND just regained
      await advanceTime(Number(config.warmupPeriod) + 1)

      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.emit(
        backingManager,
        'TradeStarted'
      )

      // Should be trading RSR for backup token
      const trade = await getTrade(backingManager, rsr.address)
      expect(await trade.status()).to.equal(1) // OPEN state
      expect(await trade.sell()).to.equal(rsr.address)
      expect(await trade.buy()).to.equal(backupToken.address)
    })

    it('should be able to process any uncensored assets already accumulated at RevenueTraders', async () => {
      await rToken.connect(addr1).transfer(rTokenTrader.address, issueAmt.div(2))
      await rToken.connect(addr1).transfer(rsrTrader.address, issueAmt.div(2))
      await expect(rTokenTrader.manageTokens([rToken.address], [TradeKind.BATCH_AUCTION]))
        .to.emit(rToken, 'Transfer')
        .withArgs(rTokenTrader.address, furnace.address, issueAmt.div(2))
      await expect(rsrTrader.manageTokens([rToken.address], [TradeKind.BATCH_AUCTION]))
        .to.emit(rsrTrader, 'TradeStarted')
        .withArgs(anyValue, rToken.address, rsr.address, issueAmt.div(2), anyValue)
    })
  })

  describe('with fussy approvals', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await token0.setRevertApprove(true)
      await rToken.connect(addr1).issue(issueAmt)
    })

    context('Regression tests wcUSDCv3 10/10/2023', () => {
      it('should not revert during recollateralization', async () => {
        await basketHandler.setPrimeBasket(
          [token0.address, backupToken.address],
          [fp('0.5'), fp('0.5')]
        )
        await basketHandler.refreshBasket()

        // Should launch recollateralization auction successfully
        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(anyValue, token0.address, backupToken.address, anyValue, anyValue)
      })

      it('should not revert during revenue auction', async () => {
        await token0.mint(rsrTrader.address, issueAmt)

        // Should launch revenue auction successfully
        await expect(rsrTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION]))
          .to.emit(rsrTrader, 'TradeStarted')
          .withArgs(anyValue, token0.address, rsr.address, anyValue, anyValue)
      })
    })
  })
})

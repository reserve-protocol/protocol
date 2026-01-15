import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { expectEvents } from '../../common/events'
import { CollateralStatus, TradeKind } from '../../common/constants'
import { bn, fp, divCeil } from '../../common/numbers'
import {
  BadCollateralPlugin,
  ERC20Mock,
  IAssetRegistry,
  MockV3Aggregator,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIBasketHandler,
  TestIStRSR,
  TestIRToken,
} from '../../typechain'
import { expectRTokenPrice, setOraclePrice } from '../utils/oracles'
import { advanceTime } from '../utils/time'
import { getTrade } from '../utils/trades'
import {
  Collateral,
  defaultFixtureNoBasket,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

describe(`Bad Collateral Plugin - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]
  let rTokenAsset: RTokenAsset

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: StaticATokenMock
  let backupToken: ERC20Mock
  let collateral0: BadCollateralPlugin
  let backupCollateral: Collateral
  let aaveToken: ERC20Mock

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler

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
      aaveToken,
      rTokenAsset,
    } = await loadFixture(defaultFixtureNoBasket))

    // Token0
    const nonStaticERC20 = await (
      await ethers.getContractFactory('ERC20Mock')
    ).deploy('ERC20', 'ERC20')
    token0 = await (
      await ethers.getContractFactory('StaticATokenMock')
    ).deploy('AToken ERC20', 'AERC20', nonStaticERC20.address)
    await token0.setAaveToken(aaveToken.address)

    // Collateral0
    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    collateral0 = await (
      await ethers.getContractFactory('BadCollateralPlugin')
    ).deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: chainlinkFeed.address,
        oracleError: ORACLE_ERROR,
        erc20: token0.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: DELAY_UNTIL_DEFAULT,
      },
      REVENUE_HIDING
    )

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
    await advanceTime(Number(config.warmupPeriod) + 1)
    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(backupToken.address)

    // Mint initial balances in one blockm
    initialBal = bn('10000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await backupToken.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await backupToken.connect(owner).mint(addr2.address, initialBal)

    // Mint RToken
    await token0.connect(addr1).approve(rToken.address, initialBal)
    await rToken.connect(addr1).issue(initialBal)
    expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal)

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  describe('without default detection for defi invariants', function () {
    beforeEach(async () => {
      await collateral0.setHardDefaultCheck(false)
      await token0.setExchangeRate(fp('0.9'))
      await collateral0.refresh()

      // Status should remain SOUND even in the face of a falling exchange rate
      expect(await collateral0.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
    })

    it('should keep a constant redemption basket as collateral loses value', async () => {
      // Redemption should be restrained to be prorata
      expect(await token0.balanceOf(addr1.address)).to.equal(0)
      await rToken
        .connect(addr1)
        .redeemCustom(
          addr1.address,
          initialBal.div(2),
          [await basketHandler.nonce()],
          [fp('1')],
          [],
          []
        )
      expect(await rToken.totalSupply()).to.equal(initialBal.div(2))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.div(2))
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
    })

    it('should increase the issuance basket as collateral loses value', async () => {
      // Should be able to redeem half the RToken at-par
      await rToken
        .connect(addr1)
        .redeemCustom(
          addr1.address,
          initialBal.div(2),
          [await basketHandler.nonce()],
          [fp('1')],
          [],
          []
        )
      expect(await rToken.totalSupply()).to.equal(initialBal.div(2))
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.div(2))

      // Should not be able to re-issue at the same quantities
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.div(2))
      await token0.connect(addr1).approve(rToken.address, initialBal.div(2))
      await expect(rToken.connect(addr1).issue(initialBal.div(2))).to.be.reverted

      // Should be able to issue at larger quantities
      await rToken.connect(addr1).issue(initialBal.div(4))
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.mul(3).div(4))
      expect(await token0.balanceOf(addr1.address)).to.be.lt(initialBal.div(4))
      expect(await token0.balanceOf(addr1.address)).to.be.gt(initialBal.div(6))
    })

    it('should use RSR to recollateralize, breaking the economic model fundamentally', async () => {
      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.emit(
        backingManager,
        'TradeStarted'
      )
      const trade = await getTrade(backingManager, rsr.address)
      expect(await trade.sell()).to.equal(rsr.address)
      expect(await trade.buy()).to.equal(token0.address)
      expect(await trade.initBal()).to.be.gt(initialBal.div(10))

      const unslippedPrice = fp('1.1')
      const lowSellPrice = fp('1').sub(fp('1').mul(ORACLE_ERROR).div(fp('1')))
      const highBuyPrice = fp('1').add(fp('1').mul(ORACLE_ERROR).div(fp('1')))
      const worstCasePrice = divCeil(unslippedPrice.mul(bn('1e9')).mul(lowSellPrice), highBuyPrice) // D27
      expect(await trade.worstCasePrice()).to.be.closeTo(worstCasePrice, bn('1e9'))
    })
  })

  describe('without default detection for the peg', function () {
    beforeEach(async () => {
      await collateral0.setSoftDefaultCheck(false)
    })

    it('should not change the redemption basket', async () => {
      // Should be able to redeem half the RToken at-par
      await rToken
        .connect(addr1)
        .redeemCustom(
          addr1.address,
          initialBal.div(2),
          [await basketHandler.nonce()],
          [fp('1')],
          [],
          []
        )
      expect(await rToken.totalSupply()).to.equal(initialBal.div(2))
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.div(2))

      // RToken price should follow depegging
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('1'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )
      await setOraclePrice(collateral0.address, bn('2e8')) // 100% increase, would normally trigger soft default
      await expectRTokenPrice(
        rTokenAsset.address,
        fp('2'),
        ORACLE_ERROR,
        await backingManager.maxTradeSlippage(),
        config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
      )

      // Should remain SOUND because missing soft default checks
      expect(await collateral0.status()).to.equal(CollateralStatus.SOUND)
      await collateral0.refresh()
      expect(await collateral0.status()).to.equal(CollateralStatus.SOUND)

      // RToken redemption should ignore depegging
      await rToken.connect(addr1).redeem(initialBal.div(4))
      expect(await rToken.totalSupply()).to.equal(initialBal.div(4))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.mul(3).div(4))
    })

    it('should not change the issuance basket', async () => {
      // Should be able to redeem half the RToken at-par
      await rToken.connect(addr1).redeem(initialBal.div(2))
      expect(await rToken.totalSupply()).to.equal(initialBal.div(2))
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.div(2))

      await setOraclePrice(collateral0.address, bn('0.5e8')) // 50% decrease, would normally trigger soft default

      // Should be able to re-issue the same amount of RToken, despite depeg
      await token0.connect(addr1).approve(rToken.address, initialBal.div(2))
      await rToken.connect(addr1).issue(initialBal.div(2))
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal)
    })

    it('should not be undercollateralized from its perspective', async () => {
      await setOraclePrice(collateral0.address, bn('0.5e8')) // 50% decrease, would normally trigger soft default
      await assetRegistry.refresh()
      expect(await collateral0.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)

      // Should not launch auctions or create revenue
      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
        'already collateralized'
      )
      await expectEvents(backingManager.forwardRevenue([token0.address]), [
        {
          contract: token0,
          name: 'Transfer',
          emitted: false,
        },
        {
          contract: rsr,
          name: 'Transfer',
          emitted: false,
        },
        {
          contract: rToken,
          name: 'Transfer',
          emitted: false,
        },
      ])
    })
  })
})

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { expectEvents } from '../../common/events'
import { CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  BadCollateralPlugin,
  ERC20Mock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIStRSR,
  TestIRToken,
} from '../../typechain'
import { setOraclePrice } from '../utils/oracles'
import { getTrade } from '../utils/trades'
import { Collateral, defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

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
  let basketHandler: IBasketHandler
  let oracleLib: OracleLib

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

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
      oracleLib,
      aaveToken,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

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
      await ethers.getContractFactory('BadCollateralPlugin', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      fp('1'),
      chainlinkFeed.address,
      token0.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT
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
      await rToken.connect(addr1).redeem(initialBal.div(2))
      expect(await rToken.totalSupply()).to.equal(initialBal.div(2))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.div(2))
      expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1'), bn('1'))
    })

    it('should increase the issuance basket as collateral loses value', async () => {
      // Should be able to redeem half the RToken at-par
      await rToken.connect(addr1).redeem(initialBal.div(2))
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
      await expect(backingManager.manageTokens([])).to.emit(backingManager, 'TradeStarted')
      const trade = await getTrade(backingManager, rsr.address)
      expect(await trade.sell()).to.equal(rsr.address)
      expect(await trade.buy()).to.equal(token0.address)
      expect(await trade.initBal()).to.be.gt(initialBal.div(10))
      expect(await trade.worstCasePrice()).to.equal(fp('1.1').sub(1))
    })
  })

  describe('without default detection for the peg', function () {
    beforeEach(async () => {
      await collateral0.setSoftDefaultCheck(false)
    })

    it('should not change the redemption basket', async () => {
      // Should be able to redeem half the RToken at-par
      await rToken.connect(addr1).redeem(initialBal.div(2))
      expect(await rToken.totalSupply()).to.equal(initialBal.div(2))
      expect(await rToken.balanceOf(addr1.address)).to.equal(initialBal.div(2))

      // RToken price should follow depegging
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
      await setOraclePrice(collateral0.address, bn('2e8')) // 100% increase, would normally trigger soft default
      expect(await rTokenAsset.strictPrice()).to.equal(fp('2'))

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

    it('should not be undercapitalized from its perspective', async () => {
      await setOraclePrice(collateral0.address, bn('0.5e8')) // 50% decrease, would normally trigger soft default
      await assetRegistry.refresh()
      expect(await collateral0.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)

      // Should not launch auctions or create revenue
      await expectEvents(backingManager.manageTokens([token0.address]), [
        {
          contract: backingManager,
          name: 'TradeStarted',
          emitted: false,
        },
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

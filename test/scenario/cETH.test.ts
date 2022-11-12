import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import { IConfig } from '../../common/configuration'
import { CollateralStatus } from '../../common/constants'
import {
  CTokenMock,
  CTokenSelfReferentialCollateral,
  ComptrollerMock,
  ERC20Mock,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  SelfReferentialCollateral,
  TestIBackingManager,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
  WETH9,
} from '../../typechain'
import { getTrade } from '../utils/trades'
import { setOraclePrice } from '../utils/oracles'
import { Collateral, defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'

const createFixtureLoader = waffle.createFixtureLoader

const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

describe(`CToken of self-referential collateral (eg cETH) - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let compoundMock: ComptrollerMock

  // Tokens and Assets
  let weth: WETH9
  let wethCollateral: SelfReferentialCollateral
  let cETH: CTokenMock
  let cETHCollateral: CTokenSelfReferentialCollateral
  let token0: CTokenMock
  let collateral0: Collateral
  let backupToken: ERC20Mock
  let backupCollateral: Collateral

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let oracleLib: OracleLib

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let initialBal: BigNumber

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
      compoundMock,
      erc20s,
      collateral,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      rsrTrader,
      rTokenTrader,
      oracleLib,
    } = await loadFixture(defaultFixture))

    // Main ERC20
    token0 = <CTokenMock>erc20s[4] // cDai
    collateral0 = collateral[4]

    // WETH
    weth = await (await ethers.getContractFactory('WETH9')).deploy()
    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    wethCollateral = await (
      await ethers.getContractFactory('SelfReferentialCollateral')
    ).deploy(
      fp('1'),
      chainlinkFeed.address,
      weth.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('ETH'),
      DELAY_UNTIL_DEFAULT
    )

    // cETH
    cETH = await (
      await ethers.getContractFactory('CTokenMock')
    ).deploy('cETH Token', 'cETH', weth.address)

    cETHCollateral = await (
      await ethers.getContractFactory('CTokenSelfReferentialCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      fp('1').div(50),
      chainlinkFeed.address,
      cETH.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('ETH'),
      DELAY_UNTIL_DEFAULT,
      await weth.decimals(),
      compoundMock.address
    )

    // Backup
    backupToken = erc20s[2] // USDT
    backupCollateral = <Collateral>collateral[2]

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(cETHCollateral.address)
    await assetRegistry.connect(owner).register(wethCollateral.address)
    await assetRegistry.connect(owner).register(backupCollateral.address)
    await basketHandler.setPrimeBasket([token0.address, cETH.address], [fp('1'), fp('0.001')])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('USD'), 1, [
      token0.address,
      backupToken.address,
    ])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('ETH'), 1, [
      cETH.address,
      weth.address,
    ])
    await basketHandler.refreshBasket()

    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(cETH.address)
    await backingManager.grantRTokenAllowance(weth.address)
    await backingManager.grantRTokenAllowance(backupToken.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await backupToken.connect(owner).mint(addr1.address, initialBal)
    await cETH.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await backupToken.connect(owner).mint(addr2.address, initialBal)
    await cETH.connect(owner).mint(addr2.address, initialBal)

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  describe('Scenarios', function () {
    let issueAmt: BigNumber
    let cTokenAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      cTokenAmt = issueAmt.mul(50).div(1e10) // cTokens are 50:1 with their underlying
      await token0.connect(addr1).approve(rToken.address, cTokenAmt)
      await cETH.connect(addr1).approve(rToken.address, cTokenAmt)
      await rToken.connect(addr1).issue(issueAmt)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await rToken.totalSupply()).to.equal(issueAmt)
      expect(await token0.balanceOf(backingManager.address)).to.equal(cTokenAmt)
      expect(await cETH.balanceOf(backingManager.address)).to.equal(cTokenAmt.div(1000))
    })

    it('should sell appreciating stable collateral and ignore cETH', async () => {
      await token0.setExchangeRate(fp('1.1')) // 10% appreciation
      await expect(backingManager.manageTokens([token0.address])).to.not.emit(
        backingManager,
        'TradeStarted'
      )
      expect(await cETH.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await cETH.balanceOf(rsrTrader.address)).to.equal(0)
      await expect(rTokenTrader.manageToken(cETH.address)).to.not.emit(rTokenTrader, 'TradeStarted')
      await expect(rTokenTrader.manageToken(token0.address)).to.emit(rTokenTrader, 'TradeStarted')

      // RTokenTrader should be selling token0 and buying RToken
      const trade = await getTrade(rTokenTrader, token0.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(rToken.address)

      await expect(rsrTrader.manageToken(cETH.address)).to.not.emit(rsrTrader, 'TradeStarted')
      await expect(rsrTrader.manageToken(token0.address)).to.emit(rsrTrader, 'TradeStarted')

      // RSRTrader should be selling token0 and buying RToken
      const trade2 = await getTrade(rsrTrader, token0.address)
      expect(await trade2.sell()).to.equal(token0.address)
      expect(await trade2.buy()).to.equal(rsr.address)
    })

    it('should change basket around cETH', async () => {
      await token0.setExchangeRate(fp('0.99')) // default
      await basketHandler.refreshBasket()
      await expect(backingManager.manageTokens([token0.address, cETH.address])).to.emit(
        backingManager,
        'TradeStarted'
      )

      // BackingManager shoiuld be selling token0 and buying backupToken
      const trade = await getTrade(backingManager, token0.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(backupToken.address)

      // No cETH should have moved
      expect(await cETH.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await cETH.balanceOf(rsrTrader.address)).to.equal(0)
    })

    it('should redeem after ETH price increase for same quantities', async () => {
      await setOraclePrice(wethCollateral.address, bn('2e8')) // doubling of price

      // Price change should not impact share of redemption tokens
      expect(await rToken.connect(addr1).redeem(issueAmt))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await cETH.balanceOf(addr1.address)).to.equal(initialBal)
    })

    it('should redeem for fewer cETH after redemption rate increase', async () => {
      await cETH.setExchangeRate(fp('2')) // doubling of price

      // Compound Redemption rate should result in fewer tokens
      expect(await rToken.connect(addr1).redeem(issueAmt))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await cETH.balanceOf(addr1.address)).to.equal(
        initialBal.sub(cTokenAmt.div(1000).div(2))
      )
    })

    it('should sell cETH for RToken after redemption rate increase', async () => {
      await cETH.setExchangeRate(fp('2')) // doubling of price
      await basketHandler.refreshBasket()
      await expect(backingManager.manageTokens([cETH.address])).to.not.emit(
        backingManager,
        'TradeStarted'
      )

      // RTokenTrader should be selling cETH and buying RToken
      await expect(rTokenTrader.manageToken(cETH.address)).to.emit(rTokenTrader, 'TradeStarted')
      const trade = await getTrade(rTokenTrader, cETH.address)
      expect(await trade.sell()).to.equal(cETH.address)
      expect(await trade.buy()).to.equal(rToken.address)
    })

    it('should not default when USD price falls', async () => {
      await setOraclePrice(wethCollateral.address, bn('0.5e8')) // doubling of price
      await assetRegistry.refresh()

      // Should be fully capitalized
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.basketsHeldBy(backingManager.address)).to.equal(issueAmt)
    })

    it('should be able to deregister', async () => {
      await assetRegistry.connect(owner).unregister(cETHCollateral.address)
      await basketHandler.refreshBasket()

      // Should be in an undercapitalized state but SOUND
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    })

    it('should fallback from cETH to WETH after fast default', async () => {
      await cETHCollateral.refresh()
      await cETH.setExchangeRate(fp('0.99'))
      await basketHandler.refreshBasket()

      // Should swap WETH in for cETH
      const [tokens] = await basketHandler.quote(fp('1'), 2)
      expect(tokens[0]).to.equal(token0.address)
      expect(tokens[1]).to.equal(weth.address)

      // Should not be fully capitalized
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.basketsHeldBy(backingManager.address)).to.equal(0)

      // Should view WETH as surplus
      await expect(backingManager.manageTokens([])).to.emit(backingManager, 'TradeStarted')

      // BackingManager should be selling cETH and buying WETH
      const trade = await getTrade(backingManager, cETH.address)
      expect(await trade.sell()).to.equal(cETH.address)
      expect(await trade.buy()).to.equal(weth.address)
    })
  })
})

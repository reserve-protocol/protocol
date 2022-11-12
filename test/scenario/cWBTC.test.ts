import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import { advanceTime } from '../utils/time'
import { IConfig } from '../../common/configuration'
import { CollateralStatus } from '../../common/constants'
import {
  CTokenMock,
  CTokenNonFiatCollateral,
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
} from '../../typechain'
import { getTrade } from '../utils/trades'
import { Collateral, defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

describe(`CToken of non-fiat collateral (eg cWBTC) - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let compoundMock: ComptrollerMock

  // Tokens and Assets
  let wbtc: ERC20Mock
  let wBTCCollateral: SelfReferentialCollateral
  let cWBTC: CTokenMock
  let cWBTCCollateral: CTokenNonFiatCollateral
  let token0: CTokenMock
  let collateral0: Collateral
  let backupToken: ERC20Mock
  let backupCollateral: Collateral

  // Config values
  let config: IConfig

  let referenceUnitOracle: MockV3Aggregator // {target/ref}
  let targetUnitOracle: MockV3Aggregator // {UoA/target}

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

    wbtc = await (await ethers.getContractFactory('ERC20Mock')).deploy('WBTC Token', 'WBTC')
    targetUnitOracle = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('20000e8')) // $20k
    )
    referenceUnitOracle = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8')) // 1 WBTC/BTC
    )
    wBTCCollateral = await (
      await ethers.getContractFactory('NonFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      fp('20000'),
      referenceUnitOracle.address,
      targetUnitOracle.address,
      wbtc.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('BTC'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT
    )

    // cWBTC
    cWBTC = await (
      await ethers.getContractFactory('CTokenMock')
    ).deploy('cWBTC Token', 'cWBTC', wbtc.address)
    cWBTCCollateral = await (
      await ethers.getContractFactory('CTokenNonFiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      fp('20000').div(50),
      referenceUnitOracle.address,
      targetUnitOracle.address,
      cWBTC.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('BTC'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT,
      await wbtc.decimals(),
      compoundMock.address
    )

    // Backup
    backupToken = erc20s[2] // USDT
    backupCollateral = <Collateral>collateral[2]

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(wBTCCollateral.address)
    await assetRegistry.connect(owner).register(cWBTCCollateral.address)
    await assetRegistry.connect(owner).register(backupCollateral.address)
    await basketHandler.setPrimeBasket([token0.address, cWBTC.address], [fp('1'), fp('0.001')])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('USD'), 1, [
      token0.address,
      backupToken.address,
    ])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('BTC'), 1, [
      cWBTC.address,
      wbtc.address,
    ])
    await basketHandler.refreshBasket()

    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(cWBTC.address)
    await backingManager.grantRTokenAllowance(wbtc.address)
    await backingManager.grantRTokenAllowance(backupToken.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await backupToken.connect(owner).mint(addr1.address, initialBal)
    await cWBTC.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await backupToken.connect(owner).mint(addr2.address, initialBal)
    await cWBTC.connect(owner).mint(addr2.address, initialBal)

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
      await cWBTC.connect(addr1).approve(rToken.address, cTokenAmt)
      await rToken.connect(addr1).issue(issueAmt)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await rToken.totalSupply()).to.equal(issueAmt)
      expect(await token0.balanceOf(backingManager.address)).to.equal(cTokenAmt)
      expect(await cWBTC.balanceOf(backingManager.address)).to.equal(cTokenAmt.div(1000))
    })

    it('should sell appreciating stable collateral and ignore cWBTC', async () => {
      await token0.setExchangeRate(fp('1.1')) // 10% appreciation
      await expect(backingManager.manageTokens([token0.address])).to.not.emit(
        backingManager,
        'TradeStarted'
      )
      expect(await cWBTC.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await cWBTC.balanceOf(rsrTrader.address)).to.equal(0)
      await expect(rTokenTrader.manageToken(cWBTC.address)).to.not.emit(
        rTokenTrader,
        'TradeStarted'
      )
      await expect(rTokenTrader.manageToken(token0.address)).to.emit(rTokenTrader, 'TradeStarted')

      // RTokenTrader should be selling token0 and buying RToken
      const trade = await getTrade(rTokenTrader, token0.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(rToken.address)

      await expect(rsrTrader.manageToken(cWBTC.address)).to.not.emit(rsrTrader, 'TradeStarted')
      await expect(rsrTrader.manageToken(token0.address)).to.emit(rsrTrader, 'TradeStarted')

      // RSRTrader should be selling token0 and buying RToken
      const trade2 = await getTrade(rsrTrader, token0.address)
      expect(await trade2.sell()).to.equal(token0.address)
      expect(await trade2.buy()).to.equal(rsr.address)
    })

    it('should change basket around cWBTC', async () => {
      await token0.setExchangeRate(fp('0.99')) // default
      await basketHandler.refreshBasket()
      await expect(backingManager.manageTokens([token0.address, cWBTC.address])).to.emit(
        backingManager,
        'TradeStarted'
      )

      // BackingManager shoiuld be selling token0 and buying backupToken
      const trade = await getTrade(backingManager, token0.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(backupToken.address)

      // No cWBTC should have moved
      expect(await cWBTC.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await cWBTC.balanceOf(rsrTrader.address)).to.equal(0)
    })

    it('should calculate price correctly', async () => {
      await referenceUnitOracle.updateAnswer(bn('0.95e8')) // 5% below peg
      await targetUnitOracle.updateAnswer(bn('100000e8')) // $100k
      await cWBTC.setExchangeRate(fp('1.5')) // 150% redemption rate
      // Recall cTokens are much inflated relative to underlying. Redemption rate starts at 0.02
      expect(await cWBTCCollateral.strictPrice()).to.equal(fp('95000').mul(3).div(2).div(50))
    })

    it('should redeem after BTC price increase for same quantities', async () => {
      // $40k, doubling
      await targetUnitOracle.updateAnswer(bn('10000e8'))

      // Price change should not impact share of redemption tokens
      expect(await rToken.connect(addr1).redeem(issueAmt))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await cWBTC.balanceOf(addr1.address)).to.equal(initialBal)
    })

    it('should redeem for fewer cWBTC after redemption rate increase', async () => {
      await cWBTC.setExchangeRate(fp('2')) // doubling of price

      // Compound Redemption rate should result in fewer tokens
      expect(await rToken.connect(addr1).redeem(issueAmt))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await cWBTC.balanceOf(addr1.address)).to.equal(
        initialBal.sub(cTokenAmt.div(1000).div(2))
      )
    })

    it('should sell cWBTC for RToken after redemption rate increase', async () => {
      await cWBTC.setExchangeRate(fp('2')) // doubling of price
      await basketHandler.refreshBasket()
      await expect(backingManager.manageTokens([cWBTC.address])).to.not.emit(
        backingManager,
        'TradeStarted'
      )

      // RTokenTrader should be selling cWBTC and buying RToken
      await expect(rTokenTrader.manageToken(cWBTC.address)).to.emit(rTokenTrader, 'TradeStarted')
      const trade = await getTrade(rTokenTrader, cWBTC.address)
      expect(await trade.sell()).to.equal(cWBTC.address)
      expect(await trade.buy()).to.equal(rToken.address)
    })

    it('should not default when USD price falls', async () => {
      // $10k, halving
      await targetUnitOracle.updateAnswer(bn('10000e8'))
      await assetRegistry.refresh()

      // Should be fully capitalized
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.basketsHeldBy(backingManager.address)).to.equal(issueAmt)
    })

    it('should be able to deregister', async () => {
      await assetRegistry.connect(owner).unregister(cWBTCCollateral.address)
      await basketHandler.refreshBasket()

      // Should be in an undercapitalized state but SOUND
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    })

    it('should fallback from cWBTC to WBTC after fast default', async () => {
      await assetRegistry.refresh()
      await cWBTC.setExchangeRate(fp('0.99'))
      await basketHandler.refreshBasket()

      // Should swap WBTC in for cWBTC
      const [tokens] = await basketHandler.quote(fp('1'), 2)
      expect(tokens[0]).to.equal(token0.address)
      expect(tokens[1]).to.equal(wbtc.address)

      // Should not be fully capitalized
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.basketsHeldBy(backingManager.address)).to.equal(0)

      // Should view cWBTC as surplus
      await expect(backingManager.manageTokens([])).to.emit(backingManager, 'TradeStarted')

      // BackingManager should be selling cWBTC and buying cWBTC
      const trade = await getTrade(backingManager, cWBTC.address)
      expect(await trade.sell()).to.equal(cWBTC.address)
      expect(await trade.buy()).to.equal(wbtc.address)
    })

    it('should enter basket disabled state after slow default', async () => {
      // Depeg WBTC from BTC
      await referenceUnitOracle.updateAnswer(bn('0.5e8'))
      await assetRegistry.refresh()
      expect(await cWBTCCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Advance time and complete default
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())
      await assetRegistry.refresh()
      expect(await cWBTCCollateral.status()).to.equal(CollateralStatus.DISABLED)

      await basketHandler.refreshBasket()

      // Should enter disabled state
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
    })
  })
})

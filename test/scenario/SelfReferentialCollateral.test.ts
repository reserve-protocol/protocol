import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import { CollateralStatus } from '../../common/constants'
import {
  CTokenMock,
  ComptrollerMock,
  CompoundSelfReferentialCollateral,
  CompoundOracleMock,
  ERC20Mock,
  IBasketHandler,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
  WETH9,
} from '../../typechain'
import { getTrade } from '../utils/trades'
import { Collateral, defaultFixture, IConfig, IMPLEMENTATION } from '../fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe(`Self-referential collateral - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let compoundMock: ComptrollerMock
  let compoundOracleInternal: CompoundOracleMock

  // Tokens and Assets
  let token0: CTokenMock
  let weth: WETH9
  let wethCollateral: CompoundSelfReferentialCollateral
  let backupToken: ERC20Mock
  let collateral0: Collateral
  let backupCollateral: Collateral

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let rToken: TestIRToken
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let initialBal: BigNumber
  let ethBal: BigNumber

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
      compoundOracleInternal,
      erc20s,
      collateral,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))

    // Main ERC20
    token0 = <CTokenMock>erc20s[4] // cDai
    collateral0 = collateral[4]

    weth = await (await ethers.getContractFactory('WETH9')).deploy()
    wethCollateral = await (
      await ethers.getContractFactory('CompoundSelfReferentialCollateral')
    ).deploy(weth.address, config.maxTradeVolume, compoundMock.address, 'ETH')

    // Backup
    backupToken = erc20s[2] // USDT
    backupCollateral = <Collateral>collateral[2]

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(wethCollateral.address)
    await assetRegistry.connect(owner).register(backupCollateral.address)
    await basketHandler.setPrimeBasket([token0.address, weth.address], [fp('1'), fp('0.001')])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('USD'), 1, [
      token0.address,
      backupToken.address,
    ])
    await basketHandler.refreshBasket()

    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(weth.address)
    await backingManager.grantRTokenAllowance(backupToken.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await backupToken.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await backupToken.connect(owner).mint(addr2.address, initialBal)

    // Deposit ETH to get WETH
    ethBal = bn('1e20') // 100 ETH
    await weth.connect(addr1).deposit({
      value: ethers.utils.parseUnits(ethBal.toString(), 'wei'),
    })

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  describe('Happy paths', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await weth.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await rToken.totalSupply()).to.equal(issueAmt)
      expect(await weth.balanceOf(backingManager.address)).to.equal(issueAmt.div(1000))
    })

    it('should sell appreciating collateral and ignore self-referential', async () => {
      await token0.setExchangeRate(fp('1.1')) // 10% appreciation
      await expect(backingManager.manageTokens([token0.address])).to.not.emit(
        backingManager,
        'TradeStarted'
      )
      expect(await weth.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await weth.balanceOf(rsrTrader.address)).to.equal(0)
      await expect(rTokenTrader.manageToken(weth.address)).to.not.emit(rTokenTrader, 'TradeStarted')
      await expect(rTokenTrader.manageToken(token0.address)).to.emit(rTokenTrader, 'TradeStarted')

      // RTokenTrader should be selling token0 and buying RToken
      const trade = await getTrade(rTokenTrader, token0.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(rToken.address)

      await expect(rsrTrader.manageToken(weth.address)).to.not.emit(rsrTrader, 'TradeStarted')
      await expect(rsrTrader.manageToken(token0.address)).to.emit(rsrTrader, 'TradeStarted')

      // RSRTrader should be selling token0 and buying RToken
      const trade2 = await getTrade(rsrTrader, token0.address)
      expect(await trade2.sell()).to.equal(token0.address)
      expect(await trade2.buy()).to.equal(rsr.address)
    })

    it('should change basket around self-referential collateral', async () => {
      await token0.setExchangeRate(fp('0.99')) // default
      await basketHandler.refreshBasket()
      await expect(backingManager.manageTokens([token0.address, weth.address])).to.emit(
        backingManager,
        'TradeStarted'
      )

      // BackingManager shoiuld be selling token0 and buying backupToken
      const trade = await getTrade(backingManager, token0.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(backupToken.address)

      // No WETH should have moved
      expect(await weth.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await weth.balanceOf(rsrTrader.address)).to.equal(0)
    })

    it('should be able to redeem after ETH price increase', async () => {
      await compoundOracleInternal.setPrice('ETH', bn('8000e6')) // doubling of price

      // Price change should not impact share of redemption tokens
      expect(await rToken.connect(addr1).redeem(issueAmt))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await weth.balanceOf(addr1.address)).to.equal(ethBal)
    })

    it('should not default when USD price falls', async () => {
      await compoundOracleInternal.setPrice('ETH', bn('2000e6')) // halving of price
      await assetRegistry.refresh()
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.basketsHeldBy(backingManager.address)).to.equal(issueAmt)
    })
  })
})

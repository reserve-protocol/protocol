import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import { advanceTime } from '../utils/time'
import { IConfig } from '../../common/configuration'
import { CollateralStatus, TradeKind } from '../../common/constants'
import {
  ERC20Mock,
  EURFiatCollateral,
  IAssetRegistry,
  IFacadeTest,
  MockV3Aggregator,
  StaticATokenMock,
  TestIBackingManager,
  TestIBasketHandler,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
} from '../../typechain'
import { getTrade } from '../utils/trades'
import {
  Collateral,
  defaultFixtureNoBasket,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from '../fixtures'
import { expectPrice } from '../utils/oracles'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

describe(`EUR fiatcoins (eg EURT) - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Tokens and Assets
  let eurt: ERC20Mock
  let eurtCollateral: EURFiatCollateral
  let token0: StaticATokenMock
  let collateral0: Collateral

  // Config values
  let config: IConfig

  // Chainlink oracles
  let referenceUnitOracle: MockV3Aggregator // {UoA/ref}
  let targetUnitOracle: MockV3Aggregator // {UoA/target}

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let facadeTest: IFacadeTest

  let initialBal: BigNumber

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
      facadeTest,
    } = await loadFixture(defaultFixtureNoBasket))

    // Main ERC20
    token0 = <StaticATokenMock>erc20s[7] // aDAI
    collateral0 = collateral[7]

    eurt = await (await ethers.getContractFactory('ERC20Mock')).deploy('EURT Token', 'EURT')
    targetUnitOracle = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('0.5e8')) // $0.50 / EUR
    )
    referenceUnitOracle = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('0.5e8')) // $0.50 / EURT
    )
    eurtCollateral = await (
      await ethers.getContractFactory('EURFiatCollateral')
    ).deploy(
      {
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: referenceUnitOracle.address,
        oracleError: ORACLE_ERROR,
        erc20: eurt.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: ORACLE_TIMEOUT,
        targetName: ethers.utils.formatBytes32String('EUR'),
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: DELAY_UNTIL_DEFAULT,
      },
      targetUnitOracle.address,
      ORACLE_TIMEOUT
    )

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(eurtCollateral.address)
    await basketHandler.setPrimeBasket([token0.address, eurt.address], [fp('0.5'), fp('0.5')])
    await basketHandler.refreshBasket()
    await advanceTime(config.warmupPeriod.toNumber() + 1)

    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(eurt.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await eurt.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await eurt.connect(owner).mint(addr2.address, initialBal)

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  describe('Scenarios', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await eurt.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await rToken.totalSupply()).to.equal(issueAmt)
      expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmt.div(2))
      expect(await eurt.balanceOf(backingManager.address)).to.equal(issueAmt.div(2))
    })

    it('should sell appreciating stable collateral and ignore eurt', async () => {
      await token0.setExchangeRate(fp('1.1')) // 10% appreciation
      await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
        'already collateralized'
      )
      await backingManager.forwardRevenue([eurt.address, token0.address])
      expect(await eurt.balanceOf(rTokenTrader.address)).to.equal(0)
      expect(await eurt.balanceOf(rsrTrader.address)).to.equal(0)
      await expect(
        rTokenTrader.manageTokens([eurt.address], [TradeKind.BATCH_AUCTION])
      ).to.be.revertedWith('0 balance')
      await expect(rTokenTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])).to.emit(
        rTokenTrader,
        'TradeStarted'
      )

      // RTokenTrader should be selling token0 and buying RToken
      const trade = await getTrade(rTokenTrader, token0.address)
      expect(await trade.sell()).to.equal(token0.address)
      expect(await trade.buy()).to.equal(rToken.address)

      await expect(
        rsrTrader.manageTokens([eurt.address], [TradeKind.BATCH_AUCTION])
      ).to.be.revertedWith('0 balance')
      await expect(rsrTrader.manageTokens([token0.address], [TradeKind.BATCH_AUCTION])).to.emit(
        rsrTrader,
        'TradeStarted'
      )

      // RSRTrader should be selling token0 and buying RToken
      const trade2 = await getTrade(rsrTrader, token0.address)
      expect(await trade2.sell()).to.equal(token0.address)
      expect(await trade2.buy()).to.equal(rsr.address)
    })

    it('should calculate price correctly', async () => {
      await referenceUnitOracle.updateAnswer(bn('0.475e8')) // 5% below peg
      await expectPrice(eurtCollateral.address, fp('0.475'), ORACLE_ERROR, true)
    })

    it('should redeem after EUR price increase for same quantities', async () => {
      // doubling
      await referenceUnitOracle.updateAnswer(bn('1e8'))
      await targetUnitOracle.updateAnswer(bn('1e8'))

      // Price change should not impact share of redemption tokens
      expect(await rToken.connect(addr1).redeem(issueAmt))
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await eurt.balanceOf(addr1.address)).to.equal(initialBal)
    })

    it('should not default when USD price falls', async () => {
      // halving
      await referenceUnitOracle.updateAnswer(bn('0.25e8'))
      await targetUnitOracle.updateAnswer(bn('0.25e8'))
      await assetRegistry.refresh()

      // Should be fully collateralized
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, backingManager.address)).to.equal(
        issueAmt
      )
    })

    it('should be able to deregister', async () => {
      await assetRegistry.connect(owner).unregister(eurtCollateral.address)
      await basketHandler.refreshBasket()

      // Should be in an undercollateralized state but SOUND
      expect(await basketHandler.fullyCollateralized()).to.equal(false)
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
    })

    it('should enter basket disabled state after slow default', async () => {
      // Depeg EURT from the euro
      await eurtCollateral.refresh()
      await referenceUnitOracle.updateAnswer(bn('0.25e8')) // halving
      await eurtCollateral.refresh()
      expect(await eurtCollateral.status()).to.equal(CollateralStatus.IFFY)

      // Advance time and complete default
      await advanceTime(DELAY_UNTIL_DEFAULT.toString())
      await eurtCollateral.refresh()
      expect(await eurtCollateral.status()).to.equal(CollateralStatus.DISABLED)

      await basketHandler.refreshBasket()

      // Should enter disabled state
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
    })
  })
})

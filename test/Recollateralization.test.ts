import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, constants } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../common/configuration'
import {
  BN_SCALE_FACTOR,
  CollateralStatus,
  TradeKind,
  MAX_UINT256,
  ZERO_ADDRESS,
} from '../common/constants'
import { expectEvents } from '../common/events'
import { bn, fp, pow10, toBNDecimals, divCeil } from '../common/numbers'
import {
  Asset,
  ATokenFiatCollateral,
  CTokenMock,
  DutchTrade,
  ERC20Mock,
  FacadeTest,
  FiatCollateral,
  GnosisMock,
  IAssetRegistry,
  MockV3Aggregator,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIBasketHandler,
  TestIBroker,
  TestIFacade,
  TestIMain,
  TestIRToken,
  TestIStRSR,
  USDCMock,
  DutchTradeRouter,
} from '../typechain'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from './utils/time'
import {
  Collateral,
  defaultFixture,
  defaultFixtureNoBasket,
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  DECAY_DELAY,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from './fixtures'
import snapshotGasCost from './utils/snapshotGasCost'
import { expectTrade, getTrade, dutchBuyAmount } from './utils/trades'
import { withinTolerance } from './utils/matchers'
import { expectRTokenPrice, expectUnpriced, setOraclePrice } from './utils/oracles'
import { useEnv } from '#/utils/env'
import { mintCollaterals } from './utils/tokens'

const DEFAULT_THRESHOLD = fp('0.01') // 1%

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describe(`Recollateralization - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let aaveToken: ERC20Mock
  let aaveAsset: Asset

  // Trading
  let gnosis: GnosisMock

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let backupToken1: ERC20Mock
  let backupToken2: ERC20Mock
  let collateral0: FiatCollateral
  let collateral1: FiatCollateral
  let backupCollateral1: FiatCollateral
  let backupCollateral2: ATokenFiatCollateral
  let basket: Collateral[]
  let basketsNeededAmts: BigNumber[]
  let rTokenAsset: RTokenAsset

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let facade: TestIFacade
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler
  let main: TestIMain
  let broker: TestIBroker

  interface IBackingInfo {
    tokens: string[]
    quantities: BigNumber[]
  }

  const expectCurrentBacking = async (backingInfo: Partial<IBackingInfo>) => {
    const tokens = await facade.basketTokens(rToken.address)
    expect(tokens).to.eql(backingInfo.tokens)

    for (let i = 0; i < tokens.length; i++) {
      const tok = await ethers.getContractAt('ERC20Mock', tokens[i])
      const q = backingInfo.quantities ? backingInfo.quantities[i] : 0
      expect(await tok.balanceOf(backingManager.address)).to.eql(q)
    }
  }

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

    return divCeil(divCeil(product, highBuyPrice), BN_SCALE_FACTOR) // (c)
  }

  const doFixtureSetup = async (setBasket: boolean) => {
    let erc20s: ERC20Mock[]

      // Deploy fixture
    ;({
      rsr,
      aaveToken,
      aaveAsset,
      erc20s,
      collateral,
      basket,
      basketsNeededAmts,
      config,
      rToken,
      stRSR,
      gnosis,
      facade,
      facadeTest,
      assetRegistry,
      backingManager,
      basketHandler,
      main,
      rTokenAsset,
      broker,
    } = await loadFixture(setBasket ? defaultFixture : defaultFixtureNoBasket))
    token0 = <ERC20Mock>erc20s[collateral.indexOf(basket[0])]
    token1 = <USDCMock>erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await basket[3].erc20())

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = <FiatCollateral>basket[0]
    collateral1 = <FiatCollateral>basket[1]
    // collateral2 = <ATokenFiatCollateral>basket[2]
    // collateral3 = <CTokenFiatCollateral>basket[3]

    // Backup tokens and collaterals - USDT - aUSDT - aUSDC - aBUSD
    backupToken1 = erc20s[2] // USDT
    backupCollateral1 = <FiatCollateral>collateral[2]
    backupToken2 = erc20s[9] // aUSDT
    backupCollateral2 = <ATokenFiatCollateral>collateral[9]

    // Mint initial balances
    initialBal = bn('1000000e18')
    await mintCollaterals(owner, [addr1, addr2], initialBal, basket)

    await backupToken1.connect(owner).mint(addr1.address, initialBal)
    await backupToken2.connect(owner).mint(addr1.address, initialBal)

    await backupToken1.connect(owner).mint(addr2.address, initialBal)
    await backupToken2.connect(owner).mint(addr2.address, initialBal)

    if (IMPLEMENTATION === Implementation.P1) {
      await (
        await ethers.getContractAt('BackingManagerP1', backingManager.address)
      ).cacheComponents()
    }
  }

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    await doFixtureSetup(true)
  })

  describe('Default Handling - Basket Selection', function () {
    context('With issued Rtokens', function () {
      let issueAmount: BigNumber
      let initialTokens: string[]
      let initialQuantities: BigNumber[]
      let initialQuotes: BigNumber[]
      let quotes: BigNumber[]

      beforeEach(async function () {
        issueAmount = bn('100e18')
        initialQuotes = [bn('0.25e18'), bn('0.25e6'), bn('0.25e18'), bn('1.25e9')]
        initialQuantities = initialQuotes.map((q) => {
          return q.mul(issueAmount).div(BN_SCALE_FACTOR)
        })

        initialTokens = await Promise.all(
          basket.map(async (c): Promise<string> => {
            return await c.erc20()
          })
        )

        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)
        await backupToken1.connect(addr1).approve(rToken.address, initialBal)
        await backupToken2.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)
      })

      it('Should select backup config correctly - Single backup token', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token1 to default - 50% price reduction
        await setOraclePrice(collateral1.address, bn('0.5e8'))

        // Mark default as probable
        await collateral1.refresh()

        // Check state - No changes
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Advance time post delayUntilDefault
        await advanceTime((await collateral1.delayUntilDefault()).toString())

        // Confirm default
        await collateral1.refresh()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bn('87.5e18')) // 50% of 25% value lost
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should switch
        const newTokens = [
          initialTokens[0],
          initialTokens[2],
          initialTokens[3],
          backupToken1.address,
        ]
        const newQuantities = [
          initialQuantities[0],
          initialQuantities[2],
          initialQuantities[3],
          bn('0'),
        ]
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, basketsNeededAmts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql([initialQuotes[0], initialQuotes[2], initialQuotes[3], bn('0.25e18')])
      })

      it('Should select backup config correctly - Multiple backup tokens', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)
        await assetRegistry.connect(owner).register(backupCollateral2.address)

        // Set backup configuration - USDT and aUSDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            backupToken1.address,
            backupToken2.address,
          ])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token2 to hard default - Decrease rate
        await token2.setExchangeRate(fp('0.99'))

        // Basket should switch as default is detected immediately
        const newTokens = [
          initialTokens[0],
          initialTokens[1],
          initialTokens[3],
          backupToken1.address,
          backupToken2.address,
        ]
        const newQuantities = [
          initialQuantities[0],
          initialQuantities[1],
          initialQuantities[3],
          bn('0'),
          bn('0'),
        ]

        const newRefAmounts = [
          basketsNeededAmts[0],
          basketsNeededAmts[1],
          basketsNeededAmts[3],
          fp('0.125'),
          fp('0.125'),
        ]
        await assetRegistry.refresh()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

        // Refresh basket
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
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
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token0 to default - 50% price reduction
        await setOraclePrice(collateral0.address, bn('0.5e8'))

        // Mark default as probable
        await assetRegistry.refresh()

        // Check state - No changes
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should not switch yet
        await expect(basketHandler.refreshBasket())

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Basket should switch, default is confirmed
        const newTokens = [initialTokens[1], backupToken1.address]
        const newQuantities = [initialQuantities[1], bn('0')]
        const newRefAmounts = [basketsNeededAmts[1], fp('0.75')]

        await assetRegistry.refresh()
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(3, newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
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
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token3 to hard default - Decrease rate (cDai)
        await token3.setExchangeRate(fp('0.8'))

        // Basket should switch as default is detected immediately
        const newTokens = [initialTokens[0], initialTokens[1], initialTokens[2]]
        const newQuantities = [initialQuantities[0], initialQuantities[1], initialQuantities[2]]
        const newRefAmounts = [
          basketsNeededAmts[0].mul(2),
          basketsNeededAmts[1],
          basketsNeededAmts[2],
        ]
        await assetRegistry.refresh()
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        // Incremented the weight for token0
        expect(quotes).to.eql([bn('0.5e18'), initialQuotes[1], initialQuotes[2]])
      })

      it('Should handle not having a valid backup', async () => {
        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token1 to default - 50% price reduction
        await setOraclePrice(collateral1.address, bn('0.5e8'))

        // Mark default as probable
        await collateral1.refresh()

        // Advance time post delayUntilDefault
        await advanceTime((await collateral1.delayUntilDefault()).toString())

        // Confirm default
        await collateral1.refresh()

        // Basket switches to empty basket
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(1, [], [], true)

        // Check state - Basket is disabled even though fully collateralized
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        // Cannot issue because collateral is not sound
        await expect(rToken.connect(addr1).issue(bn('1e18'))).to.be.revertedWith('basket not ready')
      })

      it('Should handle having invalid tokens in the backup configuration', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)
        await assetRegistry.connect(owner).register(backupCollateral2.address)

        // Set backup configuration - USDT and aUSDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            backupToken1.address,
            backupToken2.address,
          ])

        // Unregister one of the tokens
        await assetRegistry.connect(owner).unregister(backupCollateral1.address)
        await basketHandler.refreshBasket()

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token2 to hard default - Decrease rate
        await token2.setExchangeRate(fp('0.99'))

        // Basket should switch as default is detected immediately
        // Should ignore the unregistered one and skip use the valid one
        const newTokens = [
          initialTokens[0],
          initialTokens[1],
          initialTokens[3],
          backupToken2.address,
        ]
        const newQuantities = [
          initialQuantities[0],
          initialQuantities[1],
          initialQuantities[3],
          bn('0'),
        ]

        const newRefAmounts = [
          basketsNeededAmts[0],
          basketsNeededAmts[1],
          basketsNeededAmts[3],
          fp('0.25'),
        ]
        await assetRegistry.refresh()
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(3, newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql([initialQuotes[0], initialQuotes[1], initialQuotes[3], bn('0.25e18')])
      })
    })

    context('With multiple targets -- USD + EUR', function () {
      let issueAmount: BigNumber
      let newEURCollateral: FiatCollateral
      let backupEURCollateral: Collateral
      let initialTokens: string[]
      let initialQuantities: BigNumber[]
      let initialQuotes: BigNumber[]
      let quotes: BigNumber[]

      beforeEach(async function () {
        await doFixtureSetup(false) // don't set an initial prime basket

        // Issue some RTokens to user
        issueAmount = bn('100e18')

        // Swap asset to have EUR target for token1
        const FiatCollateralFactory: ContractFactory = await ethers.getContractFactory(
          'FiatCollateral'
        )
        const ChainlinkFeedFactory = await ethers.getContractFactory('MockV3Aggregator')

        const newEURFeed = await ChainlinkFeedFactory.deploy(8, bn('1e8'))
        newEURCollateral = <FiatCollateral>await FiatCollateralFactory.deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: newEURFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: token1.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('EUR'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await collateral1.delayUntilDefault(),
        })

        const backupEURFeed = await ChainlinkFeedFactory.deploy(8, bn('1e8'))
        backupEURCollateral = <Collateral>await FiatCollateralFactory.deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: backupEURFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: backupToken1.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('EUR'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await backupCollateral1.delayUntilDefault(),
        })
        // Swap asset
        await assetRegistry.swapRegistered(newEURCollateral.address)

        // Setup new basket with two tokens with different targets
        initialTokens = [token0.address, token1.address]
        await basketHandler.connect(owner).setPrimeBasket(initialTokens, [fp('0.5'), fp('0.5')])
        await basketHandler.connect(owner).refreshBasket()

        // Advance time post warmup period - SOUND just regained
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Set initial values
        initialQuotes = [bn('0.5e18'), bn('0.5e6')]
        initialQuantities = initialQuotes.map((q) => {
          return q.mul(issueAmount).div(BN_SCALE_FACTOR)
        })

        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await backupToken1.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)
      })

      it('Should select backup config correctly - EUR token', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupEURCollateral.address)

        // Set backup configuration - Backup EUR Collateral as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('EUR'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set new EUR Token to default - 50% price reduction
        await setOraclePrice(newEURCollateral.address, bn('0.5e8'))

        // Mark default as probable
        await newEURCollateral.refresh()

        // Advance time post delayUntilDefault
        await advanceTime((await newEURCollateral.delayUntilDefault()).toString())

        // Confirm default
        await newEURCollateral.refresh()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bn('75e18')) // 50% of 50% retained
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should switch
        const newTokens = [initialTokens[0], backupToken1.address]
        const newQuantities = [initialQuantities[0], bn('0')]
        const newRefAmounts = [fp('0.5'), fp('0.5')]
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, newRefAmounts, false)

        // Check state - Basket switch in EUR targets
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql([initialQuotes[0], bn('0.5e18')])
      })

      it('Should handle not having a valid backup for a specific target', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupEURCollateral.address)

        // Set backup configuration - Backup EUR Collateral as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('EUR'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set the USD Token to default - 50% price reduction
        await setOraclePrice(collateral0.address, bn('0.5e8'))

        // Mark default as probable
        await collateral0.refresh()

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default
        await collateral0.refresh()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bn('75e18')) // 50% of 50% retained
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should switch to empty and defaulted
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(1, [], [], true)

        // Check state - Basket is disabled
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        // Cannot issue because collateral is not sound
        await expect(rToken.connect(addr1).issue(bn('1e18'))).to.be.revertedWith('basket not ready')
      })
    })
  })

  describe('Recollateralization', function () {
    context('With very simple Basket - Single stablecoin', function () {
      let issueAmount: BigNumber
      let stakeAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        stakeAmount = bn('10000e18')

        // Setup new basket with single token
        await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()

        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Stake some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
        await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
        await stRSR.connect(addr1).stake(stakeAmount)
      })

      it('Should not trade if trading paused', async () => {
        await main.connect(owner).pauseTrading()
        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      it('Should not trade if frozen', async () => {
        await main.connect(owner).freezeShort()
        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
          'frozen or trading paused'
        )
      })

      it('Should trade if issuance paused', async () => {
        // Setup new prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])
        await basketHandler.refreshBasket()

        await main.connect(owner).pauseIssuance()
        await expect(backingManager.rebalance(TradeKind.DUTCH_AUCTION)).to.emit(
          backingManager,
          'TradeStarted'
        )
      })

      it('Should not trade if UNPRICED', async () => {
        await advanceTime(DECAY_DELAY.toString())
        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
          'basket not ready'
        )
      })

      it('Should not trade during warmup period', async () => {
        const warmupPeriod = bn('259200') // 3 days

        // Set warmup period
        await basketHandler.connect(owner).setWarmupPeriod(warmupPeriod)

        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
          'basket not ready'
        )
      })

      it('Should not apply warmup period when moving from SOUND -> SOUND', async () => {
        const warmupPeriod = bn('259200') // 3 days

        // Set warmup period and advance time
        await basketHandler.connect(owner).setWarmupPeriod(warmupPeriod)
        await advanceTime(warmupPeriod.add(1).toString())

        // Setup new prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Switch Basket
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(3, [token1.address], [fp('1')], false)

        // Trigger recollateralization
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        // Auction can be run even during warmupPeriod
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(
            anyValue,
            token0.address,
            token1.address,
            sellAmt,
            toBNDecimals(minBuyAmt, 6).add(1)
          )

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })
      })

      it('Should skip start recollateralization after warmupPeriod, when regaining SOUND', async () => {
        const warmupPeriod = bn('259200') // 3 days

        // Set warmup period
        await basketHandler.connect(owner).setWarmupPeriod(warmupPeriod)

        // Set basket to IFFY
        await setOraclePrice(collateral0.address, bn('0.5e8'))
        await assetRegistry.refresh()

        // Setup new prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Switch Basket
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(3, [token1.address], [fp('1')], false)

        // Trigger recollateralization
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('0.5'), fp('1'))

        // Attempt to trigger before warmup period - will revert
        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
          'basket not ready'
        )

        // Advance time post warmup period
        await advanceTime(warmupPeriod.add(1).toString())

        // Auction can be run now
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(
            anyValue,
            token0.address,
            token1.address,
            sellAmt,
            toBNDecimals(minBuyAmt, 6).add(1)
          )

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })
      })

      it('Should skip start recollateralization after tradingDelay', async () => {
        // Set trading delay
        const newDelay = 3600
        await backingManager.connect(owner).setTradingDelay(newDelay) // 1 hour

        // Setup prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Switch Basket
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(3, [token1.address], [fp('1')], false)

        // Trigger recollateralization
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

        // Attempt to trigger before trading delay - Should revert
        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
          'trading delayed'
        )

        // Advance time post trading delay
        await advanceTime(newDelay + 1)

        // Auction can be run now
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(
            anyValue,
            token0.address,
            token1.address,
            sellAmt,
            toBNDecimals(minBuyAmt, 6).add(1)
          )

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })
      })

      it('Should not recollateralize when switching basket if all assets are UNPRICED', async () => {
        // Setup prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Switch Basket
        await expect(basketHandler.connect(owner).refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(3, [token1.address], [fp('1')], false)

        // Advance time post warmup period - temporary IFFY->SOUND
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Set all assets to UNPRICED
        await advanceTime(Number(DECAY_DELAY.add(PRICE_TIMEOUT)))

        // Check state remains SOUND
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)

        // RToken unpriced
        await expectUnpriced(rTokenAsset.address)

        // Attempt to recollateralize (no assets to sell)
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
          backingManager,
          'TradeStarted'
        )

        // Nothing changes until situation is resolved
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectUnpriced(rTokenAsset.address)
      })

      context('Should successfully recollateralize after governance basket switch', () => {
        afterEach(async () => {
          // Should be fully capitalized again
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await backingManager.tradesOpen()).to.equal(0)
        })

        it('Should recollateralize correctly when switching basket - Full amount covered', async () => {
          // Setup prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current redemption basket
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Trigger recollateralization
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [
                anyValue,
                token0.address,
                token1.address,
                sellAmt,
                toBNDecimals(minBuyAmt, 6).add(1),
              ],
              emitted: true,
            },
            {
              contract: basketHandler,
              name: 'LastCollateralizedChanged',
              emitted: false,
            },
          ])

          const auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          // Asset value is zero, everything was moved to the Market
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current redemption basket
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

          // Another call should not create any new auctions if still ongoing
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
            backingManager,
            'TradeStarted'
          )

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Get fair price - all tokens
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6).add(1))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(sellAmt, 6).add(1),
          })

          // If we attempt to settle before auction ended it reverts
          await expect(backingManager.settleTrade(token0.address)).to.be.revertedWith(
            'cannot settle yet'
          )

          // Nothing occurs if we attempt to settle for a token that is not being traded
          await expect(backingManager.settleTrade(token3.address)).to.not.emit

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should not start any new auctions
          await expectEvents(backingManager.settleTrade(token0.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                token0.address,
                token1.address,
                sellAmt,
                toBNDecimals(sellAmt, 6).add(1),
              ],
              emitted: true,
            },
            {
              contract: basketHandler,
              name: 'LastCollateralizedChanged',
              emitted: false,
            },
          ])

          // Check state - Order restablished
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          const totalValue = toBNDecimals(sellAmt, 6).add(1).mul(bn('1e12')) // small gain; decimal adjustment
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(totalValue)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(issueAmount, 6).add(1)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount) // assets kept in backing buffer

          // After recollateralization: redemption on previous nonce should be empty
          await expect(
            rToken.connect(addr1).redeemCustom(addr1.address, bn('1'), [2], [fp('1')], [], [])
          ).to.be.revertedWith('empty redemption')

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should recollateralize correctly when switching basket', async () => {
          // Set oracle value out-of-range
          await setOraclePrice(collateral0.address, MAX_UINT256.div(2))

          // Setup prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Advance time post warmup period - temporary IFFY->SOUND
          await advanceTime(Number(config.warmupPeriod) + 1)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current redemption basket
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Trigger recollateralization
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt: BigNumber = toBNDecimals(
            await toMinBuyAmt(sellAmt, fp('1'), fp('1')),
            6
          ).add(1)
          // since within oracleTimeout, price() should still be at 100% of original price

          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, token1.address, sellAmt, minBuyAmt)

          const auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Get all tokens for simplification
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(sellAmt, 6),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should  not start any new auctions
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, token1.address, sellAmt, toBNDecimals(sellAmt, 6)],
              emitted: true,
            },
            { contract: backingManager, name: 'TradeStarted', emitted: false },
          ])

          // Check state - Order restablished
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(issueAmount, 6)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should recollateralize correctly when switching basket - Taking no Haircut - No RSR', async () => {
          await backingManager.connect(owner).setBackingBuffer(0)

          // Empty out the staking pool
          await stRSR.connect(addr1).unstake(stakeAmount)
          await advanceTime(config.unstakingDelay.toString())
          await stRSR.connect(addr1).withdraw(addr1.address, 1)

          // Set prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current RToken -- no backing swapped in yet
          await expectRTokenPrice(
            rTokenAsset.address,
            fp('1'),
            ORACLE_ERROR,
            await backingManager.maxTradeSlippage(),
            config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
          )

          // Trigger recollateralization
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, token1.address, anyValue, anyValue)

          const auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          const t = await getTrade(backingManager, token0.address)
          const sellAmt = await t.initBal()
          expect(sellAmt).to.be.closeTo(issueAmount, issueAmount.mul(5).div(1000)) // within 0.5%
          const remainder = issueAmount.sub(sellAmt)

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(remainder)
          expect(await token0.balanceOf(backingManager.address)).to.equal(remainder)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current RToken -- should track backing out on auction
          await expectRTokenPrice(
            rTokenAsset.address,
            fp('1'),
            ORACLE_ERROR,
            await backingManager.maxTradeSlippage(),
            config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
          )

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(sellAmt)

          // Another call should not create any new auctions if still ongoing
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
            backingManager,
            'TradeStarted'
          )

          // Perform Mock Bids for the new Token (addr1 has balance)
          const buyAmt = sellAmt.mul(2) // give free tokens
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(buyAmt, 6))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(buyAmt, 6),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should not start any new auctions
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, token1.address, sellAmt, toBNDecimals(buyAmt, 6)],
              emitted: true,
            },
            { contract: backingManager, name: 'TradeStarted', emitted: false },
          ])

          // Check state - no Haircut taken; extra tokens sent to revenue traders
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.gt(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.be.closeTo(bn('0'), bn('10000'))
          expect(await token1.balanceOf(backingManager.address)).to.equal(toBNDecimals(buyAmt, 6))
          expect(await rToken.totalSupply()).to.be.gt(issueAmount) // New RToken minting

          // Check price in USD of the current RToken
          expect(await rToken.basketsNeeded()).to.equal(await rToken.totalSupply()) // no haircut
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should recollateralize correctly when switching basket - Taking average Haircut - No RSR', async () => {
          // Empty out the staking pool
          await stRSR.connect(addr1).unstake(stakeAmount)
          await advanceTime(config.unstakingDelay.toString())
          await stRSR.connect(addr1).withdraw(addr1.address, 1)

          // Set prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current RToken -- no backing swapped in yet
          await expectRTokenPrice(
            rTokenAsset.address,
            fp('1'),
            ORACLE_ERROR,
            await backingManager.maxTradeSlippage(),
            config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
          )

          // Trigger recollateralization
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, token1.address, anyValue, anyValue)

          const auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          const t = await getTrade(backingManager, token0.address)
          const sellAmt = await t.initBal()
          expect(sellAmt).to.be.closeTo(issueAmount, issueAmount.mul(5).div(1000)) // within 0.5%
          const remainder = issueAmount.sub(sellAmt)

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(remainder)
          expect(await token0.balanceOf(backingManager.address)).to.equal(remainder)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current RToken -- should track balances out on trade
          await expectRTokenPrice(
            rTokenAsset.address,
            fp('1'),
            ORACLE_ERROR,
            await backingManager.maxTradeSlippage(),
            config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
          )

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(sellAmt)

          // Another call should not create any new auctions if still ongoing
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
            backingManager,
            'TradeStarted'
          )

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Pay at market price
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(sellAmt, 6),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should not start any new auctions
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, token1.address, sellAmt, toBNDecimals(sellAmt, 6)],
              emitted: true,
            },
            { contract: backingManager, name: 'TradeStarted', emitted: false },
          ])

          // Check state - Haircut taken, price of RToken has been reduced
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
            issueAmount,
            issueAmount.mul(520).div(100000) // 520 parts in 1 miliion
          )
          expect(await token0.balanceOf(backingManager.address)).to.be.closeTo(0, 1000)
          expect(await token1.balanceOf(backingManager.address)).to.be.closeTo(
            0,
            toBNDecimals(sellAmt, 6)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount) // Supply remains constant

          // Check price in USD of the current RToken
          expect(await rToken.basketsNeeded()).to.be.closeTo(
            issueAmount,
            issueAmount.mul(520).div(1000000) // 520 parts in 1 million
          )
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should recollateralize correctly when switching basket - Taking maximum Haircut - No RSR', async () => {
          // Empty out the staking pool
          await stRSR.connect(addr1).unstake(stakeAmount)
          await advanceTime(config.unstakingDelay.toString())
          await stRSR.connect(addr1).withdraw(addr1.address, 1)

          // Set prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current RToken -- no backing swapped in yet
          await expectRTokenPrice(
            rTokenAsset.address,
            fp('1'),
            ORACLE_ERROR,
            await backingManager.maxTradeSlippage(),
            config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
          )

          // Trigger recollateralization
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, token1.address, anyValue, anyValue)

          const auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          const t = await getTrade(backingManager, token0.address)
          const sellAmt = await t.initBal()
          const minBuyAmt = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))
          expect(sellAmt).to.be.closeTo(issueAmount, issueAmount.mul(5).div(1000)) // within 0.5%
          const remainder = issueAmount.sub(sellAmt)

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(remainder)
          expect(await token0.balanceOf(backingManager.address)).to.equal(remainder)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)

          // Check price in USD of the current RToken -- backing is tracked while out on trade
          await expectRTokenPrice(
            rTokenAsset.address,
            fp('1'),
            ORACLE_ERROR,
            await backingManager.maxTradeSlippage(),
            config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
          )

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(sellAmt)

          // Another call should not create any new auctions if still ongoing
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
            backingManager,
            'TradeStarted'
          )

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Pay at worst-case price
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(minBuyAmt, 6),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should not start any new auctions
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6)],
              emitted: true,
            },
            { contract: backingManager, name: 'TradeStarted', emitted: false },
          ])

          // Check state - Haircut taken, price of RToken has been reduced
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          const remainingValue = toBNDecimals(minBuyAmt, 6).mul(bn('1e12')).add(remainder)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
            remainingValue,
            remainingValue.div(bn('5e3'))
          )
          expect(await token0.balanceOf(backingManager.address)).to.be.closeTo(0, 1000)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(minBuyAmt, 6)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount) // Supply remains constant
          expect(await rToken.basketsNeeded()).to.be.closeTo(
            issueAmount,
            issueAmount.mul(31).div(1000) // within 3.1%
          )

          // Check price in USD of the current RToken
          const rTokenPrice2 = remainingValue.mul(BN_SCALE_FACTOR).div(issueAmount)
          expect(rTokenPrice2).to.be.gte(fp('0.97')) // less than 3% loss
          await expectRTokenPrice(rTokenAsset.address, rTokenPrice2, ORACLE_ERROR)
        })

        it('Should recollateralize correctly when switching basket - Necessary RSR overcollateralization', async () => {
          // Eliminate minTradeVolume
          await backingManager.connect(owner).setMinTradeVolume(0)

          // Reduce stake to just necessary overcollateralization
          const necessaryStake = issueAmount.mul(51).div(1000) // 5.1% of RToken supply
          await stRSR.connect(addr1).unstake(stakeAmount.sub(necessaryStake))
          await advanceTime(config.unstakingDelay.toString())
          await stRSR.withdraw(addr1.address, 1)
          expect(await rsr.balanceOf(stRSR.address)).to.equal(necessaryStake)

          // Set prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check stakes
          expect(await rsr.balanceOf(stRSR.address)).to.equal(necessaryStake)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(necessaryStake)

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken -- retains price because of
          // over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Trigger recollateralization
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(
              anyValue,
              token0.address,
              token1.address,
              sellAmt,
              toBNDecimals(minBuyAmt, 6).add(1)
            )

          let auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          // Asset value is zero, everything was moved to the Market
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

          // Another call should not create any new auctions if still ongoing
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
            backingManager,
            'TradeStarted'
          )

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Pay at worst-case price
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6).add(1))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(minBuyAmt, 6).add(1),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should start a new one to sell RSR for collateral
          // ~3e18 Tokens left to buy - Sets Buy amount as independent value
          const buyAmtBidRSR: BigNumber = sellAmt.sub(minBuyAmt)
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                token0.address,
                token1.address,
                sellAmt,
                toBNDecimals(minBuyAmt, 6).add(1),
              ],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [
                anyValue,
                rsr.address,
                token1.address,
                anyValue,
                toBNDecimals(buyAmtBidRSR, 6).add(1),
              ],
              emitted: true,
            },
          ])

          auctionTimestamp = await getLatestBlockTimestamp()

          // RSR -> Token1 Auction
          await expectTrade(backingManager, {
            sell: rsr.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('1'),
          })

          const t = await getTrade(backingManager, rsr.address)
          const sellAmtRSR = await t.initBal()
          expect(toBNDecimals(buyAmtBidRSR, 6)).to.equal(
            toBNDecimals(await toMinBuyAmt(sellAmtRSR, fp('1'), fp('1')), 6)
          )

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(minBuyAmt, 6).add(1)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check Gnosis
          expect(await rsr.balanceOf(gnosis.address)).to.equal(sellAmtRSR)

          // Another call should not create any new auctions if still ongoing
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
            backingManager,
            'TradeStarted'
          )

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Cover buyAmtBidRSR which is all the RSR required
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmtRSR, 6))
          await gnosis.placeBid(1, {
            bidder: addr1.address,
            sellAmount: sellAmtRSR,
            buyAmount: toBNDecimals(buyAmtBidRSR, 6),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should start final dust auction
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                rsr.address,
                token1.address,
                sellAmtRSR,
                toBNDecimals(buyAmtBidRSR, 6),
              ],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
          ])

          // Check state - Order restablished
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(issueAmount, 6)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount)
          expect(await rToken.basketsNeeded()).to.equal(issueAmount) // no haircut

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should recollateralize correctly when switching basket - Using revenue asset token for remainder', async () => {
          // Set prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken -- retains price because of
          // over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Trigger recollateralization
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(
              anyValue,
              token0.address,
              token1.address,
              sellAmt,
              toBNDecimals(minBuyAmt, 6).add(1)
            )

          let auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          // Asset value is zero, everything was moved to the Market
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken -- retains price because of
          // over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Get fair price - minBuyAmt
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6).add(1))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(minBuyAmt, 6).add(1),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should start a new one to sell a new revenue token instead of RSR
          // About 3e18 Tokens left to buy - Sets Buy amount as independent value
          const buyAmtBidRevToken: BigNumber = sellAmt.sub(minBuyAmt)

          // Send the excess revenue tokens to backing manager - should be used instead of RSR
          // Set price = $1 as expected
          await aaveToken.connect(owner).mint(backingManager.address, buyAmtBidRevToken.mul(2))
          await setOraclePrice(aaveAsset.address, bn('1e8'))
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                token0.address,
                token1.address,
                sellAmt,
                toBNDecimals(minBuyAmt, 6).add(1),
              ],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [
                anyValue,
                aaveToken.address,
                token1.address,
                anyValue,
                toBNDecimals(buyAmtBidRevToken, 6).add(1),
              ],
              emitted: true,
            },
          ])

          auctionTimestamp = await getLatestBlockTimestamp()

          // Aave Token -> Token1 Auction
          await expectTrade(backingManager, {
            sell: aaveToken.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('1'),
          })

          const t = await getTrade(backingManager, aaveToken.address)
          const sellAmtRevToken = await t.initBal()
          expect(toBNDecimals(buyAmtBidRevToken, 6).add(1)).to.equal(
            toBNDecimals(await toMinBuyAmt(sellAmtRevToken, fp('1'), fp('1')), 6).add(1)
          )

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(minBuyAmt, 6).add(1)
          )
          expect(await aaveToken.balanceOf(backingManager.address)).to.equal(
            buyAmtBidRevToken.mul(2).sub(sellAmtRevToken)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check Gnosis
          expect(await aaveToken.balanceOf(gnosis.address)).to.equal(sellAmtRevToken)

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Cover buyAmtBidRevToken which is all the amount required
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmtRevToken, 6))
          await gnosis.placeBid(1, {
            bidder: addr1.address,
            sellAmount: sellAmtRevToken,
            buyAmount: toBNDecimals(buyAmtBidRevToken, 6).add(1),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                aaveToken.address,
                token1.address,
                sellAmtRevToken,
                toBNDecimals(buyAmtBidRevToken, 6).add(1),
              ],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
          ])

          //  Check state - Order restablished
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(issueAmount, 6).add(1)
          )
          expect(await aaveToken.balanceOf(backingManager.address)).to.be.closeTo(bn('0'), 10000) // distributor leaves some
          expect(await rToken.totalSupply()).to.be.closeTo(issueAmount, fp('0.000001')) // we have a bit more

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Stakes unchanged
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)
        })

        it('Should dissolve held RToken to recapitalize, when possible', async () => {
          // Send all RToken to BackingManager
          await rToken.connect(addr1).transfer(backingManager.address, issueAmount)

          // Set prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken -- retains price because of
          // over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Trigger recollateralization -- should recapitalize by dissolving RToken
          await expectEvents(backingManager.rebalance(TradeKind.BATCH_AUCTION), [
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
            {
              contract: rToken,
              name: 'BasketsNeededChanged',
              emitted: true,
            },
          ])

          // Check fullyCollateralized and rest of state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(0)
        })

        it('Should recollateralize correctly in case of default - Using RSR for remainder', async () => {
          // Register Collateral
          await assetRegistry.connect(owner).register(backupCollateral1.address)

          // Set backup configuration - USDT as backup
          await basketHandler
            .connect(owner)
            .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

          // Set new max auction size for asset (will require 2 auctions)
          const chainlinkFeed = <MockV3Aggregator>(
            await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
          )
          const CollateralFactory: ContractFactory = await ethers.getContractFactory(
            'FiatCollateral'
          )
          const newCollateral0: FiatCollateral = <FiatCollateral>await CollateralFactory.deploy({
            priceTimeout: PRICE_TIMEOUT,
            chainlinkFeed: chainlinkFeed.address,
            oracleError: ORACLE_ERROR,
            erc20: token0.address,
            maxTradeVolume: fp('25'),
            oracleTimeout: ORACLE_TIMEOUT,
            targetName: ethers.utils.formatBytes32String('USD'),
            defaultThreshold: DEFAULT_THRESHOLD,
            delayUntilDefault: await backupCollateral1.delayUntilDefault(),
          })

          // Perform swap
          await assetRegistry.connect(owner).swapRegistered(newCollateral0.address)
          expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
          await basketHandler.refreshBasket()
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

          // Advance time post warmup period - SOUND just regained
          await advanceTime(Number(config.warmupPeriod) + 1)

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check stakes
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)

          // Set Token0 to default - 50% price reduction
          await setOraclePrice(newCollateral0.address, bn('0.5e8'))

          // Mark default as probable
          await assetRegistry.refresh()
          expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

          // Advance time post collateral's default delay
          await advanceTime((await newCollateral0.delayUntilDefault()).toString())

          // Confirm default and trigger basket switch
          await basketHandler.refreshBasket()

          // Advance time post warmup period - SOUND just regained
          await advanceTime(Number(config.warmupPeriod) + 1)

          // Check new state after basket switch
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.div(2)
          )
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Running auctions will trigger recollateralization - skip half of the balance is available
          // maxTradeVolume is 25
          const sellAmtBeforeSlippage: BigNumber = (
            await token0.balanceOf(backingManager.address)
          ).div(2)
          const sellAmt = sellAmtBeforeSlippage
            .mul(BN_SCALE_FACTOR)
            .div(BN_SCALE_FACTOR.add(ORACLE_ERROR))
          const minBuyAmt = await toMinBuyAmt(sellAmt, fp('0.5'), fp('1'))

          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, backupToken1.address, sellAmt, minBuyAmt)

          let auctionTimestamp = await getLatestBlockTimestamp()

          // Token0 -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: backupToken1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.div(2).sub(sellAmt.div(2))
          )
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount.sub(sellAmt))
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Perform Mock Bids (addr1 has balance)
          // Pay at worst-case price
          await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: minBuyAmt,
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Run auctions - will end current, and will open a new auction for the same amount
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, backupToken1.address, sellAmt, minBuyAmt],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [anyValue, token0.address, backupToken1.address, sellAmt, minBuyAmt],
              emitted: true,
            },
          ])

          // Check new auction
          // Token0 -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: backupToken1.address,
            endTime: (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength),
            externalId: bn('1'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(
            issueAmount.sub(sellAmt.mul(2))
          )
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Perform Mock Bids (addr1 has balance)
          // Pay at worst-case price
          await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
          await gnosis.placeBid(1, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: minBuyAmt,
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Check staking situation remains unchanged
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Run auctions - will end current, and will open a new auction for the remaining amount
          const leftoverSellAmt = issueAmount.sub(sellAmt.mul(2))
          const leftoverMinBuyAmt = await toMinBuyAmt(leftoverSellAmt, fp('0.5'), fp('1'))
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, backupToken1.address, sellAmt, minBuyAmt],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [
                anyValue,
                token0.address,
                backupToken1.address,
                leftoverSellAmt,
                leftoverMinBuyAmt,
              ],
              emitted: true,
            },
          ])

          // Check new auction
          // Token0 -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: backupToken1.address,
            endTime: (await getLatestBlockTimestamp()) + Number(config.batchAuctionLength),
            externalId: bn('2'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt.mul(2))
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Perform Mock Bids (addr1 has balance)
          // Pay at worst-case price
          await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
          await gnosis.placeBid(2, {
            bidder: addr1.address,
            sellAmount: leftoverSellAmt,
            buyAmount: leftoverMinBuyAmt,
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Check staking situation remains unchanged
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should start a new one to sell RSR for collateral
          // ~51e18 Tokens left to buy - Sets Buy amount as independent value
          const buyAmtBidRSR: BigNumber = issueAmount
            .sub(minBuyAmt.mul(2).add(leftoverMinBuyAmt))
            .add(1)
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                token0.address,
                backupToken1.address,
                leftoverSellAmt,
                leftoverMinBuyAmt,
              ],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [anyValue, rsr.address, backupToken1.address, anyValue, buyAmtBidRSR],
              emitted: true,
            },
          ])

          auctionTimestamp = await getLatestBlockTimestamp()

          // Check new auction
          // RSR -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: rsr.address,
            buy: backupToken1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('3'),
          })

          const t = await getTrade(backingManager, rsr.address)
          const sellAmtRSR = await t.initBal()
          expect(buyAmtBidRSR).to.equal(await toMinBuyAmt(sellAmtRSR, fp('1'), fp('1')))

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            minBuyAmt.mul(2).add(leftoverMinBuyAmt)
          )
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
            minBuyAmt.mul(2).add(leftoverMinBuyAmt)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken - half now
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Should have seized RSR
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount.sub(sellAmtRSR)) // Sent to market (auction)

          // Perform Mock Bids for RSR (addr1 has balance)
          // Pay at worst-case price
          await backupToken1.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
          await gnosis.placeBid(3, {
            bidder: addr1.address,
            sellAmount: sellAmtRSR,
            buyAmount: buyAmtBidRSR,
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction; should not start a new one
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
          ])

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0) // no dust

          // Should have small excess now
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.add(1)
          )
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(issueAmount.add(1))
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken - Remains the same
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should overcollateralize when minTradeVolume is larger than the collateral deficit', async () => {
          // Register Collateral
          await assetRegistry.connect(owner).register(backupCollateral1.address)

          // Set backup configuration - USDT as backup
          await basketHandler
            .connect(owner)
            .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check stakes
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)

          // Set Token0 to default - 50% price reduction
          await setOraclePrice(collateral0.address, bn('0.5e8'))

          // Mark default as probable
          await assetRegistry.refresh()
          expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

          // Advance time post collateral's default delay
          await advanceTime((await collateral0.delayUntilDefault()).toString())

          // Confirm default and trigger basket switch
          await assetRegistry.refresh()
          await basketHandler.refreshBasket()

          // Advance time post warmup period - SOUND just regained
          await advanceTime(Number(config.warmupPeriod) + 1)

          // Check new state after basket switch
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          // Asset value is half
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.div(2)
          )
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)
          // retains value because over-collateralization, true
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Running auctions will trigger recollateralization
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt = await toMinBuyAmt(sellAmt, fp('0.5'), fp('1'))

          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, backupToken1.address, sellAmt, minBuyAmt)

          const auctionTimestamp = await getLatestBlockTimestamp()

          // Token0 -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: backupToken1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          // Asset value is zero, the skip collateral held is defaulted
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount.sub(sellAmt))
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken - retains value from over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Perform Mock Bids (addr1 has balance)
          // Assume fair price, get half of the tokens (because price reduction was 50%)
          await backupToken1.connect(addr1).approve(gnosis.address, sellAmt.div(2))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: sellAmt.div(2),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Raise minTradeVolume to the whole issueAmount
          await backingManager.connect(owner).setMinTradeVolume(issueAmount)

          // Run auctions - RSR Auction launched for minTradeVolume
          const minBuyAmt2 = issueAmount.mul(100).div(101).add(3)
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, backupToken1.address, sellAmt, sellAmt.div(2)],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [anyValue, rsr.address, backupToken1.address, anyValue, minBuyAmt2],
              emitted: true,
            },
          ])

          const t = await getTrade(backingManager, rsr.address)
          const sellAmt2 = await t.initBal()
          expect(minBuyAmt2).to.equal(await toMinBuyAmt(sellAmt2, fp('1'), fp('1')))
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount.sub(sellAmt2))

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0) // no dust

          // Should have half of the value
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.div(2)
          )
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(sellAmt.div(2))
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken - overcollateralized and still targeting 1
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Perform Mock Bids (addr1 has balance)
          // Assume fair price, get half of the tokens (because price reduction was 50%)
          await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
          await gnosis.placeBid(1, {
            bidder: addr1.address,
            sellAmount: sellAmt2,
            buyAmount: minBuyAmt2,
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Run auctions - NO RSR Auction launched but haircut taken
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, rsr.address, backupToken1.address, sellAmt2, minBuyAmt2],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
            {
              contract: rToken,
              name: 'BasketsNeededChanged',
              emitted: true,
            },
          ])

          // Check state
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount.sub(sellAmt2))
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0) // no dust

          // Should have 1.5x starting amounts due to minTradeVolume
          const bonus = issueAmount.div(2).add(minBuyAmt2)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(bonus)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(bonus)

          const supply = bonus.sub(bonus.mul(config.backingBuffer).div(fp('1')))
          // Should mint the excess in order to re-handout to RToken holders and stakers
          expect(await rToken.totalSupply()).to.be.closeTo(supply, supply.div(bn('1e4')))
          expect(await rToken.totalSupply()).to.be.gte(supply)

          // Check price in USD of the current RToken - overcollateralized and still targeting 1
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should recollateralize correctly in case of default - Using RSR for remainder - Multiple tokens and auctions - No overshoot', async () => {
          // Set backing buffer to zero for simplification
          await backingManager.connect(owner).setBackingBuffer(0)

          // Register Collateral
          await assetRegistry.connect(owner).register(backupCollateral1.address)
          await assetRegistry.connect(owner).register(backupCollateral2.address)

          // Set backup configuration - USDT as backup
          await basketHandler
            .connect(owner)
            .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(4), [
              backupToken1.address,
              backupToken2.address,
            ])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check stakes
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)

          // Set Token0 to default - 50% price reduction in 100% of the basket
          await setOraclePrice(collateral0.address, bn('0.5e8'))

          // Mark default as probable
          await assetRegistry.refresh()
          expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

          // Advance time post collateral's default delay
          await advanceTime((await collateral0.delayUntilDefault()).toString())

          // Confirm default and trigger basket switch
          const newTokens = [backupToken1.address, backupToken2.address]
          const bkpTokenRefAmt: BigNumber = fp('0.5')
          const newRefAmounts = [bkpTokenRefAmt, bkpTokenRefAmt]

          await assetRegistry.refresh()
          await expect(basketHandler.refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, newTokens, newRefAmounts, false)

          // Advance time post warmup period - SOUND just regained
          await advanceTime(Number(config.warmupPeriod) + 1)

          // Check new state after basket switch
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.div(2)
          ) // 50% loss
          await expectCurrentBacking({
            tokens: newTokens,
            quantities: [bn('0'), bn('0')],
          })

          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Running auctions will trigger recollateralization - All token balance can be redeemed
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt = await toMinBuyAmt(sellAmt, fp('0.5'), fp('1'))
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, backupToken1.address, sellAmt, minBuyAmt)

          let auctionTimestamp = await getLatestBlockTimestamp()

          // Token0 -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: backupToken1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Perform Mock Bids (addr1 has balance)
          // Pay at fair price: 100 token0 -> 50 backupToken1
          await backupToken1.connect(addr1).approve(gnosis.address, sellAmt.div(2))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: sellAmt.div(2),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Run auctions - will end current, and will open a new auction to buy the remaining backup tokens
          const buyAmtBidRSR: BigNumber = issueAmount.div(2).add(1) // other half to buy
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, backupToken1.address, sellAmt, sellAmt.div(2)],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [anyValue, rsr.address, backupToken2.address, anyValue, buyAmtBidRSR],
              emitted: true,
            },
          ])

          auctionTimestamp = await getLatestBlockTimestamp()

          // Check new auction
          // RSR -> Backup Token 2
          await expectTrade(backingManager, {
            sell: rsr.address,
            buy: backupToken2.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('1'),
          })

          // Check backing changed
          await expectCurrentBacking({
            tokens: newTokens,
            quantities: [sellAmt.div(2), bn('0')],
          })

          const t = await getTrade(backingManager, rsr.address)
          const sellAmtRSR = await t.initBal()
          expect(await toMinBuyAmt(sellAmtRSR, fp('1'), fp('1'))).to.equal(buyAmtBidRSR.add(1))

          // Should have seized RSR
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount.sub(sellAmtRSR)) // Sent to market (auction)

          // Perform Mock Bids for RSR (addr1 has balance)
          // Assume fair price RSR = 1 get all of them
          await backupToken2.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
          await gnosis.placeBid(1, {
            bidder: addr1.address,
            sellAmount: sellAmtRSR,
            buyAmount: buyAmtBidRSR,
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, rsr.address, backupToken2.address, sellAmtRSR, buyAmtBidRSR],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
          ])

          // Check final state - All back to normal
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.add(1)
          )
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(issueAmount.div(2))
          expect(await backupToken2.balanceOf(backingManager.address)).to.equal(
            issueAmount.div(2).add(1)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check backing changed
          await expectCurrentBacking({
            tokens: newTokens,
            quantities: [issueAmount.div(2), issueAmount.div(2).add(1)],
          })

          // Check price in USD of the current RToken - Remains the same
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should use exceeding RSR in Backing Manager before seizing - Using RSR', async () => {
          // Set backing buffer to zero for simplification
          await backingManager.connect(owner).setBackingBuffer(0)

          // Register Collateral
          await assetRegistry.connect(owner).register(backupCollateral1.address)

          // Set backup configuration - USDT as backup
          await basketHandler
            .connect(owner)
            .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check stakes
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)

          // Set Token0 to default - 50% price reduction
          await setOraclePrice(collateral0.address, bn('0.5e8'))

          // Mark default as probable
          await assetRegistry.refresh()
          expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

          // Advance time post collateral's default delay
          await advanceTime((await collateral0.delayUntilDefault()).toString())

          // Confirm default and trigger basket switch
          await assetRegistry.refresh()
          await basketHandler.refreshBasket()

          // Advance time post warmup period - SOUND just regained
          await advanceTime(Number(config.warmupPeriod) + 1)

          // Running auctions will trigger recollateralization - All balance can be redeemed
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('0.5'), fp('1'))
          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(anyValue, token0.address, backupToken1.address, sellAmt, minBuyAmt)

          let auctionTimestamp = await getLatestBlockTimestamp()

          // Token0 -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: backupToken1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Perform Mock Bids (addr1 has balance)
          // Pay at fair price: no slippage
          await backupToken1.connect(addr1).approve(gnosis.address, sellAmt.div(2))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: sellAmt.div(2),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Run auctions - will end current, and will open a new auction to sell RSR for collateral
          // 50e18 Tokens left to buy - Sets Buy amount as independent value
          const buyAmtBidRSR: BigNumber = sellAmt.div(2).add(1)
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, token0.address, backupToken1.address, sellAmt, sellAmt.div(2)],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [anyValue, rsr.address, backupToken1.address, anyValue, buyAmtBidRSR],
              emitted: true,
            },
          ])

          auctionTimestamp = await getLatestBlockTimestamp()

          // Check new auction
          // RSR -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: rsr.address,
            buy: backupToken1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('1'),
          })

          const t = await getTrade(backingManager, rsr.address)
          const sellAmtRSR = await t.initBal()
          expect(await toMinBuyAmt(sellAmtRSR, fp('1'), fp('1'))).to.equal(buyAmtBidRSR.add(1))

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            sellAmt.div(2)
          ) // Reduced 50%
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(sellAmt.div(2))
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken - 1 with over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Should have seized RSR  - Nothing in backing manager so far
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount.sub(sellAmtRSR)) // Sent to market (auction)
          expect(await rsr.balanceOf(backingManager.address)).to.equal(0)

          // Settle auction with no bids - will return RSR to Backing Manager
          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, rsr.address, backupToken1.address, bn('0'), bn('0')],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [anyValue, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],

              emitted: true,
            },
          ])

          auctionTimestamp = await getLatestBlockTimestamp()

          // Check new auction
          // RSR -> Backup Token Auction
          await expectTrade(backingManager, {
            sell: rsr.address,
            buy: backupToken1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('2'),
          })

          // Funds were reused. No more seizures
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount.sub(sellAmtRSR)) // Sent to market (auction)

          // Perform Mock Bids (addr1 has balance)
          // Assume fair price, get all the RSR required
          await backupToken1.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
          await gnosis.placeBid(2, {
            bidder: addr1.address,
            sellAmount: sellAmtRSR,
            buyAmount: buyAmtBidRSR,
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // Run auctions again - Will close the pending auction
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [anyValue, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
              emitted: true,
            },
            { contract: backingManager, name: 'TradeStarted', emitted: false },
          ])

          // Check final state - All back to normal
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
            issueAmount.add(1) // 1 attoTokens accumulated
          )
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await backupToken1.balanceOf(backingManager.address)).to.equal(issueAmount.add(1))
          expect(await rToken.totalSupply()).to.equal(issueAmount.add(1)) // free minting

          // Check price in USD of the current RToken - Remains the same
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)
        })

        it('Should sell worthless asset when doing recollateralization - Use RSR directly for remainder', async () => {
          // Set prime basket
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

          // Switch Basket
          await expect(basketHandler.connect(owner).refreshBasket())
            .to.emit(basketHandler, 'BasketSet')
            .withArgs(3, [token1.address], [fp('1')], false)

          // Check state remains SOUND
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
          expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken -- retains price because of over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Trigger recollateralization
          const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
          const minBuyAmt: BigNumber = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))

          await expect(facadeTest.runAuctionsForAllTraders(rToken.address))
            .to.emit(backingManager, 'TradeStarted')
            .withArgs(
              anyValue,
              token0.address,
              token1.address,
              sellAmt,
              toBNDecimals(minBuyAmt, 6).add(1)
            )

          let auctionTimestamp: number = await getLatestBlockTimestamp()

          // Check auction registered
          // Token0 -> Token1 Auction
          await expectTrade(backingManager, {
            sell: token0.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('0'),
          })

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          // Asset value is zero, everything was moved to the Market
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(0)
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check price in USD of the current RToken -- retains price because of
          // over-collateralization
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Check Gnosis
          expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Get fair price - minBuyAmt
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6).add(1))
          await gnosis.placeBid(0, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: toBNDecimals(minBuyAmt, 6).add(1),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction, should start a new one to sell a new revenue token instead of RSR
          // But the revenue token will have price = 0 so it wont be sold, will use RSR
          // About 3e18 Tokens left to buy - Sets Buy amount as independent value
          const buyAmtBidRemToken: BigNumber = sellAmt.sub(minBuyAmt)

          // Send the excess revenue tokens to backing manager - should try to use it instead of RSR
          // But we set price = $0, so it wont be sold -Will use RSR for remainder
          await aaveToken.connect(owner).mint(backingManager.address, buyAmtBidRemToken.mul(2))

          // Make aaveToken worthless
          await setOraclePrice(aaveAsset.address, bn('0'))
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                token0.address,
                token1.address,
                sellAmt,
                toBNDecimals(minBuyAmt, 6).add(1),
              ],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              args: [
                anyValue,
                aaveToken.address,
                token1.address,
                anyValue,
                toBNDecimals(buyAmtBidRemToken, 6).add(1),
              ],
              emitted: true,
            },
          ])

          auctionTimestamp = await getLatestBlockTimestamp()

          // RSR Token -> Token1 Auction
          await expectTrade(backingManager, {
            sell: aaveToken.address,
            buy: token1.address,
            endTime: auctionTimestamp + Number(config.batchAuctionLength),
            externalId: bn('1'),
          })

          const t = await getTrade(backingManager, aaveToken.address)
          const sellAmtRemToken = await t.initBal()
          expect(toBNDecimals(buyAmtBidRemToken, 6).add(1)).to.equal(
            toBNDecimals(await toMinBuyAmt(sellAmtRemToken, fp('1'), fp('1')), 6).add(1)
          )

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(false)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(minBuyAmt, 6).add(1)
          )
          expect(await rToken.totalSupply()).to.equal(issueAmount)

          // Check Gnosis - using AAVE
          expect(await aaveToken.balanceOf(gnosis.address)).to.equal(sellAmtRemToken)

          // Perform Mock Bids for the new Token (addr1 has balance)
          // Cover buyAmtBidRevToken which is all the amount required
          await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmtRemToken, 6))
          await gnosis.placeBid(1, {
            bidder: addr1.address,
            sellAmount: sellAmtRemToken,
            buyAmount: toBNDecimals(buyAmtBidRemToken, 6).add(1),
          })

          // Advance time till auction ended
          await advanceTime(config.batchAuctionLength.add(100).toString())

          // End current auction
          await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
            {
              contract: backingManager,
              name: 'TradeSettled',
              args: [
                anyValue,
                aaveToken.address,
                token1.address,
                sellAmtRemToken,
                toBNDecimals(buyAmtBidRemToken, 6).add(1),
              ],
              emitted: true,
            },
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
          ])

          //  Check state - Order restablished
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          expect(await token0.balanceOf(backingManager.address)).to.equal(0)
          expect(await token1.balanceOf(backingManager.address)).to.equal(
            toBNDecimals(issueAmount, 6).add(1)
          )
          expect(await aaveToken.balanceOf(backingManager.address)).to.be.closeTo(bn('0'), 10000) // distributor leaves some
          expect(await rToken.totalSupply()).to.be.closeTo(issueAmount, fp('0.000001')) // we have a bit more

          // Check price in USD of the current RToken
          await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

          // Stakes used in this case
          expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
          expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)
        })
      })

      context('DutchTrade', () => {
        const auctionLength = 1800 // 30 minutes
        beforeEach(async () => {
          await broker.connect(owner).setDutchAuctionLength(auctionLength)

          // Set up rebalancing scenario
          await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])
          await basketHandler.refreshBasket()
        })

        it('Should not trade when paused', async () => {
          await main.connect(owner).pauseTrading()
          await expect(backingManager.rebalance(TradeKind.DUTCH_AUCTION)).to.be.revertedWith(
            'frozen or trading paused'
          )
        })

        it('Should not trade when frozen', async () => {
          await main.connect(owner).freezeLong()
          await expect(backingManager.rebalance(TradeKind.DUTCH_AUCTION)).to.be.revertedWith(
            'frozen or trading paused'
          )
        })

        it('Should trade if issuance paused', async () => {
          await main.connect(owner).pauseIssuance()
          await expect(backingManager.rebalance(TradeKind.DUTCH_AUCTION)).to.emit(
            backingManager,
            'TradeStarted'
          )
        })

        it('Should only run 1 trade at a time, including into the empty buffer block', async () => {
          await backingManager.rebalance(TradeKind.DUTCH_AUCTION)
          await expect(backingManager.rebalance(TradeKind.DUTCH_AUCTION)).to.be.revertedWith(
            'already rebalancing'
          )
          await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
            'trade open'
          )
        })

        it('Should quote piecewise-falling price correctly throughout entirety of auction', async () => {
          // Provide approval to router
          const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
          await token1.connect(addr1).approve(router.address, constants.MaxUint256)

          await backingManager.rebalance(TradeKind.DUTCH_AUCTION)
          const trade = await ethers.getContractAt(
            'DutchTrade',
            await backingManager.trades(token0.address)
          )
          await token1.connect(addr1).approve(trade.address, initialBal)

          const start = await trade.startTime()
          const end = await trade.endTime()

          let now = start
          while (now < end) {
            const actual = await trade.connect(addr1).bidAmount(now)
            const expected = divCeil(
              await dutchBuyAmount(
                fp(now - start).div(end - start),
                collateral1.address,
                collateral0.address,
                issueAmount,
                config.maxTradeSlippage
              ),
              bn('1e12')
            )
            expect(actual).to.be.closeTo(expected, expected.div(bn('1e15')))

            const staticResult = await router
              .connect(addr1)
              .callStatic.bid(trade.address, addr1.address)
            expect(staticResult.buyAmt).to.equal(actual)
            await advanceToTimestamp(now + 12)
            now = await getLatestBlockTimestamp()
          }
        })

        it('Should handle no bid case correctly', async () => {
          const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
          await token1.connect(addr1).approve(router.address, constants.MaxUint256)
          await backingManager.rebalance(TradeKind.DUTCH_AUCTION)
          const trade = await ethers.getContractAt(
            'DutchTrade',
            await backingManager.trades(token0.address)
          )
          await token1.connect(addr1).approve(trade.address, initialBal)
          await advanceToTimestamp((await trade.endTime()) + 1)
          await expect(
            trade.connect(addr1).bidAmount(await getLatestBlockTimestamp())
          ).to.be.revertedWith('auction over')
          await expect(router.connect(addr1).bid(trade.address, addr1.address)).be.revertedWith(
            'auction over'
          )
          // Should be able to settle
          await expect(trade.settle()).to.be.revertedWith('only origin can settle')
          await expect(backingManager.settleTrade(token0.address))
            .to.emit(backingManager, 'TradeSettled')
            .withArgs(trade.address, token0.address, token1.address, 0, 0)

          // Should NOT start another auction, since caller was not DutchTrade
          expect(await backingManager.tradesOpen()).to.equal(0)
        })

        context('Should successfully recollateralize after default', () => {
          let trade1: DutchTrade // token0 -> token1
          let trade2: DutchTrade // RSR -> token1
          let router: DutchTradeRouter
          beforeEach(async () => {
            router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
            await token0.connect(addr1).approve(router.address, constants.MaxUint256)
            await token1.connect(addr1).approve(router.address, constants.MaxUint256)
            await backingManager.rebalance(TradeKind.DUTCH_AUCTION)
            trade1 = await ethers.getContractAt(
              'DutchTrade',
              await backingManager.trades(token0.address)
            )
            await token1.connect(addr1).approve(trade1.address, initialBal)

            // Snipe auction at 0s left

            await advanceToTimestamp((await trade1.endTime()) - 1)

            await router.connect(addr1).bid(trade1.address, addr1.address)
            expect(await trade1.canSettle()).to.equal(false)
            expect(await trade1.status()).to.equal(2) // Status.CLOSED
            expect(await trade1.bidder()).to.equal(router.address)
            expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)

            const expected = divCeil(
              await dutchBuyAmount(
                fp('1'), // last block
                collateral0.address,
                collateral1.address,
                issueAmount,
                config.maxTradeSlippage
              ),
              bn('1e12') // decimals
            )
            expect(await backingManager.tradesOpen()).to.equal(1)
            expect(await token1.balanceOf(backingManager.address)).to.equal(expected)

            // Should launch RSR recapitalization auction to fill ~3%
            expect(await backingManager.trades(token0.address)).to.equal(ZERO_ADDRESS)
            trade2 = await ethers.getContractAt(
              'DutchTrade',
              await backingManager.trades(rsr.address)
            )
            expect(trade2.address).to.not.equal(ZERO_ADDRESS)
          })

          afterEach(async () => {
            // Should be fully capitalized again
            expect(await basketHandler.fullyCollateralized()).to.equal(true)
            expect(await backingManager.tradesOpen()).to.equal(0)
          })

          it('even under worst-possible bids', async () => {
            await token1.connect(addr1).approve(trade2.address, initialBal)

            // Advance to final block of auction
            await advanceToTimestamp((await trade2.endTime()) - 1)
            expect(await trade2.status()).to.equal(1) // TradeStatus.OPEN
            expect(await trade2.canSettle()).to.equal(false)

            // Bid + settle RSR auction

            await expect(await router.connect(addr1).bid(trade2.address, addr1.address)).to.emit(
              backingManager,
              'TradeSettled'
            )
          })

          it('via fallback to Batch Auction', async () => {
            // Advance past auction end block
            await advanceToTimestamp((await trade2.endTime()) + 1)
            expect(await trade2.status()).to.equal(1) // TradeStatus.OPEN
            expect(await trade2.canSettle()).to.equal(true)

            // Settle trade
            await backingManager.settleTrade(rsr.address)
            expect(await backingManager.tradesOpen()).to.equal(0)
            expect(await rsr.balanceOf(trade2.address)).to.equal(0)
            expect(await token0.balanceOf(trade2.address)).to.equal(0)
            expect(await token1.balanceOf(trade2.address)).to.equal(0)

            // BATCH_AUCTION can be launched
            await backingManager.rebalance(TradeKind.BATCH_AUCTION)
            expect(await backingManager.tradesOpen()).to.equal(1)

            // Bid in Gnosis
            const t = await getTrade(backingManager, rsr.address)
            const sellAmt = await t.initBal()
            const minBuyAmt = await toMinBuyAmt(sellAmt, fp('1'), fp('1'))
            expect(await t.KIND()).to.equal(TradeKind.BATCH_AUCTION)
            await token1.connect(addr1).approve(gnosis.address, minBuyAmt)
            await gnosis.placeBid(0, {
              bidder: addr1.address,
              sellAmount: sellAmt,
              buyAmount: minBuyAmt,
            })
            await advanceTime(config.batchAuctionLength.toNumber())
            await expect(backingManager.settleTrade(rsr.address)).not.to.emit(
              backingManager,
              'TradeStarted'
            )
          })
        })
      })
    })

    context('With issued Rtokens', function () {
      let issueAmount: BigNumber
      let initialTokens: string[]
      let initialQuantities: BigNumber[]
      let initialQuotes: BigNumber[]
      let quotes: BigNumber[]

      beforeEach(async function () {
        issueAmount = bn('100e18')
        initialQuotes = [bn('0.25e18'), bn('0.25e6'), bn('0.25e18'), bn('1.25e9')]
        initialQuantities = initialQuotes.map((q) => {
          return q.mul(issueAmount).div(BN_SCALE_FACTOR)
        })

        initialTokens = await Promise.all(
          basket.map(async (c): Promise<string> => {
            return await c.erc20()
          })
        )

        // Set backing buffer to zero for simplification
        await backingManager.connect(owner).setMaxTradeSlippage(0)
        await backingManager.connect(owner).setBackingBuffer(0)

        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)
        await backupToken1.connect(addr1).approve(rToken.address, initialBal)
        await backupToken2.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should recollateralize correctly in case of default - Using RSR', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        // Hmm this comment says USDT, but the tests have been set up to expect a token with 18 decimals,
        // but it's too late for me to change this everywhere...
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Perform stake
        const stakeAmount: BigNumber = bn('100e18')
        await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
        await stRSR.connect(addr1).stake(stakeAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmount)

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)

        // Set Token2 to hard default - Reducing rate
        await token2.setExchangeRate(fp('0.99'))

        // Confirm default and ensure valid basket
        const newTokens = [
          initialTokens[0],
          initialTokens[1],
          initialTokens[3],
          backupToken1.address,
        ]
        const newQuantities = [
          initialQuantities[0],
          initialQuantities[1],
          initialQuantities[3],
          bn('0'),
        ]
        const newQuotes = [initialQuotes[0], initialQuotes[1], initialQuotes[3], bn('0.25e18')]
        const newRefAmounts = [
          basketsNeededAmts[0],
          basketsNeededAmts[1],
          basketsNeededAmts[3],
          bn('0.25e18'),
        ]

        // Mark Default - Perform basket switch
        await assetRegistry.refresh()
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, newRefAmounts, false)

        // Advance time post warmup period - SOUND just regained
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(fp('99.75')) // 1% loss for 1 of the 4 tokens
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken - because of RSR stake is worth full $1
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recollateralization - All balance will be redeemed
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)
        const minBuyAmt2 = await toMinBuyAmt(sellAmt2, fp('0.99'), fp('1'))

        // Run auctions
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [
              anyValue,
              token2.address,
              backupToken1.address,
              sellAmt2,
              withinTolerance(minBuyAmt2),
            ],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token2 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
          backingManager,
          'TradeStarted'
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume maximally slipped price, 25 token2 -> a bit less than 24.75 backupToken1
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: minBuyAmt2,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // End current auction, should start a new one to sell RSR for collateral
        // ~0.25 Tokens left to buy - Sets Buy amount as independent value
        const buyAmtBidRSR: BigNumber = sellAmt2.sub(minBuyAmt2).add(1)

        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, rsr.address, backupToken1.address, anyValue, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check state - After first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.div(4).mul(3).add(minBuyAmt2)
        ) // 75 base value + max slippage on a trade for 24.75
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], newQuantities[1], newQuantities[2], minBuyAmt2],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt2)

        const t = await getTrade(backingManager, rsr.address)
        const sellAmtRSR = await t.initBal()
        expect(await toMinBuyAmt(sellAmtRSR, fp('1'), fp('1'))).to.equal(buyAmtBidRSR)

        // Should have seized RSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stakeAmount.sub(sellAmtRSR)) // Sent to market (auction)

        // Perform Mock Bids for RSR (addr1 has balance)
        // Assume fair price RSR = 1 get all of them
        await backupToken1.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR,
          buyAmount: buyAmtBidRSR,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // End current auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check final state - All back to normal
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.add(1)
        ) // 1 attoUoA more, fine

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0],
            newQuantities[1],
            newQuantities[2],
            minBuyAmt2.add(buyAmtBidRSR),
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken - Remains the same
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt2.add(buyAmtBidRSR)
        )
        expect(await token2.balanceOf(backingManager.address)).to.equal(0)
      })

      it('Should recollateralize correctly in case of default - Taking Haircut - Single backup token', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Set Token0 to default - 20% price reduction - Will also default tokens 2 and 3
        await setOraclePrice(collateral0.address, bn('0.8e8'))

        // Mark default as probable
        await assetRegistry.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default and ensure valid basket
        const newTokens = [initialTokens[1], backupToken1.address]
        const newQuantities = [initialQuantities[1], bn('0')]
        const newQuotes = [initialQuotes[1], bn('0.75e18')]
        const newRefAmounts = [basketsNeededAmts[1], bn('0.75e18')]

        // Perform basket switch
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, newRefAmounts, false)

        // Advance time post warmup period - SOUND just regained
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        const initialAssetValue = await facadeTest.callStatic.totalAssetValue(rToken.address)
        expect(initialAssetValue).to.equal(fp('85')) // 20% loss for 3 of the 4 collateral
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('0.85'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recollateralization - All balance will be redeemed
        const sellAmt0: BigNumber = await token0.balanceOf(backingManager.address)
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)
        const sellAmt3: BigNumber = (await token3.balanceOf(backingManager.address)).mul(pow10(10)) // convert to 18 decimals for simplification
        const minBuyAmt0 = await toMinBuyAmt(sellAmt0, fp('0.8'), fp('1'))

        // Run auctions - Will start with token0
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token0.address, backupToken1.address, sellAmt0, minBuyAmt0],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facadeTest.runAuctionsForAllTraders(rToken.address)).to.not.emit(
          backingManager,
          'TradeStarted'
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt0)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt0,
          buyAmount: minBuyAmt0,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction for another token
        const minBuyAmt2 = await toMinBuyAmt(sellAmt2, fp('0.8'), fp('1'))
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token0.address, backupToken1.address, sellAmt0, minBuyAmt0],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token2 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check state after first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], minBuyAmt0],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt0)

        // Perform Mock Bids for the new Token (addr1 has balance)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: minBuyAmt2,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        const minBuyAmt3 = await toMinBuyAmt(sellAmt3, fp('0.8').div(50), fp('1'))
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [
              anyValue,
              token3.address,
              backupToken1.address,
              toBNDecimals(sellAmt3, 8),
              minBuyAmt3,
            ],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token3 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token3.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('2'),
        })

        // Check state after second auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], minBuyAmt0.add(minBuyAmt2)],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt2)
        )

        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt3)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: toBNDecimals(sellAmt3, 8),
          buyAmount: minBuyAmt3,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction with the rebalancing
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [
              anyValue,
              token3.address,
              backupToken1.address,
              toBNDecimals(sellAmt3, 8),
              minBuyAmt3,
            ],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token1.address, backupToken1.address, anyValue, anyValue],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token1 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token1.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('3'),
        })
        const t = await getTrade(backingManager, token1.address)
        const sellAmt4 = await t.initBal() // 6 decimals token
        const minBuyAmt4 = await toMinBuyAmt(
          sellAmt4.add(1).mul(bn('1e12')), // because of decimals difference
          fp('1'),
          fp('1')
        )

        // Check state after third auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0].sub(sellAmt4), minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3)],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3)
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt4)
        await gnosis.placeBid(3, {
          bidder: addr1.address,
          sellAmount: sellAmt4,
          buyAmount: minBuyAmt4,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close 2nd to final auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token1.address, backupToken1.address, sellAmt4, minBuyAmt4],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token1.address, backupToken1.address, anyValue, anyValue],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token1 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token1.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('4'),
        })
        const t2 = await getTrade(backingManager, token1.address)
        const sellAmt5 = await t2.initBal() // 6 decimals token
        const minBuyAmt5 = await toMinBuyAmt(
          sellAmt5.mul(bn('1e12')), // because of decimals difference
          fp('1'),
          fp('1')
        )

        // Check state after third auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3).add(minBuyAmt4)
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt5)
        await gnosis.placeBid(4, {
          bidder: addr1.address,
          sellAmount: sellAmt5,
          buyAmount: minBuyAmt5,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close final auction - should take haircut
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token1.address, backupToken1.address, sellAmt5, minBuyAmt5],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check final state - Haircut taken, stable but price of RToken has been reduced
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)

        const expAmount = issueAmount
          .div(4)
          .add(minBuyAmt0)
          .add(minBuyAmt2)
          .add(minBuyAmt3)
          .sub(sellAmt4.mul(bn('1e12')).sub(minBuyAmt4))
          .sub(sellAmt5.mul(bn('1e12')).sub(minBuyAmt5))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          expAmount,
          expAmount.div(bn('5e3')) // 1 part in 5000
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        // Without slippage (not this test), haircut of 15.02%
        // With slippage (this test), haircut of ~16.38%
        const newPrice = fp('0.83721')
        // const newPrice = fp('0.82133')
        await expectRTokenPrice(rTokenAsset.address, newPrice, ORACLE_ERROR)

        // Check quotes - reduced by 15.01% as well (less collateral is required to match the new price)
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        const finalQuotes = newQuotes.map((q) => {
          return q.mul(newPrice).div(fp('1'))
        })
        expect(quotes[0]).to.be.closeTo(finalQuotes[0], finalQuotes[0].div(bn('1e5'))) // 1 part in 100k
        expect(quotes[1]).to.be.closeTo(finalQuotes[1], finalQuotes[1].div(bn('1e5'))) // 1 part in 100k

        // Check Backup tokens available
        const backup1 = minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3).add(minBuyAmt4).add(minBuyAmt5)
        expect(await backupToken1.balanceOf(backingManager.address)).to.be.closeTo(
          backup1,
          backup1.div(bn('1e5'))
        )
      })

      it('Should recollateralize correctly - Handles surplus selection - Basket switch', async () => {
        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        //  Leave only token0 in the basket, adjust weights
        await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])

        // Confirm default and ensure valid basket
        const newTokens = [initialTokens[0]]
        const newQuantities = [initialQuantities[0]]
        const newQuotes = [bn('1e18')]
        const newRefAmounts = [bn('1e18')]

        // Perform basket switch
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, newRefAmounts, false)

        // Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        const initialAssetValue = await facadeTest.callStatic.totalAssetValue(rToken.address)
        expect(initialAssetValue).to.equal(fp('100')) // No loss of value
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Add some additional token2 to get it selected for recollateralization
        await token2.connect(owner).mint(backingManager.address, bn('10e18'))

        // Add a little bit less of token1 so it gets selected after
        await token1.connect(owner).mint(backingManager.address, bn('5e6'))

        // Running auctions will trigger recollateralization - All balance will be redeemed
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)
        const minBuyAmt2 = await toMinBuyAmt(sellAmt2, fp('1'), fp('1'))

        // Run auctions - Will start with token0
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token2.address, token0.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token2 -> Token0 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: token0.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Perform Mock Bids for the new Token (addr1 has balance)
        await token0.connect(addr1).approve(gnosis.address, minBuyAmt2)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: minBuyAmt2,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction for token1
        const sellAmt1: BigNumber = (await token1.balanceOf(backingManager.address)).mul(pow10(12)) // convert to 18 decimals
        const minBuyAmt1 = await toMinBuyAmt(sellAmt1, fp('1'), fp('1'))
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token2.address, token0.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token1.address, token0.address, toBNDecimals(sellAmt1, 6), minBuyAmt1],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token1 -> Token0 Auction
        await expectTrade(backingManager, {
          sell: token1.address,
          buy: token0.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check state after first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0].add(minBuyAmt2)],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Perform Mock Bids (addr1 has balance)
        await token0.connect(addr1).approve(gnosis.address, minBuyAmt1)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: toBNDecimals(sellAmt1, 6),
          buyAmount: minBuyAmt1,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction for token3
        // We only need now about 11.8 tokens for Token0 to be fully collateralized
        // Will check values later in the test to ensure they are in this range
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token1.address, token0.address, toBNDecimals(sellAmt1, 6), minBuyAmt1],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token3 -> Token0 Auction
        await expectTrade(backingManager, {
          sell: token3.address,
          buy: token0.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('2'),
        })

        // Get Trade
        const t3 = await getTrade(backingManager, token3.address)
        const sellAmt3 = (await t3.initBal()).mul(pow10(10)) // convert to 18 decimals
        let minBuyAmt3 = await toMinBuyAmt(sellAmt3, fp('1').div(50), fp('1'))
        expect(minBuyAmt3).to.be.closeTo(fp('11.28'), fp('0.01'))

        minBuyAmt3 = minBuyAmt3.add(fp('0.01')) // add some extra tokens to ensure minBuyAmt

        // Check state after second auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0].add(minBuyAmt2).add(minBuyAmt1)],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        await token0.connect(addr1).approve(gnosis.address, minBuyAmt3)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: toBNDecimals(sellAmt3, 8),
          buyAmount: minBuyAmt3,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close final auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token3.address, token0.address, toBNDecimals(sellAmt3, 8), minBuyAmt3],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check final state - Order restablished
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0].add(minBuyAmt2).add(minBuyAmt1).add(minBuyAmt3)],
        })

        expect(await rToken.totalSupply()).to.be.closeTo(issueAmount, fp('0.01')) // have a little extra

        // Check price in USD of the current RToken
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('1'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )
      })

      it('Should recollateralize correctly in case of default - Taking Haircut - Multiple Backup tokens', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)
        await assetRegistry.connect(owner).register(backupCollateral2.address)

        // Set backup configuration - USDT and aUSDT backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            backupToken1.address,
            backupToken2.address,
          ])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(rTokenAsset.address, fp('1'), ORACLE_ERROR)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Set Token0 to default - 50% price reduction - Will also default tokens 2 and 3
        await setOraclePrice(collateral0.address, bn('0.5e8'))

        // 3 of the 4 half-defaulted, 62.5% left
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(fp('62.5'))

        // Mark default as probable
        await assetRegistry.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default and ensure valid basket
        const newTokens = [initialTokens[1], backupToken1.address, backupToken2.address]
        const newQuantities = [initialQuantities[1], bn('0'), bn('0')]
        const newQuotes = [initialQuotes[1], bn('0.375e18'), bn('0.375e18')]
        const newRefAmounts = [basketsNeededAmts[1], bn('0.375e18'), bn('0.375e18')]

        // Perform basket switch
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(2, newTokens, newRefAmounts, false)

        // Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('0.625'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        // Advance time post warmup period - SOUND just regained
        await advanceTime(Number(config.warmupPeriod) + 1)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recollateralization - All balance will be redeemed
        const sellAmt0: BigNumber = await token0.balanceOf(backingManager.address)
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)
        const sellAmt3: BigNumber = (await token3.balanceOf(backingManager.address)).mul(pow10(10)) // convert to 18 decimals for simplification

        // Run auctions - will start with token0 and backuptoken1
        const minBuyAmt = await toMinBuyAmt(sellAmt0, fp('0.5'), fp('1'))
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token0.address, backupToken1.address, sellAmt0, minBuyAmt],
            emitted: true,
          },
        ])

        // Check price in USD of the current RToken - should track the capital out on auction
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('0.625'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('0'),
        })

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Pay at fair price: 25 token0 -> 12.5 backupToken1
        await backupToken1.connect(addr1).approve(gnosis.address, sellAmt0.div(2))
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt0,
          buyAmount: sellAmt0.div(2),
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token0.address, backupToken1.address, sellAmt0, sellAmt0.div(2)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token2.address, backupToken2.address, sellAmt2, minBuyAmt],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token2 -> Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('1'),
        })

        // Check state after first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], sellAmt0.div(2), bn('0')],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          fp('62.5').sub(sellAmt2.div(2))
        )

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(sellAmt0.div(2))
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Pay at fair price: 25 token2 -> 12.5 backupToken2
        await backupToken2.connect(addr1).approve(gnosis.address, sellAmt2.div(2))
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: sellAmt2.div(2),
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        const minBuyAmt3: BigNumber = await toMinBuyAmt(sellAmt3, fp('0.5').div(50), fp('1')) // sell cToken
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token2.address, backupToken2.address, sellAmt2, sellAmt2.div(2)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [
              anyValue,
              token3.address,
              backupToken1.address,
              toBNDecimals(sellAmt3, 8),
              minBuyAmt3,
            ],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token3 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token3.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('2'),
        })

        //  Check state after second auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          fp('62.5').sub(sellAmt3.div(50).div(2))
        )

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], sellAmt0.div(2), sellAmt2.div(2)],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(sellAmt0.div(2)) // 12.5
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(sellAmt2.div(2)) // 12.5

        // Pay at fair price: 25 (cToken equivalent) -> 12.5 backupToken2
        await backupToken1.connect(addr1).approve(gnosis.address, sellAmt3.div(2))
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: toBNDecimals(sellAmt3, 8),
          buyAmount: sellAmt3.div(50).div(2),
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        // We need to rebalance our backing, we have an excess of Token1 now and we need more backupToken2
        // All can be allocated to backup token 2
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [
              anyValue,
              token3.address,
              backupToken1.address,
              toBNDecimals(sellAmt3, 8),
              sellAmt3.div(50).div(2),
            ],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token1.address, backupToken2.address, anyValue, anyValue],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token1 -> Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: token1.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('3'),
        })

        const t = await getTrade(backingManager, token1.address)
        const sellAmt4 = await t.initBal() // 6 decimals
        const buyAmt4 = sellAmt4.mul(bn('1e12'))

        // Check state after third auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          fp('62.5').sub(buyAmt4)
        )
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0].sub(sellAmt4),
            sellAmt0.div(2).add(sellAmt3.div(50).div(2)),
            sellAmt2.div(2),
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          sellAmt0.div(2).add(sellAmt3.div(50).div(2))
        )
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(sellAmt2.div(2))

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken2.connect(addr1).approve(gnosis.address, buyAmt4)
        await gnosis.placeBid(3, {
          bidder: addr1.address,
          sellAmount: sellAmt4,
          buyAmount: buyAmt4,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token1.address, backupToken2.address, sellAmt4, buyAmt4],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, backupToken1.address, backupToken2.address, anyValue, anyValue],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Backup Token 1 ->  Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: backupToken1.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('4'),
        })

        const t1 = await getTrade(backingManager, backupToken1.address)
        const sellAmtRebalance = await t1.initBal()

        // Check state after fourth auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0].sub(sellAmt4),
            sellAmt0.div(2).add(sellAmt3.div(50).div(2)).sub(sellAmtRebalance),
            sellAmt2.div(2).add(buyAmt4),
          ],
        })
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          fp('62.5').sub(sellAmtRebalance)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          sellAmt0.div(2).add(sellAmt3.div(50).div(2)).sub(sellAmtRebalance)
        )
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(
          sellAmt2.div(2).add(buyAmt4)
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken2.connect(addr1).approve(gnosis.address, sellAmtRebalance)
        await gnosis.placeBid(4, {
          bidder: addr1.address,
          sellAmount: sellAmtRebalance,
          buyAmount: sellAmtRebalance,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close auction
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [
              anyValue,
              backupToken1.address,
              backupToken2.address,
              sellAmtRebalance,
              sellAmtRebalance,
            ],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, token1.address, backupToken2.address, anyValue, anyValue],
            emitted: true,
          },
        ])

        const t2 = await getTrade(backingManager, token1.address)
        const sellAmt5 = await t2.initBal()
        const minBuyAmt5 = sellAmt5.mul(bn('1e12')) // because decimals

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token 1 ->  Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: token1.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('5'),
        })

        // Check state after fifth auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmt5)
        await gnosis.placeBid(5, {
          bidder: addr1.address,
          sellAmount: sellAmt5,
          buyAmount: minBuyAmt5,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close final auction - takes haircut
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [anyValue, token1.address, backupToken2.address, sellAmt5, minBuyAmt5],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [anyValue, backupToken1.address, backupToken2.address, anyValue, anyValue],
            emitted: true,
          },
        ])

        const t3 = await getTrade(backingManager, backupToken1.address)
        const sellAmtRebalance2 = await t3.initBal()

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Backup Token 1 ->  Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: backupToken1.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.batchAuctionLength),
          externalId: bn('6'),
        })

        // Check state after sixth auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(false)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check quotes
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken2.connect(addr1).approve(gnosis.address, sellAmtRebalance2)
        await gnosis.placeBid(6, {
          bidder: addr1.address,
          sellAmount: sellAmtRebalance2,
          buyAmount: sellAmtRebalance2,
        })

        // Advance time till auction ended
        await advanceTime(config.batchAuctionLength.add(100).toString())

        // Close final auction - takes haircut
        await expectEvents(facadeTest.runAuctionsForAllTraders(rToken.address), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [
              anyValue,
              backupToken1.address,
              backupToken2.address,
              sellAmtRebalance2,
              sellAmtRebalance2,
            ],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
          {
            contract: rToken,
            name: 'BasketsNeededChanged',
            emitted: true,
          },
        ])

        // Check final state - Haircut taken, stable but price of RToken has been reduced
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)

        // Check price in USD of the current RToken - Haircut of ~37.52% taken
        // The default was for 37.5% of backing, so this is pretty awesome
        const exactRTokenPrice = fp('0.62488525484848490000')
        const totalAssetValue = issueAmount.mul(exactRTokenPrice).div(fp('1'))
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
          totalAssetValue,
          totalAssetValue.div(bn('1e6'))
        )

        expect(await rToken.totalSupply()).to.equal(issueAmount)
        await expectRTokenPrice(
          rTokenAsset.address,
          exactRTokenPrice,
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )

        // Check quotes - reduced by ~38.15% as well (less collateral is required to match the new price)
        ;[, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e18'))
        for (const q of newQuotes) {
          const expected = divCeil(q.mul(exactRTokenPrice), fp('1'))
          expect(expected).to.be.closeTo(expected, 100)
        }

        // Check Backup tokens available
        const expBackup1 = sellAmt0
          .div(2)
          .add(sellAmt3.div(50).div(2))
          .sub(sellAmtRebalance)
          .sub(sellAmtRebalance2)
        expect(await backupToken1.balanceOf(backingManager.address)).to.be.closeTo(
          expBackup1,
          expBackup1.div(bn('1e3')) // 1 part in a thousand
        )
        const expBackup2 = sellAmt2
          .div(2)
          .add(buyAmt4)
          .add(sellAmtRebalance)
          .add(minBuyAmt5)
          .add(sellAmtRebalance2)
        expect(await backupToken2.balanceOf(backingManager.address)).to.be.closeTo(
          expBackup2,
          expBackup2.div(bn('1e3')) // 1 part in a thousand
        )
      })
    })
  })

  describeGas('Gas Reporting', () => {
    let issueAmount: BigNumber

    beforeEach(async function () {
      issueAmount = bn('100e18')

      // Set backing buffer and max slippage to zero for simplification
      await backingManager.connect(owner).setMaxTradeSlippage(0)
      await backingManager.connect(owner).setBackingBuffer(0)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)
      await backupToken1.connect(addr1).approve(rToken.address, initialBal)
      await backupToken2.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Send BackingManager with nonzero RToken balance to incur maximum gas costs
      await rToken.connect(addr1).transfer(backingManager.address, 1000)

      // Mint some RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)
    })

    it('rebalance() - GnosisTrade ', async () => {
      // Register Collateral
      await assetRegistry.connect(owner).register(backupCollateral1.address)
      await assetRegistry.connect(owner).register(backupCollateral2.address)

      // Set backup configuration - USDT and aUSDT as backup
      await basketHandler
        .connect(owner)
        .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
          backupToken1.address,
          backupToken2.address,
        ])

      // Perform stake
      const stakeAmount: BigNumber = bn('10000e18')
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)

      // Set Token2 to hard default - Reducing rate
      await token2.setExchangeRate(fp('0.99'))

      const bkpTokenRefAmt: BigNumber = bn('0.125e18')

      // Mark Default - Perform basket switch
      await assetRegistry.refresh()
      await expect(basketHandler.refreshBasket()).to.emit(basketHandler, 'BasketSet')
      await advanceTime(config.tradingDelay.toNumber())
      await advanceTime(config.warmupPeriod.toNumber())
      await advanceTime(config.batchAuctionLength.toNumber())

      // Run auctions - First Settle trades then Manage Funds
      // Will sell all balance of token2
      const sellAmt2 = await token2.balanceOf(backingManager.address)
      await expect(backingManager.settleTrade(token2.address)).to.be.revertedWith('no trade open')
      await snapshotGasCost(backingManager.rebalance(TradeKind.BATCH_AUCTION))

      // Another call should not create any new auctions if still ongoing
      await expect(backingManager.settleTrade(token2.address)).to.be.revertedWith(
        'cannot settle yet'
      )

      // Perform Mock Bids for the new Token (addr1 has balance)
      // Get minBuyAmt, we will have now surplus of backupToken1
      const minBuyAmt2 = await toMinBuyAmt(sellAmt2, fp('0.99'), fp('1'))
      await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmt2,
        buyAmount: minBuyAmt2,
      })

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction, should start a new one to sell the new surplus of Backup Token 1
      const requiredBkpToken: BigNumber = issueAmount.mul(bkpTokenRefAmt).div(BN_SCALE_FACTOR)
      const sellAmtBkp1: BigNumber = minBuyAmt2.sub(requiredBkpToken)
      const minBuyAmtBkp1: BigNumber = await toMinBuyAmt(sellAmtBkp1, fp('1'), fp('1'))

      // Run auctions - First Settle trades then Manage Funds
      await snapshotGasCost(backingManager.settleTrade(token2.address))
      await advanceTime(12)
      await snapshotGasCost(backingManager.rebalance(TradeKind.BATCH_AUCTION))

      // Perform Mock Bids for the new Token (addr1 has balance)
      // Assume fair price, get all of them
      await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmtBkp1)
      await gnosis.placeBid(1, {
        bidder: addr1.address,
        sellAmount: sellAmtBkp1,
        buyAmount: minBuyAmtBkp1,
      })

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      // End current auction, should start a new one to sell RSR for collateral
      const buyAmtBidRSR: BigNumber = requiredBkpToken.sub(minBuyAmtBkp1)
      const sellAmtRSR: BigNumber = buyAmtBidRSR // approximation

      // Run auctions - First Settle trades then Manage Funds
      await snapshotGasCost(backingManager.settleTrade(backupToken1.address))
      await advanceTime(12)
      await snapshotGasCost(backingManager.rebalance(TradeKind.BATCH_AUCTION))

      // Perform Mock Bids for RSR (addr1 has balance)
      // Assume fair price RSR = 1 get all of them - Leave a surplus of RSR to be returned
      await backupToken2.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
      await gnosis.placeBid(2, {
        bidder: addr1.address,
        sellAmount: sellAmtRSR.sub(1000),
        buyAmount: buyAmtBidRSR,
      })

      // Advance time till auction ended
      await advanceTime(config.batchAuctionLength.add(100).toString())

      expect(await backingManager.tradesOpen()).to.equal(1)
      // End current auction
      await snapshotGasCost(backingManager.settleTrade(rsr.address))
      expect(await backingManager.tradesOpen()).to.equal(0)
    })

    it('rebalance() - DutchTrade ', async () => {
      const router = await (await ethers.getContractFactory('DutchTradeRouter')).deploy()
      // Register Collateral
      await assetRegistry.connect(owner).register(backupCollateral1.address)

      // Set backup configuration - USDT and aUSDT as backup
      await basketHandler
        .connect(owner)
        .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

      // Perform stake
      const stakeAmount: BigNumber = bn('10000e18')
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)

      // Set Token2 to hard default - Reducing rate
      await token2.setExchangeRate(fp('0.25'))

      // Mark Default - Perform basket switch
      await assetRegistry.refresh()
      await expect(basketHandler.refreshBasket()).to.emit(basketHandler, 'BasketSet')
      await advanceTime(config.tradingDelay.toNumber())
      await advanceTime(config.warmupPeriod.toNumber())
      await advanceTime(config.dutchAuctionLength.toNumber())

      // Run auctions - First Settle trades then Manage Funds
      // Will sell all balance of token2
      await expect(backingManager.settleTrade(token2.address)).to.be.revertedWith('no trade open')
      await snapshotGasCost(backingManager.rebalance(TradeKind.DUTCH_AUCTION))
      expect(await backingManager.tradesOpen()).to.equal(1)

      // Another call should not create any new auctions if still ongoing
      await expect(backingManager.settleTrade(token2.address)).to.be.revertedWith(
        'cannot settle yet'
      )

      // Bid + settle DutchTrade in final block at floor price
      let tradeAddr = await backingManager.trades(token2.address)
      let trade = await ethers.getContractAt('DutchTrade', tradeAddr)
      await backupToken1.connect(addr1).approve(trade.address, initialBal)
      await advanceToTimestamp((await trade.endTime()) - 1)

      await snapshotGasCost(await router.connect(addr1).bid(trade.address, addr1.address))

      // Expect new trade started -- bid in last block
      expect(await backingManager.tradesOpen()).to.equal(1)
      expect(await backingManager.trades(token2.address)).to.equal(ZERO_ADDRESS)
      expect(await backingManager.trades(rsr.address)).to.not.equal(ZERO_ADDRESS)
      tradeAddr = await backingManager.trades(rsr.address)
      trade = await ethers.getContractAt('DutchTrade', tradeAddr)
      await backupToken1.connect(addr1).approve(trade.address, initialBal)
      await snapshotGasCost(await router.connect(addr1).bid(trade.address, addr1.address))

      // No new trade
      expect(await backingManager.tradesOpen()).to.equal(0)
      expect(await backingManager.trades(token2.address)).to.equal(ZERO_ADDRESS)
      expect(await backingManager.trades(rsr.address)).equal(ZERO_ADDRESS)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
    })
  })
})

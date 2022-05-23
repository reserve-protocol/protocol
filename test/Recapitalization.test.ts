import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { BN_SCALE_FACTOR, CollateralStatus } from '../common/constants'
import { expectEvents } from '../common/events'
import { bn, fp, pow10, toBNDecimals } from '../common/numbers'
import {
  AaveLendingPoolMock,
  AaveOracleMock,
  CompoundOracleMock,
  ComptrollerMock,
  CTokenMock,
  ERC20Mock,
  Facade,
  GnosisMock,
  IBasketHandler,
  StaticATokenMock,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIRToken,
  TestIStRSR,
  USDCMock,
} from '../typechain'
import { advanceTime, getLatestBlockTimestamp } from './utils/time'
import { Collateral, defaultFixture, IConfig, Implementation, IMPLEMENTATION } from './fixtures'
import snapshotGasCost from './utils/snapshotGasCost'
import { expectTrade } from './utils/trades'

const createFixtureLoader = waffle.createFixtureLoader

const describeGas =
  IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS ? describe : describe.skip

describe(`Recapitalization - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let compoundMock: ComptrollerMock
  let compoundOracleInternal: CompoundOracleMock
  let aaveToken: ERC20Mock
  let aaveMock: AaveLendingPoolMock
  let aaveOracleInternal: AaveOracleMock

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
  let backupToken3: ERC20Mock
  let backupToken4: ERC20Mock
  let collateral0: Collateral
  let collateral1: Collateral
  // let collateral2: ATokenFiatCollateral
  // let collateral3: CTokenFiatCollateral
  let backupCollateral1: Collateral
  let backupCollateral2: Collateral
  let backupCollateral3: Collateral
  let backupCollateral4: Collateral
  let basket: Collateral[]
  let basketsNeededAmts: BigNumber[]

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let facade: Facade
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  interface IBackingInfo {
    tokens: string[]
    quantities: BigNumber[]
  }

  const expectCurrentBacking = async (backingInfo: Partial<IBackingInfo>) => {
    const tokens = await facade.basketTokens()
    expect(tokens).to.eql(backingInfo.tokens)

    for (let i = 0; i < tokens.length; i++) {
      const tok = await ethers.getContractAt('ERC20Mock', tokens[i])
      const q = backingInfo.quantities ? backingInfo.quantities[i] : 0
      expect(await tok.balanceOf(backingManager.address)).to.eql(q)
    }
  }

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
      aaveToken,
      compoundMock,
      aaveMock,
      compoundOracleInternal,
      aaveOracleInternal,
      erc20s,
      collateral,
      basket,
      basketsNeededAmts,
      config,
      rToken,
      stRSR,
      gnosis,
      facade,
      assetRegistry,
      backingManager,
      basketHandler,
    } = await loadFixture(defaultFixture))
    token0 = <ERC20Mock>erc20s[collateral.indexOf(basket[0])]
    token1 = <USDCMock>erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = <Collateral>basket[0]
    collateral1 = <Collateral>basket[1]
    // collateral2 = <ATokenFiatCollateral>basket[2]
    // collateral3 = <CTokenFiatCollateral>basket[3]

    // Backup tokens and collaterals - USDT - aUSDT - aUSDC - aBUSD
    backupToken1 = erc20s[2] // USDT
    backupCollateral1 = <Collateral>collateral[2]
    backupToken2 = erc20s[9] // aUSDT
    backupCollateral2 = <Collateral>collateral[9]
    backupToken3 = erc20s[8] // aUSDC
    backupCollateral3 = <Collateral>collateral[8]
    backupToken4 = erc20s[10] // aBUSD
    backupCollateral4 = <Collateral>collateral[10]

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)
    await backupToken1.connect(owner).mint(addr1.address, initialBal)
    await backupToken2.connect(owner).mint(addr1.address, initialBal)
    await backupToken3.connect(owner).mint(addr1.address, initialBal)
    await backupToken4.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
    await backupToken1.connect(owner).mint(addr1.address, initialBal)
    await backupToken2.connect(owner).mint(addr1.address, initialBal)
    await backupToken3.connect(owner).mint(addr1.address, initialBal)
    await backupToken4.connect(owner).mint(addr1.address, initialBal)
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
        initialQuotes = [bn('0.25e18'), bn('0.25e6'), bn('0.25e18'), bn('0.25e8')]
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token1 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))

        // Mark default as probable
        await collateral1.refresh()

        // Check state - No changes
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should not switch yet
        await expect(basketHandler.refreshBasket()).to.not.emit(basketHandler, 'BasketSet')

        // Advance time post delayUntilDefault
        await advanceTime((await collateral1.delayUntilDefault()).toString())

        // Confirm default
        await collateral1.refresh()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(bn('75e18')) // 25% defaulted, value = 0
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
          .withArgs(newTokens, basketsNeededAmts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
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
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))
        await compoundOracleInternal.setPrice(await token0.symbol(), bn('0.5e6'))

        // Mark default as probable
        await assetRegistry.refresh()

        // Check state - No changes
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should not switch yet
        await expect(basketHandler.refreshBasket()).to.not.emit(basketHandler, 'BasketSet')

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Basket should switch, default is confirmed
        const newTokens = [initialTokens[1], backupToken1.address]
        const newQuantities = [initialQuantities[1], bn('0')]
        const newRefAmounts = [basketsNeededAmts[1], fp('0.75')]

        await assetRegistry.refresh()
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
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
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        // Incremented the weight for token0
        expect(quotes).to.eql([bn('0.5e18'), initialQuotes[1], initialQuotes[2]])
      })

      it('Should handle not having a valid backup', async () => {
        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token1 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))

        // Mark default as probable
        await collateral1.refresh()

        // Advance time post delayUntilDefault
        await advanceTime((await collateral1.delayUntilDefault()).toString())

        // Confirm default
        await collateral1.refresh()

        // Basket switches to empty basket
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([], [], true)

        // Check state - Basket is disabled even though fully capitalized
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)

        // Should exclude bad token
        await expectCurrentBacking({
          tokens: [initialTokens[0], initialTokens[2], initialTokens[3]],
          quantities: [initialQuantities[0], initialQuantities[2], initialQuantities[3]],
        })

        // Cannot issue because collateral is not sound
        await expect(rToken.connect(addr1).issue(bn('1e18'))).to.be.revertedWith('basket disabled')
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
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        await basketHandler.refreshBasket()

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token2 to hard default - Decrease rate
        await token2.setExchangeRate(fp('0.99'))

        // Basket should switch as default is detected immediately
        // Should ignore the unregistered one and only use the valid one
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
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql([initialQuotes[0], initialQuotes[1], initialQuotes[3], bn('0.25e18')])
      })
    })

    context('With multiple targets', function () {
      let issueAmount: BigNumber
      let newEURCollateral: Collateral
      let backupEURCollateral: Collateral
      let initialTokens: string[]
      let initialQuantities: BigNumber[]
      let initialQuotes: BigNumber[]
      let quotes: BigNumber[]

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')

        // Swap asset to have EUR target for token1
        const EURCollateralFactory: ContractFactory = await ethers.getContractFactory(
          'EURAavePricedFiatCollateral'
        )

        newEURCollateral = <Collateral>(
          await EURCollateralFactory.deploy(
            token1.address,
            await collateral1.maxTradeVolume(),
            await collateral1.defaultThreshold(),
            await collateral1.delayUntilDefault(),
            compoundMock.address,
            aaveMock.address
          )
        )

        backupEURCollateral = <Collateral>(
          await EURCollateralFactory.deploy(
            backupToken1.address,
            await backupCollateral1.maxTradeVolume(),
            await backupCollateral1.defaultThreshold(),
            await backupCollateral1.delayUntilDefault(),
            compoundMock.address,
            aaveMock.address
          )
        )

        // Swap asset
        await assetRegistry.swapRegistered(newEURCollateral.address)

        // Setup new basket with two tokens with different targets
        initialTokens = [token0.address, token1.address]
        await basketHandler.connect(owner).setPrimeBasket(initialTokens, [fp('0.5'), fp('0.5')])
        await basketHandler.connect(owner).switchBasket()

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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set new EUR Token to default - 50% price reduction
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))

        // Mark default as probable
        await newEURCollateral.refresh()

        // Advance time post delayUntilDefault
        await advanceTime((await newEURCollateral.delayUntilDefault()).toString())

        // Confirm default
        await newEURCollateral.refresh()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(bn('50e18')) // 50% defaulted, value = 0
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        //  Basket should switch
        const newTokens = [initialTokens[0], backupToken1.address]
        const newQuantities = [initialQuantities[0], bn('0')]
        const newRefAmounts = [fp('0.5'), fp('0.5')]
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch in EUR targets
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set the USD Token to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))

        // Mark default as probable
        await collateral0.refresh()

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default
        await collateral0.refresh()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(bn('50e18')) // 50% defaulted, value = 0
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        //  Basket should switch to empty and defaulted
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([], [], true)

        // Check state - Basket is disabled but fully capitalized
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)

        // Should exclude bad token
        await expectCurrentBacking({
          tokens: [initialTokens[1]],
          quantities: [initialQuantities[1]],
        })

        // Cannot issue because collateral is not sound
        await expect(rToken.connect(addr1).issue(bn('1e18'))).to.be.revertedWith('basket disabled')
      })
    })
  })

  describe('Recapitalization', function () {
    context('With very simple Basket - Single stablecoin', function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')

        // Setup new basket with single token
        await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
        await basketHandler.connect(owner).switchBasket()

        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should only start recapitalization after tradingDelay', async () => {
        // Set trading delay
        const newDelay = 3600
        await backingManager.connect(owner).setTradingDelay(newDelay) // 1 hour

        // Setup prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([token1.address], [fp('1')], false)

        // Trigger recapitalization
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        // Attempt to trigger before trading delay - will not open auction
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Advance time post trading delay
        await advanceTime(newDelay + 1)

        // Auction can be run now
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })
      })

      it('Should recapitalize correctly when switching basket - Full amount covered', async () => {
        // Setup prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([token1.address], [fp('1')], false)

        // Check state remains SOUND
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Trigger recapitalization
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, everything was moved to the Market
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check Gnosis
        expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Get fair price - all tokens
        await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: toBNDecimals(sellAmt, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction, should  not start any new auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, token1.address, sellAmt, toBNDecimals(sellAmt, 6)],
            emitted: true,
          },
          { contract: backingManager, name: 'TradeStarted', emitted: false },
        ])

        // Check state - Order restablished
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(
          toBNDecimals(issueAmount, 6)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))
      })

      it('Should recapitalize correctly when switching basket - Taking Haircut - No RSR', async () => {
        // Set prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([token1.address], [fp('1')], false)

        // Check state remains SOUND
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Trigger recapitalization
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, everything was moved to the Market
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check Gnosis
        expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Only cover minBuyAmount - 10% less
        await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: toBNDecimals(minBuyAmt, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction, should  not start any new auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6)],
            emitted: true,
          },
          { contract: backingManager, name: 'TradeStarted', emitted: false },
        ])

        // Check state - Haircut taken, price of RToken has been reduced
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(minBuyAmt)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(toBNDecimals(minBuyAmt, 6))
        expect(await rToken.totalSupply()).to.equal(issueAmount) // Supply remains constant

        //  Check price in USD of the current RToken - Haircut of 10% taken
        expect(await rToken.price()).to.equal(fp('0.99'))
      })

      it('Should recapitalize correctly when switching basket - Using RSR for remainder', async () => {
        // Set prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current
        expect(await rToken.price()).to.equal(fp('1'))

        // Perform stake
        const stkAmount: BigNumber = bn('100e18')
        await rsr.connect(addr1).approve(stRSR.address, stkAmount)
        await stRSR.connect(addr1).stake(stkAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([token1.address], [fp('1')], false)

        // Check state remains SOUND
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Trigger recapitalization
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        const minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        let auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, everything was moved to the Market
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check Gnosis
        expect(await token0.balanceOf(gnosis.address)).to.equal(issueAmount)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Get fair price - minBuyAmt
        await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmt, 6))
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: toBNDecimals(minBuyAmt, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction, should start a new one to sell RSR for collateral
        // Only 1e18 Tokens left to buy - Sets Buy amount as independent value
        const buyAmtBidRSR: BigNumber = sellAmt.sub(minBuyAmt)
        const sellAmtRSR: BigNumber = buyAmtBidRSR.mul(BN_SCALE_FACTOR).div(fp('0.99')).add(1) // Due to trade slippage 1% - Calculation to match Solidity
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6)],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [rsr.address, token1.address, sellAmtRSR, toBNDecimals(buyAmtBidRSR, 6).add(1)],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // RSR -> Token1 Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: token1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(toBNDecimals(minBuyAmt, 6))
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check Gnosis
        expect(await rsr.balanceOf(gnosis.address)).to.equal(sellAmtRSR)

        //  Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Cover buyAmtBidRSR which is all the RSR required
        await token1.connect(addr1).approve(gnosis.address, toBNDecimals(sellAmtRSR, 6))
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR,
          buyAmount: toBNDecimals(buyAmtBidRSR, 6),
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction, should  not start any new auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [rsr.address, token1.address, sellAmtRSR, toBNDecimals(buyAmtBidRSR, 6)],
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(
          toBNDecimals(issueAmount, 6)
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))
      })

      it('Should recapitalize correctly in case of default - Taking Haircut - No RSR', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))

        // Running auctions will not trigger recapitalization until collateral defauls
        await expect(facade.runAuctionsForAllTraders()).to.be.revertedWith('basket not sound')

        // Mark default as probable
        await collateral0.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default
        await collateral0.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

        // Ensure valid basket
        await basketHandler.refreshBasket()

        // Check new state after basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RTokenc- Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Running auctions will trigger recapitalization - All balance will be redeemed
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, backupToken1.address, sellAmt, bn('0'))

        const auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Reduced 50%
        expect(await rToken.price()).to.equal(fp('1'))

        //  Perform Mock Bids for the new Token (addr1 has balance)
        //  Assume fair price, get half of the tokens (because price reduction was 50%)
        const minBuyAmt: BigNumber = sellAmt.div(2)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current, will not open any new auctions (no RSR)
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        // Check state - Haircut taken, price of RToken has been reduced
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(minBuyAmt)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt)
        expect(await rToken.totalSupply()).to.equal(issueAmount) // Supply remains constant

        //  Check price in USD of the current RToken - Haircut of 50% taken
        expect(await rToken.price()).to.equal(fp('1').div(2))
      })

      it('Should recapitalize correctly in case of default - Using RSR for remainder', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Set new max auction size for asset (will require 2 auctions)
        const AaveCollateralFactory: ContractFactory = await ethers.getContractFactory(
          'AavePricedFiatCollateral'
        )
        const newCollateral0: Collateral = <Collateral>(
          await AaveCollateralFactory.deploy(
            token0.address,
            bn('25e18'),
            await backupCollateral1.defaultThreshold(),
            await backupCollateral1.delayUntilDefault(),
            compoundMock.address,
            aaveMock.address
          )
        )

        // Perform swap
        await assetRegistry.connect(owner).swapRegistered(newCollateral0.address)
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        await basketHandler.refreshBasket()

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Perform stake
        const stkAmount: BigNumber = bn('100e18')
        await rsr.connect(addr1).approve(stRSR.address, stkAmount)
        await stRSR.connect(addr1).stake(stkAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))

        // Mark default as probable
        await assetRegistry.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post collateral's default delay
        await advanceTime((await newCollateral0.delayUntilDefault()).toString())

        // Confirm default and trigger basket switch
        await assetRegistry.refresh()
        await basketHandler.refreshBasket()

        // Check new state after basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Running auctions will trigger recapitalization - Half of the balance can be redeemed
        const sellAmt: BigNumber = (await token0.balanceOf(backingManager.address)).div(2)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, backupToken1.address, sellAmt, bn('0'))

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount.sub(sellAmt))
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get half of the tokens (because price reduction was 50%)
        const minBuyAmt: BigNumber = sellAmt.div(2)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current, and will open a new auction for the other half
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token0.address, backupToken1.address, sellAmt, bn('0')],
            emitted: true,
          },
        ])

        // Check new auction
        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(minBuyAmt)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get half of the tokens (because price reduction was 50%)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Check staking situation remains unchanged
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // End current auction, should start a new one to sell RSR for collateral
        // 50e18 Tokens left to buy - Sets Buy amount as independent value
        const buyAmtBidRSR: BigNumber = sellAmt
        const sellAmtRSR: BigNumber = buyAmtBidRSR.mul(BN_SCALE_FACTOR).div(fp('0.99')).add(1) // Due to trade slippage 1% - Calculation to match Solidity

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('2'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(minBuyAmt.mul(2))
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt.mul(2))
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Should have seized RSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)

        //  Perform Mock Bids for RSR (addr1 has balance)
        // Assume fair price RSR = 1 get all of them
        await backupToken1.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR,
          buyAmount: buyAmtBidRSR,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        //  Should have seized RSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)

        // Check final state - All back to normal
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          minBuyAmt.mul(2).add(buyAmtBidRSR)
        )
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))
      })

      it('Should recapitalize correctly in case of default - Using RSR for remainder - Multiple tokens and auctions - No overshoot', async () => {
        // Set backing buffer and max slippage to zero for simplification
        await backingManager.connect(owner).setMaxTradeSlippage(0)
        await backingManager.connect(owner).setBackingBuffer(0)

        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)
        await assetRegistry.connect(owner).register(backupCollateral2.address)
        await assetRegistry.connect(owner).register(backupCollateral3.address)
        await assetRegistry.connect(owner).register(backupCollateral4.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(4), [
            backupToken1.address,
            backupToken2.address,
            backupToken3.address,
            backupToken4.address,
          ])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken3.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken4.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Perform stake
        const stkAmount: BigNumber = bn('10000e18')
        await rsr.connect(addr1).approve(stRSR.address, stkAmount)
        await stRSR.connect(addr1).stake(stkAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))

        // Mark default as probable
        await assetRegistry.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post collateral's default delay
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default and trigger basket switch
        const newTokens = [
          backupToken1.address,
          backupToken2.address,
          backupToken3.address,
          backupToken4.address,
        ]
        const bkpTokenRefAmt: BigNumber = bn('0.25e18')
        const newRefAmounts = [bkpTokenRefAmt, bkpTokenRefAmt, bkpTokenRefAmt, bkpTokenRefAmt]

        await assetRegistry.refresh()
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check new state after basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [bn('0'), bn('0'), bn('0'), bn('0')],
        })

        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Running auctions will trigger recapitalization - All token balance can be redeemed
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, backupToken1.address, sellAmt, bn('0'))

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get 80% the tokens - More than what we need for this token
        const minBuyAmt: BigNumber = sellAmt.mul(80).div(100)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  Run auctions - will end current, and will open a new auction to buy the remaining backup tokens
        const requiredBkpToken: BigNumber = issueAmount.mul(bkpTokenRefAmt).div(BN_SCALE_FACTOR)
        const sellAmtBkp: BigNumber = requiredBkpToken // Will auction only what is required
        const minBuyAmtBkp: BigNumber = sellAmtBkp // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [backupToken1.address, backupToken2.address, sellAmtBkp, minBuyAmtBkp],
            emitted: true,
          },
        ])

        // Check new auction
        // Backup Token 1 -> Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: backupToken1.address,
          buy: backupToken2.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check backing changed
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [minBuyAmt.sub(sellAmtBkp), bn('0'), bn('0'), bn('0')],
        })

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get all the required tokens
        await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtBkp,
          buyAmount: minBuyAmtBkp,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Check staking situation remains unchanged
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        //  Run auctions - will end current, and will open a new auction to buy the remaining backup tokens
        // We still have funds of backup Token 1 to trade for the other tokens
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [backupToken1.address, backupToken2.address, sellAmtBkp, minBuyAmtBkp],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [backupToken1.address, backupToken3.address, sellAmtBkp, minBuyAmtBkp],
            emitted: true,
          },
        ])

        // Check new auction
        // Backup Token 1 -> Backup Token 3 Auction
        await expectTrade(backingManager, {
          sell: backupToken1.address,
          buy: backupToken3.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('2'),
        })

        // Check backing changed
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [minBuyAmt.sub(requiredBkpToken.mul(2)), requiredBkpToken, bn('0'), bn('0')],
        })

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get all the required tokens
        await backupToken3.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtBkp,
          buyAmount: minBuyAmtBkp,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Check staking situation remains unchanged
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        //  Run auctions - will end current, and will open a new auction to buy the remaining backup tokens
        // We still have a small portionn of funds of backup Token 1 to trade for the other tokens (only 5e18)
        const sellAmtBkp1Remainder: BigNumber = minBuyAmt.sub(sellAmtBkp.mul(3))
        const minBuyAmtBkp1Remainder: BigNumber = sellAmtBkp1Remainder // No trade splippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [backupToken1.address, backupToken3.address, sellAmtBkp, minBuyAmtBkp],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [
              backupToken1.address,
              backupToken4.address,
              sellAmtBkp1Remainder,
              minBuyAmtBkp1Remainder,
            ],
            emitted: true,
          },
        ])

        // Check new auction
        // Backup Token 1 -> Backup Token 4 Auction
        await expectTrade(backingManager, {
          sell: backupToken1.address,
          buy: backupToken4.address,
          endTime: (await getLatestBlockTimestamp()) + Number(config.auctionLength),
          externalId: bn('3'),
        })

        // Check backing changed
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            minBuyAmt.sub(requiredBkpToken.mul(2).add(sellAmtBkp1Remainder)),
            requiredBkpToken,
            requiredBkpToken,
            bn('0'),
          ],
        })

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get all the required tokens
        await backupToken4.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(3, {
          bidder: addr1.address,
          sellAmount: sellAmtBkp1Remainder,
          buyAmount: minBuyAmtBkp1Remainder,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Check staking situation remains unchanged
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // End current auction, should start a new one to sell RSR for collateral
        // 20e18 Tokens of Backup Token 4 left to buy - Sets Buy amount as independent value
        const buyAmtBidRSR: BigNumber = requiredBkpToken.sub(minBuyAmtBkp1Remainder)
        const sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [
              backupToken1.address,
              backupToken4.address,
              sellAmtBkp1Remainder,
              minBuyAmtBkp1Remainder,
            ],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [rsr.address, backupToken4.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token 4 Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: backupToken4.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('4'),
        })

        // Check backing changed
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            minBuyAmt.sub(requiredBkpToken.mul(2).add(sellAmtBkp1Remainder)),
            requiredBkpToken,
            requiredBkpToken,
            minBuyAmtBkp1Remainder,
          ],
        })

        // Should have seized RSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)

        //  Perform Mock Bids for RSR (addr1 has balance)
        // Assume fair price RSR = 1 get all of them
        await backupToken4.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
        await gnosis.placeBid(4, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR,
          buyAmount: buyAmtBidRSR,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [rsr.address, backupToken4.address, sellAmtRSR, buyAmtBidRSR],
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(requiredBkpToken)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(requiredBkpToken)
        expect(await backupToken3.balanceOf(backingManager.address)).to.equal(requiredBkpToken)
        expect(await backupToken4.balanceOf(backingManager.address)).to.equal(requiredBkpToken)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check backing changed
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            minBuyAmt.sub(requiredBkpToken.mul(2).add(sellAmtBkp1Remainder)),
            requiredBkpToken,
            requiredBkpToken,
            requiredBkpToken,
          ],
        })

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))
      })

      it('Should use exceeding RSR in Backing Manager before seizing - Using RSR', async () => {
        // Set backing buffer and max slippage to zero for simplification
        await backingManager.connect(owner).setMaxTradeSlippage(0)
        await backingManager.connect(owner).setBackingBuffer(0)

        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Perform stake
        const stkAmount: BigNumber = bn('100e18')
        await rsr.connect(addr1).approve(stRSR.address, stkAmount)
        await stRSR.connect(addr1).stake(stkAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))

        // Mark default as probable
        await assetRegistry.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post collateral's default delay
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default and trigger basket switch
        await assetRegistry.refresh()
        await basketHandler.refreshBasket()

        // Running auctions will trigger recapitalization - All balance can be redeemed
        const sellAmt: BigNumber = await token0.balanceOf(backingManager.address)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(token0.address, backupToken1.address, sellAmt, bn('0'))

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get half of the tokens (because price reduction was 50%)
        const minBuyAmt: BigNumber = sellAmt.div(2)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt,
          buyAmount: minBuyAmt,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current, and will open a new auction to sell RSR for collateral
        // 50e18 Tokens left to buy - Sets Buy amount as independent value
        const buyAmtBidRSR: BigNumber = sellAmt.div(2)
        const sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(minBuyAmt) // Reduced 50%
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Should have seized RSR  - Nothing in backing manager so far
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)
        expect(await rsr.balanceOf(backingManager.address)).to.equal(0)

        // Settle auction with no bids - will return RSR to Backing Manager
        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [rsr.address, backupToken1.address, bn('0'), bn('0')],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],

            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('2'),
        })

        //  Funds were reused. No more seizures
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)

        //  Perform Mock Bids (addr1 has balance)
        // Assume fair price, get all the RSR required
        await backupToken1.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR,
          buyAmount: buyAmtBidRSR,
        })

        //  Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions again - Will close the pending auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
          { contract: backingManager, name: 'TradeStarted', emitted: false },
        ])

        //  Check final state - All back to normal
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(minBuyAmt.add(buyAmtBidRSR))
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))
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
        initialQuotes = [bn('0.25e18'), bn('0.25e6'), bn('0.25e18'), bn('0.25e8')]
        initialQuantities = initialQuotes.map((q) => {
          return q.mul(issueAmount).div(BN_SCALE_FACTOR)
        })

        initialTokens = await Promise.all(
          basket.map(async (c): Promise<string> => {
            return await c.erc20()
          })
        )

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

        // Mint some RSR
        await rsr.connect(owner).mint(addr1.address, initialBal)
      })

      it('Should recapitalize correctly in case of default - Using RSR', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT as backup
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Perform stake
        const stkAmount: BigNumber = bn('100e18')
        await rsr.connect(addr1).approve(stRSR.address, stkAmount)
        await stRSR.connect(addr1).stake(stkAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        //  Check no Backup tokens available
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
          .withArgs(newTokens, newRefAmounts, false)

        //  Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(75).div(100)) // only 75% of collateral is worth something
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - With the new basket
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recapitalization - All balance will be redeemed
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)

        // Run auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token2.address, backupToken1.address, sellAmt2, bn('0')],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token2 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get half of the tokens (50%)
        const minBuyAmt2: BigNumber = sellAmt2.div(2)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: minBuyAmt2,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction, should start a new one to sell RSR for collateral
        // 12.5e18 Tokens left to buy - Sets Buy amount as independent value
        const buyAmtBidRSR: BigNumber = minBuyAmt2
        const sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        //  Check state - After first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.mul(75).div(100).add(minBuyAmt2)
        ) // adding the obtained tokens

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], newQuantities[1], newQuantities[2], minBuyAmt2],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt2)

        // Should have seized RSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)

        //  Perform Mock Bids for RSR (addr1 has balance)
        // Assume fair price RSR = 1 get all of them
        await backupToken1.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR,
          buyAmount: buyAmtBidRSR,
        })

        // \Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        //  Check final state - All back to normal
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.mul(75).div(100).add(minBuyAmt2).add(buyAmtBidRSR)
        ) // adding the obtained tokens
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

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

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt2.add(buyAmtBidRSR)
        )
        expect(await token2.balanceOf(backingManager.address)).to.equal(0)
      })

      it('Should recapitalize correctly in case of default - Using RSR - Multiple Backup tokens - Returns surplus', async () => {
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
        const stkAmount: BigNumber = bn('10000e18')
        await rsr.connect(addr1).approve(stRSR.address, stkAmount)
        await stRSR.connect(addr1).stake(stkAmount)

        // Check stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stkAmount)

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        //  Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Set Token2 to hard default - Reducing rate
        await token2.setExchangeRate(fp('0.99'))

        // Confirm default and ensure valid basket
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
        const newQuotes = [
          initialQuotes[0],
          initialQuotes[1],
          initialQuotes[3],
          bn('0.125e18'),
          bn('0.125e18'),
        ]
        const bkpTokenRefAmt: BigNumber = bn('0.125e18')
        const newRefAmounts = [
          basketsNeededAmts[0],
          basketsNeededAmts[1],
          basketsNeededAmts[3],
          bkpTokenRefAmt,
          bkpTokenRefAmt,
        ]

        // Mark Default - Perform basket switch
        await assetRegistry.refresh()
        await expect(basketHandler.refreshBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        //  Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(75).div(100)) // only 75% of collateral is worth something
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - With the new basket
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recapitalization - All balance will be redeemed
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)

        // Run auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token2.address, backupToken1.address, sellAmt2, bn('0')],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token2 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get 80% of tokens (20e18), which is more than what we need
        const minBuyAmt2: BigNumber = sellAmt2.mul(80).div(100)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: minBuyAmt2,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction, should start a new one to sell the new surplus of Backup Token 1
        // We have an extra 7.5e18 to sell
        const requiredBkpToken: BigNumber = issueAmount.mul(bkpTokenRefAmt).div(BN_SCALE_FACTOR)
        const sellAmtBkp1: BigNumber = minBuyAmt2.sub(requiredBkpToken)
        const minBuyAmtBkp1: BigNumber = sellAmtBkp1 // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [backupToken1.address, backupToken2.address, sellAmtBkp1, minBuyAmtBkp1],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Backup Token 1 -> Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: backupToken1.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        //  Check state - After first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.mul(75).div(100).add(requiredBkpToken)
        ) // adding the obtained tokens - only the required ones

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0],
            newQuantities[1],
            newQuantities[2],
            requiredBkpToken,
            bn('0'),
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(requiredBkpToken)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all of them
        await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmtBkp1)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmtBkp1,
          buyAmount: minBuyAmtBkp1,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        //  End current auction, should start a new one to sell RSR for collateral
        // Only 5e18 Tokens left to buy - Sets Buy amount as independent value
        const buyAmtBidRSR: BigNumber = requiredBkpToken.sub(minBuyAmtBkp1)
        const sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [backupToken1.address, backupToken2.address, sellAmtBkp1, minBuyAmtBkp1],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [rsr.address, backupToken2.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, {
          sell: rsr.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('2'),
        })

        //  Check state - After second auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.mul(75).div(100).add(requiredBkpToken).add(minBuyAmtBkp1)
        ) // adding the obtained tokens

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0],
            newQuantities[1],
            newQuantities[2],
            requiredBkpToken,
            minBuyAmtBkp1,
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(requiredBkpToken)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(minBuyAmtBkp1)

        // Should have seized RSR
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stkAmount.sub(sellAmtRSR)) // Sent to market (auction)

        //  Perform Mock Bids for RSR (addr1 has balance)
        // Assume fair price RSR = 1 get all of them - Leave a surplus of RSR to be returned
        await backupToken2.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmtRSR.sub(1000),
          buyAmount: buyAmtBidRSR,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [rsr.address, backupToken2.address, sellAmtRSR.sub(1000), buyAmtBidRSR],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            emitted: false,
          },
        ])

        //  Check final state - All back to normal
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.mul(75).div(100).add(requiredBkpToken).add(minBuyAmtBkp1).add(buyAmtBidRSR)
        ) // adding the obtained tokens

        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0],
            newQuantities[1],
            newQuantities[2],
            requiredBkpToken,
            minBuyAmtBkp1.add(buyAmtBidRSR),
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(requiredBkpToken)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(
          minBuyAmtBkp1.add(buyAmtBidRSR)
        )
        expect(await token2.balanceOf(backingManager.address)).to.equal(0)
      })

      it('Should recapitalize correctly in case of default - Taking Haircut - Single backup token', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)

        // Set backup configuration - USDT
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [backupToken1.address])

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        //  Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Set Token0 to default - 20% price reduction - Will also default tokens 2 and 3
        await aaveOracleInternal.setPrice(token0.address, bn('2e14'))
        await compoundOracleInternal.setPrice(await token0.symbol(), bn('0.8e6'))

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
          .withArgs(newTokens, newRefAmounts, false)

        //  Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.div(4)) // only 25% of collateral is worth something
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - With the new basket
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recapitalization - All balance will be redeemed
        const sellAmt0: BigNumber = await token0.balanceOf(backingManager.address)
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)
        const sellAmt3: BigNumber = (await token3.balanceOf(backingManager.address)).mul(pow10(10)) // convert to 18 decimals for simplification

        // Run auctions - Will start with token0
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token0.address, backupToken1.address, sellAmt0, bn('0')],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get 80% of tokens
        const minBuyAmt0: BigNumber = sellAmt0.mul(80).div(100)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt0)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt0,
          buyAmount: minBuyAmt0,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction for another token
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, backupToken1.address, sellAmt0, minBuyAmt0],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token2.address, backupToken1.address, sellAmt2, bn('0')],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token2 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check state after first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0)
        ) // Adding the collateral just traded

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], minBuyAmt0],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt0)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get 80% of tokens
        const minBuyAmt2: BigNumber = sellAmt2.mul(80).div(100)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: minBuyAmt2,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token3.address, backupToken1.address, toBNDecimals(sellAmt3, 8), bn('0')],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token3 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token3.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('2'),
        })

        // Check state after second auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2)
        ) // Adding the collateral just traded

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], minBuyAmt0.add(minBuyAmt2)],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt2)
        )

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get 80% of tokens
        const minBuyAmt3: BigNumber = sellAmt3.mul(80).div(100)
        const newTotalAssetValue: BigNumber = (await facade.callStatic.totalAssetValue()).add(
          minBuyAmt3
        )

        // We will need to rebalance our backing, we have an excess of Token1 now and we need more backupToken1
        // We need 3.75e18 to reach the 75% of backup token 1
        const requiredBkpToken1: BigNumber = newTotalAssetValue.mul(75).div(100)
        const minBuyAmtRebalance: BigNumber = requiredBkpToken1.sub(
          minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3)
        ) // in 18 decimals, buy token - no trade slippage
        const sellAmtRebalance: BigNumber = toBNDecimals(minBuyAmtRebalance, 6) // convert to decimals of sell token - no trade slippage

        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt3)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: toBNDecimals(sellAmt3, 8),
          buyAmount: minBuyAmt3,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction with the rebalancing
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token3.address, backupToken1.address, toBNDecimals(sellAmt3, 8), minBuyAmt3],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token1.address, backupToken1.address, sellAmtRebalance, minBuyAmtRebalance],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token1 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token1.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('3'),
        })

        // Check state after third auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2).add(minBuyAmt3).sub(minBuyAmtRebalance)
        ) // Adding the collateral just traded - subtracting funds sent to market

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0].sub(sellAmtRebalance),
            minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3),
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3)
        )

        //  Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmtRebalance)
        await gnosis.placeBid(3, {
          bidder: addr1.address,
          sellAmount: sellAmtRebalance,
          buyAmount: minBuyAmtRebalance,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Close final auction - Haircut will be taken
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token1.address, backupToken1.address, sellAmtRebalance, minBuyAmtRebalance],
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2).add(minBuyAmt3)
        ) // Adding the collateral just traded - funds sent to market were recovered

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0].sub(sellAmtRebalance),
            minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3).add(minBuyAmtRebalance),
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Haircut of 15% taken (5% lost of each of the three defaulted tokens)
        expect(await rToken.price()).to.equal(fp('0.85'))

        // Check quotes - reduced by 15% as well (less collateral is required to match the new price)
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        const finalQuotes = newQuotes.map((q) => {
          return q.mul(85).div(100)
        })
        expect(quotes).to.eql(finalQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3).add(minBuyAmtRebalance)
        )
      })

      it('Should recapitalize correctly in case of default - Taking Haircut - Multiple Backup tokens', async () => {
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        //  Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Set Token0 to default - 50% price reduction - Will also default tokens 2 and 3
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))
        await compoundOracleInternal.setPrice(await token0.symbol(), bn('0.5e6'))

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
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - After basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.div(4)) // only 25% of collateral is worth something
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - With the new basket
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recapitalization - All balance will be redeemed
        const sellAmt0: BigNumber = await token0.balanceOf(backingManager.address)
        const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)
        const sellAmt3: BigNumber = (await token3.balanceOf(backingManager.address)).mul(pow10(10)) // convert to 18 decimals for simplification

        // Run auctions - will start with token0 and backuptoken1
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token0.address, backupToken1.address, sellAmt0, bn('0')],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get half of the tokens (because price reduction was 50%)
        const minBuyAmt0: BigNumber = sellAmt0.div(2)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt0)
        await gnosis.placeBid(0, {
          bidder: addr1.address,
          sellAmount: sellAmt0,
          buyAmount: minBuyAmt0,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token0.address, backupToken1.address, sellAmt0, minBuyAmt0],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token2.address, backupToken2.address, sellAmt2, bn('0')],

            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token2 -> Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: token2.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        // Check state after first auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0)
        ) // Adding the collateral just traded

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], minBuyAmt0, bn('0')],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get half of the tokens (because price reduction was 50%)
        const minBuyAmt2: BigNumber = sellAmt2.div(2)
        await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmt2)
        await gnosis.placeBid(1, {
          bidder: addr1.address,
          sellAmount: sellAmt2,
          buyAmount: minBuyAmt2,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token2.address, backupToken2.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token3.address, backupToken1.address, toBNDecimals(sellAmt3, 8), bn('0')],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token3 -> Backup Token 1 Auction
        await expectTrade(backingManager, {
          sell: token3.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('2'),
        })

        //   Check state after second auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2)
        ) // Adding the collateral just traded

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [newQuantities[0], minBuyAmt0, minBuyAmt2],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(minBuyAmt2)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get half of the tokens (because price reduction was 50%)

        const minBuyAmt3: BigNumber = sellAmt3.div(2)
        const newTotalAssetValue: BigNumber = (await facade.callStatic.totalAssetValue()).add(
          minBuyAmt3
        )

        // We will need to rebalance our backing, we have an excess of Token1 now and we need more backupToken1 and backuptoken2
        // We need 9.375e18 to reach the 75% of backup tokens 1 and 2
        const requiredBkpTokens: BigNumber = newTotalAssetValue.mul(75).div(100)
        const minBuyAmtRebalance: BigNumber = requiredBkpTokens.sub(
          minBuyAmt0.add(minBuyAmt2).add(minBuyAmt3)
        ) // in 18 decimals, buy token - no trade slippage
        const sellAmtRebalance: BigNumber = toBNDecimals(minBuyAmtRebalance, 6) // convert to decimals of sell token - no trade slippage

        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt3)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: toBNDecimals(sellAmt3, 8),
          buyAmount: minBuyAmt3,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        // We need to rebalance our backing, we have an excess of Token1 now and we need more backupToken2
        // All can be allocated to backup token 2
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token3.address, backupToken1.address, toBNDecimals(sellAmt3, 8), minBuyAmt3],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [token1.address, backupToken2.address, sellAmtRebalance, minBuyAmtRebalance],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token1 -> Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: token1.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('3'),
        })

        // Check state after third auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2).add(minBuyAmt3).sub(minBuyAmtRebalance)
        ) // Adding the collateral just traded - subtracting funds sent to market

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0].sub(sellAmtRebalance),
            minBuyAmt0.add(minBuyAmt3),
            minBuyAmt2,
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt3)
        )
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(minBuyAmt2)

        //   Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmtRebalance)
        await gnosis.placeBid(3, {
          bidder: addr1.address,
          sellAmount: sellAmtRebalance,
          buyAmount: minBuyAmtRebalance,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Close auction - We can still trade some of backupToken1 to backuptoken2 to optimize the potential baskets
        // They need to be equal parts. And together count for 75% of basket
        // 1.5625e18 tokens should be transferred from backup 1 to backup 2
        const sellAmtRebalanceBkp: BigNumber = (
          await backupToken1.balanceOf(backingManager.address)
        ).sub(requiredBkpTokens.div(2))
        const minBuyAmtRebalanceBkp: BigNumber = sellAmtRebalanceBkp // no trade slippage
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [token1.address, backupToken2.address, sellAmtRebalance, minBuyAmtRebalance],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [
              backupToken1.address,
              backupToken2.address,
              sellAmtRebalanceBkp,
              minBuyAmtRebalanceBkp,
            ],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Backup Token 1 ->  Backup Token 2 Auction
        await expectTrade(backingManager, {
          sell: backupToken1.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('4'),
        })

        // Check state after fourth auction
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount
            .div(4)
            .add(minBuyAmt0)
            .add(minBuyAmt2)
            .add(minBuyAmt3)
            .sub(sellAmtRebalanceBkp)
        ) // Adding the collateral just traded - Rebalanced and new funds sent to market

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0].sub(sellAmtRebalance),
            minBuyAmt0.add(minBuyAmt3).sub(sellAmtRebalanceBkp),
            minBuyAmt2.add(minBuyAmtRebalance),
          ],
        })
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Remains the same
        expect(await rToken.price()).to.equal(fp('1'))

        // Check quotes
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt3).sub(sellAmtRebalanceBkp)
        )
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(
          minBuyAmt2.add(minBuyAmtRebalance)
        )

        //  Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get all tokens
        await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmtRebalanceBkp)
        await gnosis.placeBid(4, {
          bidder: addr1.address,
          sellAmount: sellAmtRebalanceBkp,
          buyAmount: minBuyAmtRebalanceBkp,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Close final auction - Haircut will be taken
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [
              backupToken1.address,
              backupToken2.address,
              sellAmtRebalanceBkp,
              minBuyAmtRebalanceBkp,
            ],
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
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2).add(minBuyAmt3)
        ) // Adding the collateral just traded - Rebalanced, funds recovered

        await expectCurrentBacking({
          tokens: newTokens,
          quantities: [
            newQuantities[0].sub(sellAmtRebalance),
            minBuyAmt0.add(minBuyAmt3).sub(sellAmtRebalanceBkp),
            minBuyAmt2.add(minBuyAmtRebalance).add(minBuyAmtRebalanceBkp),
          ],
        })

        expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  Check price in USD of the current RToken - Haircut of 37.5% taken
        expect(await rToken.price()).to.equal(fp('0.625'))

        // Check quotes - reduced by 15% as well (less collateral is required to match the new price)
        quotes = await facade.connect(addr1).callStatic.issue(bn('1e18'))
        const finalQuotes = newQuotes.map((q) => {
          return q.mul(625).div(1000)
        })
        expect(quotes).to.eql(finalQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt0.add(minBuyAmt3).sub(sellAmtRebalanceBkp)
        )
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(
          minBuyAmt2.add(minBuyAmtRebalance).add(minBuyAmtRebalanceBkp)
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

      // Mint some RSR
      await rsr.connect(owner).mint(addr1.address, initialBal)
    })

    it('Settle Trades / Manage Funds', async () => {
      // Register Collateral
      await assetRegistry.connect(owner).register(backupCollateral1.address)
      await assetRegistry.connect(owner).register(backupCollateral2.address)
      const registeredERC20s = await assetRegistry.erc20s()

      // Set backup configuration - USDT and aUSDT as backup
      await basketHandler
        .connect(owner)
        .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
          backupToken1.address,
          backupToken2.address,
        ])

      // Perform stake
      const stkAmount: BigNumber = bn('10000e18')
      await rsr.connect(addr1).approve(stRSR.address, stkAmount)
      await stRSR.connect(addr1).stake(stkAmount)

      // Set Token2 to hard default - Reducing rate
      await token2.setExchangeRate(fp('0.99'))

      const bkpTokenRefAmt: BigNumber = bn('0.125e18')

      // Mark Default - Perform basket switch
      await assetRegistry.refresh()
      await expect(basketHandler.refreshBasket()).to.emit(basketHandler, 'BasketSet')

      // Running auctions will trigger recapitalization - All balance will be redeemed
      const sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)

      // Run auctions - First Settle trades then Manage Funds
      await snapshotGasCost(backingManager.settleTrade(token2.address))
      await snapshotGasCost(backingManager.manageTokens(registeredERC20s))

      // Another call should not create any new auctions if still ongoing
      await expect(backingManager.settleTrade(token2.address)).to.be.revertedWith(
        'cannot settle yet'
      )
      await snapshotGasCost(backingManager.manageTokens(registeredERC20s))

      // Perform Mock Bids for the new Token (addr1 has balance)
      // Assume fair price, get 80% of tokens (20e18), which is more than what we need
      const minBuyAmt2: BigNumber = sellAmt2.mul(80).div(100)
      await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt2)
      await gnosis.placeBid(0, {
        bidder: addr1.address,
        sellAmount: sellAmt2,
        buyAmount: minBuyAmt2,
      })

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      // End current auction, should start a new one to sell the new surplus of Backup Token 1
      // We have an extra 7.5e18 to sell
      const requiredBkpToken: BigNumber = issueAmount.mul(bkpTokenRefAmt).div(BN_SCALE_FACTOR)
      const sellAmtBkp1: BigNumber = minBuyAmt2.sub(requiredBkpToken)
      const minBuyAmtBkp1: BigNumber = sellAmtBkp1 // No trade slippage

      // Run auctions - First Settle trades then Manage Funds
      await snapshotGasCost(backingManager.settleTrade(token2.address))
      await snapshotGasCost(backingManager.manageTokens(registeredERC20s))

      // Perform Mock Bids for the new Token (addr1 has balance)
      // Assume fair price, get all of them
      await backupToken2.connect(addr1).approve(gnosis.address, minBuyAmtBkp1)
      await gnosis.placeBid(1, {
        bidder: addr1.address,
        sellAmount: sellAmtBkp1,
        buyAmount: minBuyAmtBkp1,
      })

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      //  End current auction, should start a new one to sell RSR for collateral
      // Only 5e18 Tokens left to buy - Sets Buy amount as independent value
      const buyAmtBidRSR: BigNumber = requiredBkpToken.sub(minBuyAmtBkp1)
      const sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

      // Run auctions - First Settle trades then Manage Funds
      await snapshotGasCost(backingManager.settleTrade(backupToken1.address))
      await snapshotGasCost(backingManager.manageTokens(registeredERC20s))

      //  Perform Mock Bids for RSR (addr1 has balance)
      // Assume fair price RSR = 1 get all of them - Leave a surplus of RSR to be returned
      await backupToken2.connect(addr1).approve(gnosis.address, buyAmtBidRSR)
      await gnosis.placeBid(2, {
        bidder: addr1.address,
        sellAmount: sellAmtRSR.sub(1000),
        buyAmount: buyAmtBidRSR,
      })

      // Advance time till auction ended
      await advanceTime(config.auctionLength.add(100).toString())

      expect(await backingManager.tradesOpen()).to.equal(1)
      // End current auction
      await snapshotGasCost(backingManager.settleTrade(rsr.address))
      expect(await backingManager.tradesOpen()).to.equal(0)
    })
  })
})

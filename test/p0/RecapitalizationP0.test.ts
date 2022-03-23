import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { BN_SCALE_FACTOR, CollateralStatus } from '../../common/constants'
import { expectEvents, expectInReceipt } from '../../common/events'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import {
  AaveLendingPoolMock,
  AaveOracleMock,
  AssetRegistryP0,
  ATokenFiatCollateral,
  BackingManagerP0,
  BasketHandlerP0,
  CompoundOracleMock,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeP0,
  GnosisMock,
  RTokenP0,
  StaticATokenMock,
  StRSRP0,
  USDCMock,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'
import { expectTrade } from './utils/trades'

const createFixtureLoader = waffle.createFixtureLoader

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

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
  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let backupCollateral1: Collateral
  let backupCollateral2: Collateral
  let basket: Collateral[]
  let basketsNeededAmts: BigNumber[]

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let stRSR: StRSRP0
  let facade: FacadeP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  interface IBackingInfo {
    tokens: string[]
    quantities: BigNumber[]
  }

  const expectCurrentBacking = async (backingInfo: Partial<IBackingInfo>) => {
    const tokens = await facade.basketTokens()
    expect(tokens).to.eql(backingInfo.tokens)

    for (let i: number = 0; i < tokens.length; i++) {
      const tok = await ethers.getContractAt('ERC20Mock', tokens[i])
      const q = backingInfo.quantities ? backingInfo.quantities[i] : 0

      expect(await tok.balanceOf(backingManager.address)).to.eql(q)
    }
  }

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
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
    collateral2 = <ATokenFiatCollateral>basket[2]
    collateral3 = <CTokenFiatCollateral>basket[3]

    // Backup tokens and collaterals - USDT and aUSDT
    backupToken1 = erc20s[2]
    backupCollateral1 = <Collateral>collateral[2]
    backupToken2 = erc20s[9]
    backupCollateral2 = <Collateral>collateral[9]

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)
    await backupToken1.connect(owner).mint(addr1.address, initialBal)
    await backupToken2.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
    await backupToken1.connect(owner).mint(addr1.address, initialBal)
    await backupToken2.connect(owner).mint(addr1.address, initialBal)
  })

  describe('Default Handling - Basket Selection', function () {
    context('With issued Rtokens', async function () {
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token1 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))

        // Mark default as probable
        await collateral1.forceUpdates()

        // Check state - No changes
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        // quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        // expect(quotes).to.eql(initialQuotes)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should not switch yet
        await expect(basketHandler.ensureBasket()).to.not.emit(basketHandler, 'BasketSet')

        // Advance time post delayUntilDefault
        await advanceTime((await collateral1.delayUntilDefault()).toString())

        // Confirm default
        await collateral1.forceUpdates()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(bn('75e18')) // 25% defaulted, value = 0
        await expectCurrentBacking({
          tokens: [initialTokens[0], initialTokens[2], initialTokens[3]],
          quantities: [initialQuantities[0], initialQuantities[2], initialQuantities[3]],
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
        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, basketsNeededAmts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))
        await compoundOracleInternal.setPrice(await token0.symbol(), bn('0.5e6'))

        // Mark default as probable
        await collateral0.forceUpdates()

        // Check state - No changes
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })

        // Basket should not switch yet
        await expect(basketHandler.ensureBasket()).to.not.emit(basketHandler, 'BasketSet')

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Basket should switch, default is confirmed
        const newTokens = [initialTokens[1], backupToken1.address]
        const newQuantities = [initialQuantities[1], bn('0')]
        const newRefAmounts = [basketsNeededAmts[1], fp('0.75')]

        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set Token1 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))

        // Mark default as probable
        await collateral1.forceUpdates()

        // Advance time post delayUntilDefault
        await advanceTime((await collateral1.delayUntilDefault()).toString())

        // Confirm default
        await collateral1.forceUpdates()

        // Basket switches to empty basket
        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([], [], true)

        // Check state - Basket is disabled even though fully capitalized
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)

        // Should exclude bad token
        await expectCurrentBacking({
          tokens: [initialTokens[0], initialTokens[2], initialTokens[3]],
          quantities: [initialQuantities[0], initialQuantities[2], initialQuantities[3]],
        })

        // Cannot issue because collateral is not sound
        await expect(rToken.connect(addr1).issue(bn('1e18'))).to.be.revertedWith(
          'collateral not sound'
        )
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

        // Check initial state
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        await expectCurrentBacking({
          tokens: initialTokens,
          quantities: initialQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql([initialQuotes[0], initialQuotes[1], initialQuotes[3], bn('0.25e18')])
      })

      it('Should switch basket if collateral in basket is unregistered', async () => {
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

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

        // Unregister an asset in basket
        await expect(assetRegistry.connect(owner).unregister(collateral1.address))
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, basketsNeededAmts, false)

        // Check state - Basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql([initialQuotes[0], initialQuotes[2], initialQuotes[3], bn('0.25e18')])
      })
    })

    context('With multiple targets', async function () {
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set new EUR Token to default - 50% price reduction
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))

        // Mark default as probable
        await newEURCollateral.forceUpdates()

        // Advance time post delayUntilDefault
        await advanceTime((await newEURCollateral.delayUntilDefault()).toString())

        // Confirm default
        await newEURCollateral.forceUpdates()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(bn('50e18')) // 50% defaulted, value = 0
        await expectCurrentBacking({
          tokens: [initialTokens[0]],
          quantities: [initialQuantities[0]],
        })

        //  Basket should switch
        const newTokens = [initialTokens[0], backupToken1.address]
        const newQuantities = [initialQuantities[0], bn('0')]
        const newRefAmounts = [fp('0.5'), fp('0.5')]
        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs(newTokens, newRefAmounts, false)

        // Check state - Basket switch in EUR targets
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        await expectCurrentBacking({
          tokens: newTokens,
          quantities: newQuantities,
        })
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        // Set the USD Token to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))

        // Mark default as probable
        await collateral0.forceUpdates()

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default
        await collateral0.forceUpdates()

        // Check state
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
        expect(await facade.callStatic.totalAssetValue()).to.equal(bn('50e18')) // 50% defaulted, value = 0
        await expectCurrentBacking({
          tokens: [initialTokens[1]],
          quantities: [initialQuantities[1]],
        })

        //  Basket should switch to empty and defaulted
        await expect(basketHandler.ensureBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([], [], true)

        // Check state - Basket is disabled but fully capitalized
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)

        // Should exclude bad token
        await expectCurrentBacking({
          tokens: [initialTokens[1]],
          quantities: [initialQuantities[1]],
        })

        // Cannot issue because collateral is not sound
        await expect(rToken.connect(addr1).issue(bn('1e18'))).to.be.revertedWith(
          'collateral not sound'
        )
      })
    })
  })

  describe('Recapitalization', function () {
    context('With very simple Basket - Single stablecoin', async function () {
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
        const newDelay: number = 3600
        await backingManager.connect(owner).setTradingDelay(newDelay) // 1 hour

        // Setup prime basket
        await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])

        // Switch Basket
        await expect(basketHandler.connect(owner).switchBasket())
          .to.emit(basketHandler, 'BasketSet')
          .withArgs([token1.address], [fp('1')], false)

        // Trigger recapitalization
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        // Attempt to trigger before trading delay - will not open auction
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Advance time post trading delay
        await advanceTime(newDelay + 1)

        // Auction can be run now
        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, 0, {
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
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, 0, {
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
            args: [0, token0.address, token1.address, sellAmt, toBNDecimals(sellAmt, 6)],
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
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        const auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, 0, {
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
            args: [0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6)],
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

        //  Check price in USD of the current RToken
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
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)
        let minBuyAmt: BigNumber = sellAmt.sub(sellAmt.div(100)) // based on trade slippage 1%

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6))

        let auctionTimestamp: number = await getLatestBlockTimestamp()

        // Check auction registered
        // Token0 -> Token1 Auction
        await expectTrade(backingManager, 0, {
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
        let buyAmtBidRSR: BigNumber = sellAmt.sub(minBuyAmt)
        let sellAmtRSR: BigNumber = buyAmtBidRSR.mul(BN_SCALE_FACTOR).div(fp('0.99')) // Due to trade slippage 1% - Calculation to match Solidity

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [0, token0.address, token1.address, sellAmt, toBNDecimals(minBuyAmt, 6)],
            emitted: true,
          },

          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [1, rsr.address, token1.address, sellAmtRSR, toBNDecimals(buyAmtBidRSR, 6)],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // RSR -> Token1 Auction
        await expectTrade(backingManager, 1, {
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
            args: [1, rsr.address, token1.address, sellAmtRSR, toBNDecimals(buyAmtBidRSR, 6)],
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
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

        // Mark default as probable
        await collateral0.forceUpdates()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default
        await collateral0.forceUpdates()
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

        // Ensure valid basket
        await basketHandler.ensureBasket()

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
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(0, token0.address, backupToken1.address, sellAmt, bn('0'))

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, 0, {
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
            args: [0, token0.address, backupToken1.address, sellAmt, minBuyAmt],
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
        await basketHandler.ensureBasket()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post collateral's default delay
        await advanceTime((await newCollateral0.delayUntilDefault()).toString())

        // Confirm default and trigger basket switch
        await basketHandler.ensureBasket()

        // Check new state after basket switch
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCapitalized()).to.equal(false)
        // Asset value is zero, the only collateral held is defaulted
        expect(await facade.callStatic.totalAssetValue()).to.equal(0)
        expect(await token0.balanceOf(backingManager.address)).to.equal(issueAmount)
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(issueAmount)

        // Running auctions will trigger recapitalization - Half of the balance can be redeemed
        let sellAmt: BigNumber = (await token0.balanceOf(backingManager.address)).div(2)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(0, token0.address, backupToken1.address, sellAmt, bn('0'))

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, 0, {
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
            args: [0, token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [1, token0.address, backupToken1.address, sellAmt, bn('0')],
            emitted: true,
          },
        ])

        // Check new auction
        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, 1, {
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
        let buyAmtBidRSR: BigNumber = sellAmt
        let sellAmtRSR: BigNumber = buyAmtBidRSR.mul(BN_SCALE_FACTOR).div(fp('0.99')) // Due to trade slippage 1% - Calculation to match Solidity

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [1, token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [2, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, 2, {
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
            args: [2, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
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
        await basketHandler.ensureBasket()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post collateral's default delay
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default and trigger basket switch
        await basketHandler.ensureBasket()

        // Running auctions will trigger recapitalization - All balance can be redeemed
        let sellAmt: BigNumber = await token0.balanceOf(backingManager.address)

        await expect(facade.runAuctionsForAllTraders())
          .to.emit(backingManager, 'TradeStarted')
          .withArgs(0, token0.address, backupToken1.address, sellAmt, bn('0'))

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token Auction
        await expectTrade(backingManager, 0, {
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
        let buyAmtBidRSR: BigNumber = sellAmt.div(2)
        let sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [0, token0.address, backupToken1.address, sellAmt, minBuyAmt],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [1, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, 1, {
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
            args: [1, rsr.address, backupToken1.address, bn('0'), bn('0')],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [2, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],

            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, 2, {
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
            args: [2, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
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

    context('With issued Rtokens', async function () {
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

        // Set backup configuration - USDT and cUSDT s backup
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        await expect(basketHandler.ensureBasket())
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recapitalization - All balance will be redeemed
        let sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)

        // Run auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [0, token2.address, backupToken1.address, sellAmt2, bn('0')],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token2 -> Backup Token 1 Auction
        await expectTrade(backingManager, 0, {
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
        let buyAmtBidRSR: BigNumber = minBuyAmt2
        let sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [0, token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [1, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, 1, {
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
            args: [1, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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

        // Set backup configuration - USDT and cUSDT as backup
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
        await expect(basketHandler.ensureBasket())
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recapitalization - All balance will be redeemed
        let sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)

        // Run auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [0, token2.address, backupToken1.address, sellAmt2, bn('0')],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token2 -> Backup Token 1 Auction
        await expectTrade(backingManager, 0, {
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
        let buyAmtBidRSR: BigNumber = minBuyAmt2
        let sellAmtRSR: BigNumber = buyAmtBidRSR // No trade slippage

        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [0, token2.address, backupToken1.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [1, rsr.address, backupToken1.address, sellAmtRSR, buyAmtBidRSR],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // RSR -> Backup Token Auction
        await expectTrade(backingManager, 1, {
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
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
          sellAmount: sellAmtRSR.sub(1000),
          buyAmount: buyAmtBidRSR,
        })

        // \Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // End current auction
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeSettled',
            args: [1, rsr.address, backupToken1.address, sellAmtRSR.sub(1000), buyAmtBidRSR],
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
          minBuyAmt2.add(buyAmtBidRSR)
        )
        expect(await token2.balanceOf(backingManager.address)).to.equal(0)
      })

      it('Should recapitalize correctly in case of default - Taking Haircut - No RSR', async () => {
        // Register Collateral
        await assetRegistry.connect(owner).register(backupCollateral1.address)
        await assetRegistry.connect(owner).register(backupCollateral2.address)

        // Set backup configuration - USDT and cUSDT s backup
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(initialQuotes)

        //  Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(0)

        // Set Token0 to default - 50% price reduction
        await aaveOracleInternal.setPrice(token0.address, bn('1.25e14'))
        await compoundOracleInternal.setPrice(await token0.symbol(), bn('0.5e6'))

        // Mark default as probable
        await basketHandler.ensureBasket()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

        // Advance time post delayUntilDefault
        await advanceTime((await collateral0.delayUntilDefault()).toString())

        // Confirm default and ensure valid basket
        const newTokens = [initialTokens[1], backupToken1.address, backupToken2.address]
        const newQuantities = [initialQuantities[1], bn('0'), bn('0')]
        const newQuotes = [initialQuotes[1], bn('0.375e18'), bn('0.375e18')]
        const newRefAmounts = [basketsNeededAmts[1], bn('0.375e18'), bn('0.375e18')]

        // Perform basket switch
        await expect(basketHandler.ensureBasket())
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        // Running auctions will trigger recapitalization - All balance will be redeemed
        let sellAmt0: BigNumber = await token0.balanceOf(backingManager.address)
        let sellAmt2: BigNumber = await token2.balanceOf(backingManager.address)
        let sellAmt3: BigNumber = await token3.balanceOf(backingManager.address)

        // // let receipt = await(await facade.runAuctionsForAllTraders()).wait()

        //        const receipt = await(await facade.runAuctionsForAllTraders()).wait()
        // console.log(receipt.events)

        //   // console.log(backingManager.interface)

        // //  let receipt = await(await backingManager.manageFunds()).wait()

        // //  console.log(receipt.events)

        // //   receipt = await(await rsrTrader.manageFunds()).wait()

        // //   console.log(receipt.events)

        // //   receipt = await(await rTokenTrader.manageFunds()).wait()

        // //   console.log(receipt.events)

        // let receipt = await(await facade.runAuctionsForAllTraders()).wait()
        // // console.log(receipt.events)

        // const decodedEvents = receipt.logs
        // .map((log) => {
        //   try {
        //     return rsrTrader.interface.parseLog(log);
        //   } catch {
        //     try {
        //     return rTokenTrader.interface.parseLog(log);
        //     } catch {
        //       try {
        //         return backingManager.interface.parseLog(log);
        //         } catch {
        //           return undefined;
        //         }
        //     }
        //   }
        // })

        // console.log(decodedEvents)

        // Run auctions
        await expectEvents(facade.runAuctionsForAllTraders(), [
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [0, token0.address, backupToken1.address, sellAmt0, bn('0')],
            emitted: true,
          },
        ])

        let auctionTimestamp = await getLatestBlockTimestamp()

        // Token0 -> Backup Token 1 Auction
        await expectTrade(backingManager, 0, {
          sell: token0.address,
          buy: backupToken1.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('0'),
        })

        // Another call should not create any new auctions if still ongoing
        await expect(facade.runAuctionsForAllTraders()).to.not.emit(backingManager, 'TradeStarted')

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
            args: [0, token0.address, backupToken1.address, sellAmt0, minBuyAmt0],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [1, token2.address, backupToken2.address, sellAmt2, bn('0')],

            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token2 -> Backup Token 2 Auction
        await expectTrade(backingManager, 1, {
          sell: token2.address,
          buy: backupToken2.address,
          endTime: auctionTimestamp + Number(config.auctionLength),
          externalId: bn('1'),
        })

        //   Check state after first auction
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check no Backup tokens available
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
            args: [1, token2.address, backupToken2.address, sellAmt2, minBuyAmt2],
            emitted: true,
          },
          {
            contract: backingManager,
            name: 'TradeStarted',
            args: [2, token3.address, backupToken1.address, sellAmt3, bn('0')],
            emitted: true,
          },
        ])

        auctionTimestamp = await getLatestBlockTimestamp()

        // Check new auction
        // Token3 -> Backup Token 1 Auction
        await expectTrade(backingManager, 2, {
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
        quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        expect(quotes).to.eql(newQuotes)

        //  Check no Backup tokens available
        expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt0)
        expect(await backupToken2.balanceOf(backingManager.address)).to.equal(minBuyAmt2)

        // Perform Mock Bids for the new Token (addr1 has balance)
        // Assume fair price, get half of the tokens (because price reduction was 50%)
        const minBuyAmt3: BigNumber = sellAmt3.div(2)
        await backupToken1.connect(addr1).approve(gnosis.address, minBuyAmt3)
        await gnosis.placeBid(2, {
          bidder: addr1.address,
          sellAmount: sellAmt3,
          buyAmount: minBuyAmt3,
        })

        // Advance time till auction ended
        await advanceTime(config.auctionLength.add(100).toString())

        // Run auctions - will end current and open a new auction
        // We need to rebalance our backing, we have an excess of Token1 now and we need more backupToken2
        await facade.runAuctionsForAllTraders()

        // await expectEvents(facade.runAuctionsForAllTraders(), [
        //   {
        //     contract: backingManager,
        //     name: 'TradeSettled',
        //     args: [2, token3.address, backupToken1.address, sellAmt3, minBuyAmt3],
        //     emitted: true,
        //   },
        //   {
        //     contract: backingManager,
        //     name: 'TradeStarted',
        //     args: [3, token1.address, backupToken2.address, bn('0'), bn('0')],
        //     emitted: true,
        //   },
        // ])

        //   auctionTimestamp = await getLatestBlockTimestamp()

        //   // 25000
        //   // 6.265782

        // // Check new auction
        //   // Token1 -> Backup Token 2 Auction
        //   await expectTrade(backingManager, 3, {
        //     sell: token1.address,
        //     buy: backupToken2.address,
        //     endTime: auctionTimestamp + Number(config.auctionLength),
        //     externalId: bn('3'),
        //   })

        //   Check state after third auction
        //  expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        //  expect(await basketHandler.fullyCapitalized()).to.equal(false)
        //  expect(await facade.callStatic.totalAssetValue()).to.equal(
        //    issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2).add(minBuyAmt3)
        //  ) // Adding the collateral just traded

        //  await expectCurrentBacking({
        //    tokens: newTokens,
        //    quantities: [newQuantities[0].add(minBuyAmt3), minBuyAmt0, minBuyAmt2],
        //  })
        //  expect(await rToken.totalSupply()).to.equal(issueAmount)

        //  //  Check price in USD of the current RToken - Remains the same
        //  expect(await rToken.price()).to.equal(fp('1'))

        //  // Check quotes
        //  quotes = await rToken.connect(addr1).callStatic.issue(bn('1e18'))
        //  expect(quotes).to.eql(newQuotes)

        //  //  Check no Backup tokens available
        //  expect(await backupToken1.balanceOf(backingManager.address)).to.equal(minBuyAmt0)
        //  expect(await backupToken2.balanceOf(backingManager.address)).to.equal(minBuyAmt2)

        //   // Run auctions - will end current  - No more to auction and no RSR - Haircut
        //   await expect(facade.runAuctionsForAllTraders())
        //     .to.emit(backingManager, 'AuctionEnded')
        //     .withArgs(2, token3.address, backupToken1.address, sellAmt3, minBuyAmt3)
        //     .and.to.not.emit(backingManager, 'AuctionStarted')
        //     .and.to.not.emit(rsrTrader, 'AuctionStarted')
        //     .and.to.not.emit(rTokenTrader, 'AuctionStarted')

        //   //  Check state - Haircut taken, price of RToken has been reduced
        //   expect(await basketHandler.worstCollateralStatus()).to.equal(CollateralStatus.SOUND)
        //   expect(await basketHandler.fullyCapitalized()).to.equal(true)
        //   await expectCurrentBacking(facade, {
        //     tokens: [initialTokens[1], backupToken1.address, backupToken2.address],
        //     quantities: [initialQuantities[1], minBuyAmt0.add(minBuyAmt3), minBuyAmt2],
        //   })
        //   // Asset value is reduced due to defaulted collateral
        //   expect(await facade.totalAssetValue()).to.equal(
        //     issueAmount.div(4).add(minBuyAmt0).add(minBuyAmt2).add(minBuyAmt3)
        //   )
        //   expect(await rToken.totalSupply()).to.equal(issueAmount)

        //   expect(await backupToken1.balanceOf(backingManager.address)).to.equal(
        //     minBuyAmt0.add(minBuyAmt3)
        //   )
        //   expect(await backupToken2.balanceOf(backingManager.address)).to.equal(minBuyAmt2)

        //   //  Check price in USD of the current RToken - Only 33% of baskets covered (only have 12.5e18 of backup2)
        //   expect(await rTokenIssuer.rTokenPrice()).to.equal(fp('1').div(3))

        //   quotes = await rTokenIssuer.connect(addr1).callStatic.issue(issueAmount.mul(fp('1').add(config.backingBuffer)).div(BN_SCALE_FACTOR))
        //   const newQuoteBackup: BigNumber = bn('12.5e18')
        //   const newQuoteTkn1: BigNumber = divCeil(toBNDecimals(newQuoteBackup, 6).mul(2), bn('3')) // Should represent 25% of total

        //   console.log(quotes[0])
        //   console.log(quotes[1])
        //   console.log(quotes[2])

        //  // expect(quotes).to.eql([newQuoteTkn1, newQuoteBackup, newQuoteBackup])

        //   // Another call will sell the excess collateral (for token1 and backup1)

        //   console.log(initialQuantities[1].toString())
        //   console.log(newQuoteTkn1.toString())
        //   const excessToken1 = initialQuantities[1].sub(quotes[0]) //newQuoteTkn1)
        //   const expectedToTrader = excessToken1.mul(60).div(100)
        //   console.log("Excess")
        //   console.log(excessToken1.toString())
        //   console.log(expectedToTrader.toString())

        //   const expectedToFurnace = excessToken1.sub(expectedToTrader)
        //   console.log(expectedToFurnace.toString())

        //   let sellAmtRSR: BigNumber = expectedToTrader // everything is auctioned, below max auction
        //   let minBuyAmtRSR: BigNumber = sellAmtRSR.sub(sellAmtRSR.div(100)) // due to trade slippage 1% - price token1 = rsr
        //   let sellAmtRToken: BigNumber = expectedToFurnace // everything is auctioned, below max auction
        //   let minBuyAmtRToken: BigNumber = sellAmtRToken.sub(sellAmtRToken.div(100)) // due to trade slippage 1% - price token1 = rsr

        //   await expect(facade.runAuctionsForAllTraders())
        //     .to.emit(rsrTrader, 'AuctionStarted')
        //     .withArgs(0, token1.address, rsr.address, sellAmtRSR, minBuyAmtRSR)
        //     // .and.to.emit(rTokenTrader, 'AuctionStarted')
        //     // .withArgs(0, token1.address, rToken.address, sellAmtRToken, minBuyAmtRToken)
        //     // .and.to.not.emit(backingManager, 'AuctionStarted')

        //   auctionTimestamp = await getLatestBlockTimestamp()

        // Check auctions - Token1 -> RSR
        // await expectAuctionInfo(rsrTrader, 0, {
        //   sell: token1.address,
        //   buy: rsr.address,
        //   sellAmount: sellAmtRSR,
        //   minBuyAmount: minBuyAmtRSR,
        //   startTime: auctionTimestamp,
        //   endTime: auctionTimestamp + Number(config.auctionPeriod),
        //   clearingSellAmount: bn('0'),
        //   clearingBuyAmount: bn('0'),
        //   externalAuctionId: bn('2'),
        //   status: AuctionStatus.OPEN,
        // })

        // Token1 -> Rtoken
        // await expectAuctionInfo(rTokenTrader, 0, {
        //   sell: token1.address,
        //   buy: rToken.address,
        //   sellAmount: sellAmtRToken,
        //   minBuyAmount: minBuyAmtRToken,
        //   startTime: auctionTimestamp,
        //   endTime: auctionTimestamp + Number(config.auctionPeriod),
        //   clearingSellAmount: bn('0'),
        //   clearingBuyAmount: bn('0'),
        //   externalAuctionId: bn('2'),
        //   status: AuctionStatus.OPEN,
        // })

        // Another call will now auction excess of backuptoken1
        // await expect(facade.runAuctionsForAllTraders())
        //   .to.emit(rsrTrader, 'AuctionStarted')
        //  // .withArgs(1, token1.address, rsr.address, sellAmtRSR, minBuyAmtRSR)
        //   .and.to.emit(rTokenTrader, 'AuctionStarted')
        //  // .withArgs(1, token1.address, rToken.address, sellAmtRToken, minBuyAmtRToken)
        //   .and.to.not.emit(backingManager, 'AuctionStarted')
      })
    })
  })
})

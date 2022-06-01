import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { FURNACE_DEST, STRSR_DEST, MAX_UINT256, ZERO_ADDRESS } from '../common/constants'
import { bn, fp, shortString } from '../common/numbers'
import {
  AaveLendingPoolMock,
  AavePricedAsset,
  AaveOracleMock,
  TestIAssetRegistry,
  ATokenFiatCollateral,
  TestIBackingManager,
  IBasketHandler,
  CompoundPricedAsset,
  ComptrollerMock,
  CompoundOracleMock,
  CTokenFiatCollateral,
  AavePricedFiatCollateralMock,
  CTokenMock,
  TestIDistributor,
  ERC20Mock,
  Facade,
  GnosisTrade,
  TestIStRSR,
  TestIMain,
  EasyAuction,
  TestIRevenueTrader,
  RTokenAsset,
  TestIRToken,
  StaticATokenMock,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import { advanceTime } from './utils/time'
import { defaultFixture, IConfig, SLOW } from './fixtures'
import { cartesianProduct } from './utils/cases'
import { issueMany } from './utils/issue'

const createFixtureLoader = waffle.createFixtureLoader

describe(`Extreme Values (${SLOW ? 'slow mode' : 'fast mode'})`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Non-backing assets
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock
  let aaveMock: AaveLendingPoolMock
  let compoundOracleInternal: CompoundOracleMock
  let aaveOracleInternal: AaveOracleMock

  // Trading
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rToken: TestIRToken
  let main: TestIMain
  let facade: Facade
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let distributor: TestIDistributor

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let ERC20Mock: ContractFactory
  let ATokenMockFactory: ContractFactory
  let CTokenMockFactory: ContractFactory
  let ATokenCollateralFactory: ContractFactory
  let CTokenCollateralFactory: ContractFactory

  const DEFAULT_THRESHOLD = fp('0.05') // 5%
  const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
  const MAX_UOA = fp('1e29')

  before('create fixture loader', async () => {
    // Reset network for clean execution
    await hre.network.provider.send('hardhat_reset')
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])

    ERC20Mock = await ethers.getContractFactory('ERC20Mock')
    ATokenMockFactory = await ethers.getContractFactory('StaticATokenMock')
    CTokenMockFactory = await ethers.getContractFactory('CTokenMock')
    ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral')
    CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      compToken,
      aaveToken,
      compoundMock,
      aaveMock,
      config,
      main,
      assetRegistry,
      stRSR,
      backingManager,
      basketHandler,
      distributor,
      rToken,
      facade,
      rsrTrader,
      rTokenTrader,
      compoundOracleInternal,
      aaveOracleInternal,
    } = await loadFixture(defaultFixture))

    // Set backingBuffer to 0 to make math easy
    await backingManager.connect(owner).setBackingBuffer(0)
  })

  const prepAToken = async (index: number): Promise<StaticATokenMock> => {
    const underlying: ERC20Mock = <ERC20Mock>(
      await ERC20Mock.deploy(`ERC20_NAME:${index}`, `ERC20_SYM:${index}`)
    )
    await compoundOracleInternal.setPrice(await underlying.symbol(), bn('1e6'))
    await aaveOracleInternal.setPrice(underlying.address, bn('2.5e14'))
    const erc20: StaticATokenMock = <StaticATokenMock>(
      await ATokenMockFactory.deploy(
        `StaticAToken_NAME:${index}`,
        `StaticAToken_SYM:${index}`,
        underlying.address
      )
    )

    await erc20.setExchangeRate(fp('1'))
    // Set reward token
    await erc20.setAaveToken(aaveToken.address)
    const collateral = <ATokenFiatCollateral>(
      await ATokenCollateralFactory.deploy(
        erc20.address,
        MAX_UOA,
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        underlying.address,
        compoundMock.address,
        aaveMock.address,
        aaveToken.address
      )
    )
    await assetRegistry.connect(owner).register(collateral.address)
    return erc20
  }

  const prepCToken = async (index: number): Promise<CTokenMock> => {
    const underlying: ERC20Mock = <ERC20Mock>(
      await ERC20Mock.deploy(`ERC20_NAME:${index}`, `ERC20_SYM:${index}`)
    )
    await compoundOracleInternal.setPrice(await underlying.symbol(), bn('1e6'))
    const erc20: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy(
        `CToken_NAME:${index}`,
        `CToken_SYM:${index}`,
        underlying.address
      )
    )
    await erc20.setExchangeRate(fp('1'))

    const collateral = <CTokenFiatCollateral>(
      await CTokenCollateralFactory.deploy(
        erc20.address,
        MAX_UOA,
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        underlying.address,
        compoundMock.address,
        compToken.address
      )
    )
    await assetRegistry.connect(owner).register(collateral.address)
    return erc20
  }

  const setupTrading = async (stRSRCut: BigNumber) => {
    // Configure Distributor
    const rsrDist = bn(5).mul(stRSRCut).div(fp('1'))
    const rTokenDist = bn(5).mul(fp('1').sub(stRSRCut)).div(fp('1'))
    expect(rsrDist.add(rTokenDist)).to.equal(5)
    await expect(
      distributor
        .connect(owner)
        .setDistribution(STRSR_DEST, { rTokenDist: bn(0), rsrDist: rsrDist })
    )
      .to.emit(distributor, 'DistributionSet')
      .withArgs(STRSR_DEST, bn(0), rsrDist)
    await expect(
      distributor
        .connect(owner)
        .setDistribution(FURNACE_DEST, { rTokenDist: rTokenDist, rsrDist: bn(0) })
    )
      .to.emit(distributor, 'DistributionSet')
      .withArgs(FURNACE_DEST, rTokenDist, bn(0))

    // Eliminate auction frictions
    await backingManager.connect(owner).setDustAmount(0)
    await rsrTrader.connect(owner).setDustAmount(0)
    await rTokenTrader.connect(owner).setDustAmount(0)

    // Set prices
    await compoundOracleInternal.setPrice(await rsr.symbol(), bn('1e6'))
    await aaveOracleInternal.setPrice(rsr.address, bn('2.5e14'))
    await compoundOracleInternal.setPrice(await aaveToken.symbol(), bn('1e6'))
    await aaveOracleInternal.setPrice(aaveToken.address, bn('2.5e14'))
    await compoundOracleInternal.setPrice(await compToken.symbol(), bn('1e6'))

    // Replace RSR and RToken assets with larger maxTradeVolume settings
    const RTokenAssetFactory: ContractFactory = await ethers.getContractFactory('RTokenAsset')
    const RSRAssetFactory: ContractFactory = await ethers.getContractFactory('AavePricedAsset')
    const newRTokenAsset: RTokenAsset = <RTokenAsset>(
      await RTokenAssetFactory.deploy(rToken.address, MAX_UOA, main.address)
    )
    const newRSRAsset: AavePricedAsset = <AavePricedAsset>(
      await RSRAssetFactory.deploy(
        compToken.address,
        MAX_UOA,
        compoundMock.address,
        aaveMock.address
      )
    )
    await assetRegistry.connect(owner).swapRegistered(newRTokenAsset.address)
    await assetRegistry.connect(owner).swapRegistered(newRSRAsset.address)
  }

  const runRevenueAuctionsUntilCompletion = async () => {
    const erc20s = await assetRegistry.erc20s()
    let didStuff = true
    for (let i = 0; didStuff && i < 10; i++) {
      didStuff = false
      // Close any auctions and start new ones
      await facade.runAuctionsForAllTraders(main.address)

      expect(await backingManager.tradesOpen()).to.equal(0)
      const traders = [rsrTrader, rTokenTrader]
      for (const trader of traders) {
        for (const erc20 of erc20s) {
          const tradeAddr = await trader.trades(erc20)
          if (tradeAddr == ZERO_ADDRESS) continue

          didStuff = true
          const trade = <GnosisTrade>await ethers.getContractAt('GnosisTrade', tradeAddr)
          const gnosis = <EasyAuction>(
            await ethers.getContractAt('EasyAuction', await trade.gnosis())
          )
          const auctionId = await trade.auctionId()
          const [, , buy, sellAmt, buyAmt] = await gnosis.auctions(auctionId)
          expect(buy == rToken.address || buy == rsr.address)
          if (buy == rToken.address) {
            await whileImpersonating(backingManager.address, async (bmSigner) => {
              await rToken.connect(bmSigner).mint(addr1.address, buyAmt)
            })
            await rToken.connect(addr1).approve(gnosis.address, buyAmt)
            await gnosis.placeBid(auctionId, {
              bidder: addr1.address,
              sellAmount: sellAmt,
              buyAmount: buyAmt,
            })
          } else if (buy == rsr.address) {
            await rsr.connect(owner).mint(addr2.address, buyAmt)
            await rsr.connect(addr2).approve(gnosis.address, buyAmt)
            await gnosis.placeBid(auctionId, {
              bidder: addr2.address,
              sellAmount: sellAmt,
              buyAmount: buyAmt,
            })
          }
        }
      }

      // Advance time till auction ends
      await advanceTime(config.auctionLength.add(100).toString())
    }
  }

  context('Revenue: appreciation', function () {
    // STORY
    //
    // There are N apppreciating collateral in the basket.
    // Between 1 and N collateral appreciate X% (assume 0% backingBuffer)
    // Launch up to 2-2N auctions using surplus collateral for RSR/RToken.
    // Give result to Furnace/StRSR.
    //
    // DIMENSIONS
    //
    // 1. RToken supply
    // 2. Size of basket
    // 3. Prime basket weights
    // 4. # of decimals in collateral token
    // 5. Exchange rate after appreciation
    // 6. Symmetry of appreciation (evenly vs all in 1 collateral)
    // 7. StRSR cut (previously: f)

    async function runScenario(
      rTokenSupply: BigNumber,
      basketSize: number,
      primeWeight: BigNumber,
      collateralDecimals: number,
      appreciationExchangeRate: BigNumber,
      howManyAppreciate: number,
      stRSRCut: BigNumber
    ) {
      await setupTrading(stRSRCut)

      // Reign in the RToken supply if it's an unrealistic scenario
      const maxRTokenSupply = MAX_UOA.mul(bn('1e36')).div(appreciationExchangeRate.mul(primeWeight))
      if (rTokenSupply.gt(maxRTokenSupply)) rTokenSupply = maxRTokenSupply

      const primeBasket = []
      const targetAmts = []
      for (let i = 0; i < basketSize; i++) {
        expect(collateralDecimals == 8 || collateralDecimals == 18).to.equal(true)
        const token = collateralDecimals == 8 ? await prepCToken(i) : await prepAToken(i)
        primeBasket.push(token)
        targetAmts.push(primeWeight.div(basketSize).add(1)) // might sum to slightly over, is ok
        await token.connect(owner).mint(addr1.address, MAX_UINT256)
        await token.connect(addr1).approve(rToken.address, MAX_UINT256)
      }

      // Setup basket
      await basketHandler.connect(owner).setPrimeBasket(
        primeBasket.map((c) => c.address),
        targetAmts
      )
      await basketHandler.connect(owner).refreshBasket()

      // Issue rTokens
      await issueMany(rToken, rTokenSupply, addr1)
      expect(await rToken.balanceOf(addr1.address)).to.equal(rTokenSupply)

      // === Execution ===

      // Increase redemption rate
      for (let i = 0; i < primeBasket.length && i < howManyAppreciate; i++) {
        await primeBasket[i].setExchangeRate(appreciationExchangeRate)
      }

      await runRevenueAuctionsUntilCompletion()
    }

    let dimensions
    if (SLOW) {
      dimensions = [
        [fp('1e-6'), fp('1e30')], // RToken supply
        [1, 256], // basket size
        [fp('1e-6'), fp('1e3'), fp('1')], // prime basket weights
        [8, 18], // collateral decimals
        [fp('0'), fp('1e9'), fp('0.02')], // exchange rate at appreciation
        [1, 256], // how many collateral assets appreciate (up to)
        [fp('0'), fp('1'), fp('0.6')], // StRSR cut (f)
      ]
    } else {
      dimensions = [
        [fp('1e-6'), fp('1e30')], // RToken supply
        [7], // basket size
        [fp('1e-6'), fp('1e3')], // prime basket weights
        [8, 18], // collateral decimals
        [fp('1e9')], // exchange rate at appreciation
        [1], // how many collateral assets appreciate (up to)
        [fp('0.6')], // StRSR cut (f)
      ]
    }

    const cases = cartesianProduct(...dimensions)

    const numCases = cases.length.toString()
    cases.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runScenario(
          params[0] as BigNumber,
          params[1] as number,
          params[2] as BigNumber,
          params[3] as number,
          params[4] as BigNumber,
          params[5] as number,
          params[6] as BigNumber
        )
      })
    })
  })
  context('Revenue: rewards', function () {
    // STORY
    //
    // There are N reward-earning collateral in the basket.
    // A total amount of Y rewards is earned
    // Launch 1-2 auctions using rewards, for RSR/RToken.
    // Give result to Furnace/StRSR.
    //
    // DIMENSIONS
    //
    // 1. RToken supply (including this in order to check 0 supply case)
    // 2. Size of reward-earning basket tokens
    // 3. Number of reward tokens (1 or 2)
    // 4. Size of reward
    // 5. StRSR cut (previously: f)

    async function runScenario(
      rTokenSupply: BigNumber,
      basketSize: number,
      numRewardTokens: number,
      rewardTok: BigNumber, // whole tokens
      stRSRCut: BigNumber
    ) {
      await setupTrading(stRSRCut)

      // Replace registered reward assets with large maxTradeVolume assets
      const AaveAssetFactory: ContractFactory = await ethers.getContractFactory('AavePricedAsset')
      const CompoundAssetFactory: ContractFactory = await ethers.getContractFactory(
        'CompoundPricedAsset'
      )
      const newAaveAsset: AavePricedAsset = <AavePricedAsset>(
        await AaveAssetFactory.deploy(
          aaveToken.address,
          MAX_UOA,
          compoundMock.address,
          aaveMock.address
        )
      )
      const newCompAsset: CompoundPricedAsset = <CompoundPricedAsset>(
        await CompoundAssetFactory.deploy(compToken.address, MAX_UOA, compoundMock.address)
      )
      await assetRegistry.connect(owner).swapRegistered(newAaveAsset.address)
      await assetRegistry.connect(owner).swapRegistered(newCompAsset.address)

      // Set up prime basket
      const primeBasket = []
      const targetAmts = []
      for (let i = 0; i < basketSize; i++) {
        expect(numRewardTokens == 1 || numRewardTokens == 2).to.equal(true)
        let token
        if (numRewardTokens == 1) {
          token = await prepCToken(i)
        } else {
          token = i % 2 == 0 ? await prepCToken(i) : await prepAToken(i)
        }
        primeBasket.push(token)
        targetAmts.push(fp('1').div(basketSize))
        await token.connect(owner).mint(addr1.address, MAX_UINT256)
        await token.connect(addr1).approve(rToken.address, MAX_UINT256)
      }

      // Setup basket
      await basketHandler.connect(owner).setPrimeBasket(
        primeBasket.map((token) => token.address),
        targetAmts
      )
      await expect(basketHandler.connect(owner).refreshBasket()).to.emit(basketHandler, 'BasketSet')

      // Issue rTokens
      await issueMany(rToken, rTokenSupply, addr1)
      expect(await rToken.balanceOf(addr1.address)).to.equal(rTokenSupply)

      // === Execution ===

      // Grant rewards
      for (let i = 0; i < primeBasket.length; i++) {
        const decimals = await primeBasket[i].decimals()
        expect(decimals == 8 || decimals == 18).to.equal(true)
        if (decimals == 8) {
          // cToken
          const oldRewards = await compoundMock.compBalances(backingManager.address)
          const newRewards = rewardTok.mul(bn('1e8')).div(numRewardTokens)

          await compoundMock.setRewards(backingManager.address, oldRewards.add(newRewards))
        } else if (decimals == 18) {
          // aToken
          const aToken = <StaticATokenMock>primeBasket[i]
          const rewards = rewardTok.mul(bn('1e18')).div(numRewardTokens)
          await aToken.setRewards(backingManager.address, rewards)
        }
      }

      // Claim rewards
      await expect(backingManager.claimAndSweepRewards()).to.emit(backingManager, 'RewardsClaimed')

      // Do auctions
      await runRevenueAuctionsUntilCompletion()
    }

    let dimensions
    if (SLOW) {
      dimensions = [
        [fp('1e-6'), fp('1e30')], // RToken supply
        [1, 256], // basket size
        [1, 2], // num reward tokens
        [bn('0'), bn('1e11'), bn('1e6')], // reward amount (whole tokens), up to 100B supply tokens
        [fp('0'), fp('1'), fp('0.6')], // StRSR cut (f)
      ]
    } else {
      dimensions = [
        [fp('1e-6'), fp('1e30')], // RToken supply
        [1, 7], // basket size
        [2], // num reward tokens
        [bn('1e11')], // reward amount (whole tokens), up to 100B supply tokens
        [fp('0.6')], // StRSR cut (f)
      ]
    }
    const cases = cartesianProduct(...dimensions)

    const numCases = cases.length.toString()
    cases.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runScenario(
          params[0] as BigNumber,
          params[1] as number,
          params[2] as number,
          params[3] as BigNumber,
          params[4] as BigNumber
        )
      })
    })
  })

  context('Recovery from default', function () {
    const runRecapitalizationAuctions = async (rTokenSupply: BigNumber, basketSize: number) => {
      let uncapitalized = true
      const basketsNeeded = await rToken.basketsNeeded()

      // For small cases, we should be able to do `basketSize` non-RSR trades, and then 1 RSR trade
      // For big cases, the gnosis trade uint sizing prevents us from completing recapitalization
      // in a reasonable amount of time.

      // Run recap auctions
      const erc20s = await assetRegistry.erc20s()
      for (let i = 0; i < basketSize + 1 && uncapitalized; i++) {
        // Close any open auctions and launch new ones
        await facade.runAuctionsForAllTraders(main.address)

        for (const erc20 of erc20s) {
          const tradeAddr = await backingManager.trades(erc20)
          if (tradeAddr == ZERO_ADDRESS) continue

          const trade = <GnosisTrade>(
            await ethers.getContractAt('GnosisTrade', await backingManager.trades(erc20))
          )
          const gnosis = <EasyAuction>(
            await ethers.getContractAt('EasyAuction', await trade.gnosis())
          )
          const auctionId = await trade.auctionId()
          const [, , buy, sellAmt, minBuyAmt] = await gnosis.auctions(auctionId)
          const actualBuyAmt = minBuyAmt.eq(0) ? sellAmt : minBuyAmt
          const buyERC20 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', buy)
          await buyERC20.connect(addr1).approve(gnosis.address, actualBuyAmt)
          expect(sellAmt.gt(0)).to.equal(true)
          expect(actualBuyAmt.gt(0)).to.equal(true)
          await gnosis.placeBid(auctionId, {
            bidder: addr1.address,
            sellAmount: sellAmt,
            buyAmount: actualBuyAmt,
          })
        }

        // Advance time till auction ends
        await advanceTime(config.auctionLength.add(100).toString())
        uncapitalized = !(await basketHandler.fullyCapitalized())
      }

      // Should not have taken a haircut
      expect((await rToken.basketsNeeded()).gte(basketsNeeded)).to.equal(true)
      if (rTokenSupply.lt(bn('1e40'))) {
        expect(await basketHandler.fullyCapitalized()).to.equal(true)
      } else {
        expect(await backingManager.tradesOpen()).to.equal(1) // it should have tried
      }
    }

    // STORY
    //
    // There are N collateral in the basket.
    // Between 1 and N collateral default.
    // Switch basket to remaining good collateral, if any.
    // Run non-RSR auctions to completion.
    // Seize RSR and use for remainder.
    // Assert capitalized.
    //
    // DIMENSIONS
    //
    // 1. RToken supply
    // 2. Size of basket
    // 3. Prime basket weights
    // 4. # of decimals in collateral token
    // 5. Symmetry of default (1 or N tokens default)

    async function runScenario(
      rTokenSupply: BigNumber,
      basketSize: number,
      primeWeight: BigNumber,
      collateralDecimals: number,
      howManyDefault: number
    ) {
      await setupTrading(fp('0.6'))

      // Reign in the RToken supply if it's an unrealistic scenario
      const maxRTokenSupply = MAX_UOA.mul(bn('1e18')).div(primeWeight)
      if (rTokenSupply.gt(maxRTokenSupply)) rTokenSupply = maxRTokenSupply

      const primeBasket = []
      const targetAmts = []
      for (let i = 0; i < basketSize; i++) {
        expect(collateralDecimals == 8 || collateralDecimals == 18).to.equal(true)
        const token = collateralDecimals == 8 ? await prepCToken(i) : await prepAToken(i)
        primeBasket.push(token)
        targetAmts.push(primeWeight.div(basketSize).add(1))
        await token.connect(owner).mint(addr1.address, MAX_UINT256)
        await token.connect(addr1).approve(rToken.address, MAX_UINT256)
      }

      // Setup basket
      await basketHandler.connect(owner).setPrimeBasket(
        primeBasket.map((c) => c.address),
        targetAmts
      )
      await basketHandler.connect(owner).setBackupConfig(
        ethers.utils.formatBytes32String('USD'),
        basketSize,
        primeBasket.map((c) => c.address)
      )
      await basketHandler.connect(owner).refreshBasket()

      // Insure with RSR
      await rsr.connect(owner).mint(addr1.address, fp('1e29'))
      await rsr.connect(addr1).approve(stRSR.address, fp('1e29'))
      await stRSR.connect(addr1).stake(fp('1e29'))

      // Issue rTokens
      await issueMany(rToken, rTokenSupply, addr1)
      expect(await rToken.balanceOf(addr1.address)).to.equal(rTokenSupply)

      // === Execution ===

      // Default tokens
      for (let i = 0; i < primeBasket.length && i < howManyDefault; i++) {
        await primeBasket[i].setExchangeRate(fp('0.00001'))
      }

      await assetRegistry.refresh()
      await basketHandler.refreshBasket()
      await runRecapitalizationAuctions(rTokenSupply, basketSize)
    }

    let dimensions
    if (SLOW) {
      dimensions = [
        [fp('1e-6'), fp('1e30')], // RToken supply
        [1, 256], // basket size
        [fp('1e-6'), fp('1e3'), fp('1')], // prime basket weights
        [8, 18], // collateral decimals
        [1, 256], // how many collateral assets default (up to)
      ]
    } else {
      dimensions = [
        [fp('1e-6'), fp('1e30')], // RToken supply
        [7], // basket size
        [fp('1e-6'), fp('1e3')], // prime basket weights
        [8, 18], // collateral decimals
        [1], // how many collateral assets default (up to)
      ]
    }

    const cases = cartesianProduct(...dimensions)

    const numCases = cases.length.toString()
    cases.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runScenario(
          params[0] as BigNumber,
          params[1] as number,
          params[2] as BigNumber,
          params[3] as number,
          params[4] as number
        )
      })
    })
  })

  // This one is not really like the others, but it would muddy up Recapitalization.test.ts
  context('Basket Switching', function () {
    let AaveCollateralFactory: ContractFactory

    // Dimensions
    //
    // 1. Number of prime basket tokens
    // 2. Number of backup tokens
    // 3. Number of target units
    // 4. Asset.targetPerRef ({target/ref})
    // 5. TargetAmts to BUs ({target/BU})

    const runSimulation = async (
      numPrimeTokens: number,
      numBackupTokens: number,
      targetUnits: number,
      targetPerRefs: BigNumber,
      basketTargetAmt: BigNumber
    ) => {
      AaveCollateralFactory = await ethers.getContractFactory('AavePricedFiatCollateralMock')

      let firstCollateral: undefined | AavePricedFiatCollateralMock = undefined
      const makeToken = async (
        tokenName: string,
        targetUnit: string,
        targetPerRef: BigNumber
      ): Promise<ERC20Mock> => {
        const erc20: ERC20Mock = <ERC20Mock>await ERC20Mock.deploy(tokenName, `${tokenName} symbol`)
        const collateral: AavePricedFiatCollateralMock = <AavePricedFiatCollateralMock>(
          await AaveCollateralFactory.deploy(
            erc20.address,
            config.maxTradeVolume,
            fp('0.05'),
            bn('86400'),
            compoundMock.address,
            aaveMock.address,
            targetUnit,
            targetPerRef
          )
        )

        if (firstCollateral === undefined) firstCollateral = collateral
        await assetRegistry.register(collateral.address)
        await aaveOracleInternal.setPrice(erc20.address, targetPerRef)
        return erc20
      }

      ;({ assetRegistry, basketHandler, compoundMock, aaveMock } = await loadFixture(
        defaultFixture
      ))

      const primeERC20s = []
      const targetAmts = []
      for (let i = 0; i < numPrimeTokens; i++) {
        const targetUnit = ethers.utils.formatBytes32String((i % targetUnits).toString())
        const erc20 = await makeToken(`Token ${i}`, targetUnit, targetPerRefs)
        primeERC20s.push(erc20.address)
        targetAmts.push(basketTargetAmt.div(targetUnits))
      }

      const backups: [string[]] = [[]]
      for (let i = 1; i < targetUnits; i++) {
        backups.push([])
      }
      for (let i = 0; i < numBackupTokens; i++) {
        const index = i % targetUnits
        const targetUnit = ethers.utils.formatBytes32String(index.toString())

        // reuse erc20 if possible
        const erc20Addr =
          i < numPrimeTokens
            ? primeERC20s[i]
            : (await makeToken(`Token ${i}`, targetUnit, targetPerRefs)).address
        backups[index].push(erc20Addr)
      }
      for (let i = 0; i < targetUnits; i++) {
        const targetUnit = ethers.utils.formatBytes32String(i.toString())
        await basketHandler.setBackupConfig(targetUnit, numPrimeTokens, backups[i])
      }

      // Set prime basket with all collateral
      await basketHandler.setPrimeBasket(primeERC20s, targetAmts)
      await basketHandler.connect(owner).refreshBasket()

      // Unregister collateral and switch basket
      if (firstCollateral !== undefined) {
        firstCollateral = <AavePricedFiatCollateralMock>firstCollateral

        // Unregister calls `ensureValidBasket`
        await assetRegistry.unregister(firstCollateral.address)
      }
    }

    const size = SLOW ? 256 : 4 // Currently 256 takes >5 minutes to execute 32 cases

    const primeTokens = [size, 0]

    const backupTokens = [size, 0]

    const targetUnits = [size, 1]

    // 1e18 range centered around the expected case of fp('1')
    const targetPerRefs = [fp('1e-9'), fp('1e9')]

    // min weight: 0, max weight: 1000
    const basketTargetAmts = [fp('0'), fp('1e3')]

    const dimensions = [primeTokens, backupTokens, targetUnits, targetPerRefs, basketTargetAmts]

    // 2^5 = 32 cases
    const cases = cartesianProduct(...dimensions)
    const numCases = cases.length.toString()
    cases.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runSimulation(
          params[0] as number,
          params[1] as number,
          params[2] as number,
          params[3] as BigNumber,
          params[4] as BigNumber
        )
      })
    })
  })
})

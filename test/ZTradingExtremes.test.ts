import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig, MAX_ORACLE_TIMEOUT } from '../common/configuration'
import { FURNACE_DEST, STRSR_DEST, MAX_UINT256, ZERO_ADDRESS } from '../common/constants'
import { bn, fp, shortString, toBNDecimals } from '../common/numbers'
import {
  Asset,
  ATokenFiatCollateral,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  FiatCollateral,
  GnosisMock,
  GnosisTrade,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  OracleLib,
  TestIBackingManager,
  TestIDistributor,
  TestIStRSR,
  TestIRevenueTrader,
  TestIRToken,
  StaticATokenMock,
} from '../typechain'
import { advanceTime } from './utils/time'
import { defaultFixture, SLOW } from './fixtures'
import { cartesianProduct } from './utils/cases'
import { issueMany } from './utils/issue'
import { setOraclePrice } from './utils/oracles'

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
  let rsrAsset: Asset
  let aaveAsset: Asset
  let compAsset: Asset

  // Trading
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rToken: TestIRToken
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let distributor: TestIDistributor
  let oracleLib: OracleLib

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
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      compToken,
      aaveToken,
      compoundMock,
      config,
      assetRegistry,
      stRSR,
      backingManager,
      basketHandler,
      distributor,
      rToken,
      facade,
      facadeTest,
      rsrTrader,
      rTokenTrader,
      rsrAsset,
      aaveAsset,
      compAsset,
      oracleLib,
    } = await loadFixture(defaultFixture))

    ERC20Mock = await ethers.getContractFactory('ERC20Mock')
    ATokenMockFactory = await ethers.getContractFactory('StaticATokenMock')
    CTokenMockFactory = await ethers.getContractFactory('CTokenMock')
    ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })
    CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    // Set backingBuffer to 0 to make math easy
    await backingManager.connect(owner).setBackingBuffer(0)
  })

  const prepAToken = async (index: number): Promise<StaticATokenMock> => {
    const underlying: ERC20Mock = <ERC20Mock>(
      await ERC20Mock.deploy(`ERC20_NAME:${index}`, `ERC20_SYM:${index}`)
    )
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

    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    const collateral = <ATokenFiatCollateral>(
      await ATokenCollateralFactory.deploy(
        fp('1'),
        chainlinkFeed.address,
        erc20.address,
        aaveToken.address,
        MAX_UOA,
        MAX_ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT
      )
    )

    await assetRegistry.connect(owner).register(collateral.address)
    return erc20
  }

  const prepCToken = async (index: number): Promise<CTokenMock> => {
    const underlying: ERC20Mock = <ERC20Mock>(
      await ERC20Mock.deploy(`ERC20_NAME:${index}`, `ERC20_SYM:${index}`)
    )
    const erc20: CTokenMock = <CTokenMock>(
      await CTokenMockFactory.deploy(
        `CToken_NAME:${index}`,
        `CToken_SYM:${index}`,
        underlying.address
      )
    )
    await erc20.setExchangeRate(fp('1'))

    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    const collateral = <CTokenFiatCollateral>(
      await CTokenCollateralFactory.deploy(
        fp('0.02'),
        chainlinkFeed.address,
        erc20.address,
        compToken.address,
        MAX_UOA,
        MAX_ORACLE_TIMEOUT,
        ethers.utils.formatBytes32String('USD'),
        DEFAULT_THRESHOLD,
        DELAY_UNTIL_DEFAULT,
        await underlying.decimals(),
        compoundMock.address
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

    // Set prices
    await setOraclePrice(rsrAsset.address, bn('1e8'))
    await setOraclePrice(aaveAsset.address, bn('1e8'))
    await setOraclePrice(compAsset.address, bn('1e8'))

    // Replace RSR and RToken assets with larger maxTradeVolume settings
    const RTokenAssetFactory: ContractFactory = await ethers.getContractFactory('RTokenAsset')
    const RSRAssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
    const newRTokenAsset: Asset = <Asset>await RTokenAssetFactory.deploy(rToken.address, MAX_UOA)
    const newRSRAsset: Asset = <Asset>(
      await RSRAssetFactory.deploy(
        fp('1'),
        await rsrAsset.chainlinkFeed(),
        rsr.address,
        ZERO_ADDRESS,
        MAX_UOA,
        MAX_ORACLE_TIMEOUT
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
      await facadeTest.runAuctionsForAllTraders(rToken.address)

      expect(await backingManager.tradesOpen()).to.equal(0)
      const traders = [rsrTrader, rTokenTrader]
      for (const trader of traders) {
        for (const erc20 of erc20s) {
          const tradeAddr = await trader.trades(erc20)
          if (tradeAddr == ZERO_ADDRESS) continue

          didStuff = true
          const trade = <GnosisTrade>await ethers.getContractAt('GnosisTrade', tradeAddr)
          const gnosis = <GnosisMock>await ethers.getContractAt('GnosisMock', await trade.gnosis())
          const auctionId = await trade.auctionId()
          const [, , buy, sellAmt, buyAmt] = await gnosis.auctions(auctionId)
          expect(buy == rToken.address || buy == rsr.address)
          if (buy == rToken.address) {
            await issueMany(facade, rToken, buyAmt, addr1)
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
      await issueMany(facade, rToken, rTokenSupply, addr1)
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
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAaveAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          fp('1'),
          await aaveAsset.chainlinkFeed(),
          aaveToken.address,
          aaveToken.address,
          MAX_UOA,
          MAX_ORACLE_TIMEOUT
        )
      )
      const newCompAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          fp('1'),
          await compAsset.chainlinkFeed(),
          compToken.address,
          compToken.address,
          MAX_UOA,
          MAX_ORACLE_TIMEOUT
        )
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
      await issueMany(facade, rToken, rTokenSupply, addr1)
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
    const runRecollateralizationAuctions = async (rTokenSupply: BigNumber, basketSize: number) => {
      let uncapitalized = true
      const basketsNeeded = await rToken.basketsNeeded()

      // Run recap auctions
      const erc20s = await assetRegistry.erc20s()

      for (let i = 0; i < basketSize + 1 && uncapitalized; i++) {
        // Close any open auctions and launch new ones
        await facadeTest.runAuctionsForAllTraders(rToken.address)

        for (const erc20 of erc20s) {
          const tradeAddr = await backingManager.trades(erc20)
          if (tradeAddr == ZERO_ADDRESS) continue

          const trade = <GnosisTrade>(
            await ethers.getContractAt('GnosisTrade', await backingManager.trades(erc20))
          )
          const gnosis = <GnosisMock>await ethers.getContractAt('GnosisMock', await trade.gnosis())
          const auctionId = await trade.auctionId()
          const [, , buy, sellAmt, minBuyAmt] = await gnosis.auctions(auctionId)
          const actualBuyAmt = sellAmt.gt(minBuyAmt) ? sellAmt : minBuyAmt
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
        uncapitalized = !(await basketHandler.fullyCollateralized())
      }

      // Should not have taken a haircut
      expect((await rToken.basketsNeeded()).gte(basketsNeeded)).to.equal(true)

      // Should be capitalized or still capitalizing
      expect(
        (await basketHandler.fullyCollateralized()) || Boolean(await backingManager.tradesOpen())
      ).to.equal(true)
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
      await issueMany(facade, rToken, rTokenSupply, addr1)
      expect(await rToken.balanceOf(addr1.address)).to.equal(rTokenSupply)

      // === Execution ===

      // Default tokens
      for (let i = 0; i < primeBasket.length && i < howManyDefault; i++) {
        await primeBasket[i].setExchangeRate(fp('0.00001'))
      }

      await assetRegistry.refresh()
      await basketHandler.refreshBasket()
      await runRecollateralizationAuctions(rTokenSupply, basketSize)
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

  // This one is not really like the others, but it would muddy up Recollateralization.test.ts
  context('Basket Switching', function () {
    let CollateralFactory: ContractFactory

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
      CollateralFactory = await ethers.getContractFactory('FiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })

      let firstCollateral: undefined | FiatCollateral = undefined
      const makeToken = async (
        tokenName: string,
        targetUnit: string,
        targetPerRef: BigNumber
      ): Promise<ERC20Mock> => {
        const erc20: ERC20Mock = <ERC20Mock>await ERC20Mock.deploy(tokenName, `${tokenName} symbol`)
        const chainlinkFeed = <MockV3Aggregator>(
          await (
            await ethers.getContractFactory('MockV3Aggregator')
          ).deploy(8, toBNDecimals(targetPerRef, 8))
        )
        const collateral: FiatCollateral = <FiatCollateral>(
          await CollateralFactory.deploy(
            fp('1'),
            chainlinkFeed.address,
            erc20.address,
            aaveToken.address,
            config.rTokenMaxTradeVolume,
            MAX_ORACLE_TIMEOUT,
            targetUnit,
            fp('0.05'),
            bn('86400')
          )
        )

        if (firstCollateral === undefined) firstCollateral = collateral
        await assetRegistry.register(collateral.address)
        return erc20
      }

      ;({ assetRegistry, basketHandler, compoundMock } = await loadFixture(defaultFixture))

      const primeERC20s = []
      const targetAmts = []
      for (let i = 0; i < numPrimeTokens; i++) {
        const targetUnit = ethers.utils.formatBytes32String((i % targetUnits).toString())
        const erc20 = await makeToken(`Token ${i}`, targetUnit, targetPerRefs)
        primeERC20s.push(erc20.address)
        let targetAmt = basketTargetAmt.div(targetUnits)
        if (targetAmt.eq(bn(0))) targetAmt = bn(1)
        targetAmts.push(targetAmt)
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
        firstCollateral = <FiatCollateral>firstCollateral

        // Unregister calls `ensureValidBasket`
        await assetRegistry.unregister(firstCollateral.address)
      }
    }

    const size = SLOW ? 256 : 4 // Currently 256 takes >5 minutes to execute 32 cases

    const primeTokens = [size, 1]

    const backupTokens = [size, 0]

    const targetUnits = [size, 1]

    // 1e18 range centered around the expected case of fp('1')
    const targetPerRefs = [fp('1e-9'), fp('1e9')]

    // min weight: 0 (will wind up as 1), max weight: 1000
    const basketTargetAmts = [bn(0), fp('1e3')]

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

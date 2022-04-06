import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Wallet } from 'ethers'
import { ethers, upgrades, waffle } from 'hardhat'
import { ZERO_ADDRESS } from '../common/constants'
import { bn } from '../common/numbers'
import {
  Asset,
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  BrokerP1,
  DeployerP1,
  DistributorP1,
  ERC20Mock,
  FacadeP0,
  FurnaceP1,
  GnosisMock,
  IBasketHandler,
  MainP1,
  MainP1V2,
  RevenueTradingP1,
  RTokenAsset,
  RTokenP1,
  StRSRP1,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  TradingLibP1,
} from '../typechain'
import { defaultFixture, IComponents, IConfig, Implementation, IMPLEMENTATION } from './fixtures'

const createFixtureLoader = waffle.createFixtureLoader

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1(`Upgradeability - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress

  // Deployer contract
  let deployer: TestIDeployer

  // Config
  let config: IConfig

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Market / Facade
  let gnosis: GnosisMock
  let broker: TestIBroker
  let facade: FacadeP0

  // Core contracts
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let stRSR: TestIStRSR
  let furnace: TestIFurnace
  let main: TestIMain
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let distributor: TestIDistributor
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let tradingLib: TradingLibP1

  // Factories
  let MainFactory: ContractFactory
  let RTokenFactory: ContractFactory
  let FurnaceFactory: ContractFactory
  let RevenueTraderFactory: ContractFactory
  let BackingManagerFactory: ContractFactory
  let AssetRegistryFactory: ContractFactory
  let BasketHandlerFactory: ContractFactory
  let DistributorFactory: ContractFactory
  let BrokerFactory: ContractFactory
  let StRSRFactory: ContractFactory

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      config,
      deployer,
      main,
      assetRegistry,
      backingManager,
      basketHandler,
      distributor,
      rToken,
      rTokenAsset,
      furnace,
      stRSR,
      broker,
      gnosis,
      facade,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))

    // Deploy TradingLib external library
    const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP1')
    tradingLib = <TradingLibP1>await TradingLibFactory.deploy()

    // Setup factories
    MainFactory = await ethers.getContractFactory('MainP1')
    RTokenFactory = await ethers.getContractFactory('RTokenP1')
    FurnaceFactory = await ethers.getContractFactory('FurnaceP1')
    RevenueTraderFactory = await ethers.getContractFactory('RevenueTradingP1', {
      libraries: { TradingLibP1: tradingLib.address },
    })
    BackingManagerFactory = await ethers.getContractFactory('BackingManagerP1', {
      libraries: { TradingLibP1: tradingLib.address },
    })
    AssetRegistryFactory = await ethers.getContractFactory('AssetRegistryP1')

    BasketHandlerFactory = await ethers.getContractFactory('BasketHandlerP1')
    DistributorFactory = await ethers.getContractFactory('DistributorP1')
    BrokerFactory = await ethers.getContractFactory('BrokerP1')
    StRSRFactory = await ethers.getContractFactory('StRSRP1')

    // Import deployed proxies
    await upgrades.forceImport(main.address, MainFactory)
    await upgrades.forceImport(rToken.address, RTokenFactory)
    await upgrades.forceImport(furnace.address, FurnaceFactory)
    await upgrades.forceImport(rsrTrader.address, RevenueTraderFactory)
    await upgrades.forceImport(rTokenTrader.address, RevenueTraderFactory)
    await upgrades.forceImport(backingManager.address, BackingManagerFactory)
    await upgrades.forceImport(assetRegistry.address, AssetRegistryFactory)
    await upgrades.forceImport(basketHandler.address, BasketHandlerFactory)
    await upgrades.forceImport(distributor.address, DistributorFactory)
    await upgrades.forceImport(broker.address, BrokerFactory)
    await upgrades.forceImport(stRSR.address, StRSRFactory)
  })

  describe('Implementations', () => {
    it('Should deploy valid implementation - Main', async () => {
      const components: IComponents = {
        rToken: rToken.address,
        stRSR: stRSR.address,
        assetRegistry: assetRegistry.address,
        basketHandler: basketHandler.address,
        backingManager: backingManager.address,
        distributor: distributor.address,
        furnace: furnace.address,
        broker: broker.address,
        rsrTrader: rsrTrader.address,
        rTokenTrader: rTokenTrader.address,
      }

      const newMain: MainP1 = <MainP1>await upgrades.deployProxy(
        MainFactory,
        [components, rsr.address],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newMain.deployed()

      // Owner/Pauser - Paused by default
      expect(await newMain.paused()).to.equal(true)
      expect(await newMain.owner()).to.equal(owner.address)
      expect(await newMain.pauser()).to.equal(owner.address)

      // Components
      expect(await newMain.stRSR()).to.equal(stRSR.address)
      expect(await newMain.rToken()).to.equal(rToken.address)
      expect(await newMain.assetRegistry()).to.equal(assetRegistry.address)
      expect(await newMain.basketHandler()).to.equal(basketHandler.address)
      expect(await newMain.backingManager()).to.equal(backingManager.address)
      expect(await newMain.distributor()).to.equal(distributor.address)
      expect(await newMain.furnace()).to.equal(furnace.address)
      expect(await newMain.broker()).to.equal(broker.address)
      expect(await newMain.rsrTrader()).to.equal(rsrTrader.address)
      expect(await newMain.rTokenTrader()).to.equal(rTokenTrader.address)
    })

    it('Should deploy valid implementation - RToken', async () => {
      const newRToken: RTokenP1 = <RTokenP1>await upgrades.deployProxy(
        RTokenFactory,
        [main.address, 'RTKN RToken', 'RTKN', 'newConstitution', config.issuanceRate],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newRToken.deployed()

      expect(await newRToken.name()).to.equal('RTKN RToken')
      expect(await newRToken.symbol()).to.equal('RTKN')
      expect(await newRToken.decimals()).to.equal(18)
      expect(await newRToken.totalSupply()).to.equal(bn(0))
      expect(await newRToken.issuanceRate()).to.equal(config.issuanceRate)
      expect(await newRToken.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - Furnace', async () => {
      const newFurnace: FurnaceP1 = <FurnaceP1>await upgrades.deployProxy(
        FurnaceFactory,
        [main.address, config.rewardPeriod, config.rewardRatio],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newFurnace.deployed()

      expect(await newFurnace.period()).to.equal(config.rewardPeriod)
      expect(await newFurnace.ratio()).to.equal(config.rewardRatio)
      expect(await newFurnace.lastPayout()).to.be.gt(0) // A timestamp is set
      expect(await newFurnace.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - RevenueTrader', async () => {
      const newRevenueTrader: RevenueTradingP1 = <RevenueTradingP1>await upgrades.deployProxy(
        RevenueTraderFactory,
        [main.address, rsr.address, config.maxTradeSlippage, config.dustAmount],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['external-library-linking'], // Review - TradingLib
        }
      )
      await newRevenueTrader.deployed()

      expect(await newRevenueTrader.tokenToBuy()).to.equal(rsr.address)
      expect(await newRevenueTrader.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await newRevenueTrader.dustAmount()).to.equal(config.dustAmount)
      expect(await newRevenueTrader.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - BackingManager', async () => {
      const newBackingMgr: BackingManagerP1 = <BackingManagerP1>await upgrades.deployProxy(
        BackingManagerFactory,
        [
          main.address,
          config.tradingDelay,
          config.backingBuffer,
          config.maxTradeSlippage,
          config.dustAmount,
        ],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['external-library-linking'], // Review - TradingLib (external)
        }
      )
      await newBackingMgr.deployed()

      expect(await newBackingMgr.tradingDelay()).to.equal(config.tradingDelay)
      expect(await newBackingMgr.backingBuffer()).to.equal(config.backingBuffer)
      expect(await newBackingMgr.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await newBackingMgr.dustAmount()).to.equal(config.dustAmount)
      expect(await newBackingMgr.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - AssetRegistry', async () => {
      const newAssetRegistry: AssetRegistryP1 = <AssetRegistryP1>await upgrades.deployProxy(
        AssetRegistryFactory,
        [main.address, [rsrAsset.address, rTokenAsset.address]],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newAssetRegistry.deployed()

      expect(await newAssetRegistry.isRegistered(rsr.address)).to.equal(true)
      expect(await newAssetRegistry.isRegistered(rToken.address)).to.equal(true)
      expect(await newAssetRegistry.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - BasketHandler', async () => {
      const newBasketHandler: BasketHandlerP1 = <BasketHandlerP1>await upgrades.deployProxy(
        BasketHandlerFactory,
        [main.address],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newBasketHandler.deployed()

      expect(await newBasketHandler.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - Distributor', async () => {
      const newDistributor: DistributorP1 = <DistributorP1>await upgrades.deployProxy(
        DistributorFactory,
        [main.address, config.dist],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newDistributor.deployed()

      const totals = await newDistributor.totals()
      expect(totals.rsrTotal).equal(bn(60))
      expect(totals.rTokenTotal).equal(bn(40))
      expect(await newDistributor.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - Broker', async () => {
      const newBroker: BrokerP1 = <BrokerP1>await upgrades.deployProxy(
        BrokerFactory,
        [main.address, gnosis.address, config.auctionLength],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newBroker.deployed()

      expect(await newBroker.gnosis()).to.equal(gnosis.address)
      expect(await newBroker.auctionLength()).to.equal(config.auctionLength)
      expect(await newBroker.disabled()).to.equal(false)
      expect(await newBroker.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - StRSR', async () => {
      const newStRSR: StRSRP1 = <StRSRP1>await upgrades.deployProxy(
        StRSRFactory,
        [
          main.address,
          'stRTKNRSR Token',
          'stRTKNRSR',
          config.unstakingDelay,
          config.rewardPeriod,
          config.rewardRatio,
        ],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newStRSR.deployed()

      expect(await newStRSR.name()).to.equal('stRTKNRSR Token')
      expect(await newStRSR.symbol()).to.equal('stRTKNRSR')
      expect(await newStRSR.decimals()).to.equal(18)
      expect(await newStRSR.totalSupply()).to.equal(0)
      expect(await newStRSR.unstakingDelay()).to.equal(config.unstakingDelay)
      expect(await newStRSR.rewardPeriod()).to.equal(config.rewardPeriod)
      expect(await newStRSR.rewardRatio()).to.equal(config.rewardRatio)
      expect(await newStRSR.main()).to.equal(main.address)
    })
  })

  describe('Upgrades', () => {
    it('Should upgrade correctly - Main', async () => {
      // Upgrading
      const MainV2Factory: ContractFactory = await ethers.getContractFactory('MainP1V2')
      const mainV2: MainP1V2 = <MainP1V2>await upgrades.upgradeProxy(main.address, MainV2Factory)

      // Check address is maintained
      expect(mainV2.address).to.equal(main.address)

      // Check state is preserved
      expect(await mainV2.paused()).to.equal(false)
      expect(await mainV2.owner()).to.equal(owner.address)
      expect(await mainV2.pauser()).to.equal(owner.address)

      // Components
      expect(await mainV2.stRSR()).to.equal(stRSR.address)
      expect(await mainV2.rToken()).to.equal(rToken.address)
      expect(await mainV2.assetRegistry()).to.equal(assetRegistry.address)
      expect(await mainV2.basketHandler()).to.equal(basketHandler.address)
      expect(await mainV2.backingManager()).to.equal(backingManager.address)
      expect(await mainV2.distributor()).to.equal(distributor.address)
      expect(await mainV2.furnace()).to.equal(furnace.address)
      expect(await mainV2.broker()).to.equal(broker.address)
      expect(await mainV2.rsrTrader()).to.equal(rsrTrader.address)
      expect(await mainV2.rTokenTrader()).to.equal(rTokenTrader.address)

      // Check new version is implemented
      expect(await mainV2.version()).to.equal('V2')

      expect(await mainV2.newValue()).to.equal(0)
      await mainV2.connect(owner).setNewValue(bn(1000))
      expect(await mainV2.newValue()).to.equal(bn(1000))

      // Call new poke - even if paused
      await mainV2.connect(owner).pause()
      await expect(mainV2.poke()).to.emit(mainV2, 'PokedV2')
    })
  })
})

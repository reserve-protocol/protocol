import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Wallet } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { IComponents, IConfig } from '../common/configuration'
import { OWNER, SHORT_FREEZER, LONG_FREEZER, PAUSER } from '../common/constants'
import { bn } from '../common/numbers'
import {
  Asset,
  AssetRegistryP1,
  AssetRegistryP1V2,
  BackingManagerP1,
  BackingManagerP1V2,
  BasketHandlerP1,
  BasketHandlerP1V2,
  BrokerP1,
  BrokerP1V2,
  DistributorP1,
  DistributorP1V2,
  ERC20Mock,
  FurnaceP1,
  FurnaceP1V2,
  GnosisMock,
  GnosisTrade,
  IAssetRegistry,
  IBasketHandler,
  MainP1,
  MainP1V2,
  RevenueTraderP1,
  RevenueTraderP1V2,
  RTokenAsset,
  RTokenP1,
  RTokenP1V2,
  StRSRP1Votes,
  StRSRP1VotesV2,
  TestIBackingManager,
  TestIBroker,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  RecollateralizationLibP1,
} from '../typechain'
import { defaultFixture, Implementation, IMPLEMENTATION } from './fixtures'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1(`Upgradeability - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress

  // Config
  let config: IConfig

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Market / Facade
  let gnosis: GnosisMock
  let broker: TestIBroker

  // Core contracts
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let stRSR: TestIStRSR
  let furnace: TestIFurnace
  let main: TestIMain
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let distributor: TestIDistributor
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let tradingLib: RecollateralizationLibP1

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
  let TradeFactory: ContractFactory
  let StRSRFactory: ContractFactory

  let notWallet: Wallet

  before('create fixture loader', async () => {
    ;[, notWallet] = (await ethers.getSigners()) as unknown as Wallet[]
  })

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      config,
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
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))

    // Deploy TradingLib external library
    const TradingLibFactory: ContractFactory = await ethers.getContractFactory(
      'RecollateralizationLibP1'
    )
    tradingLib = <RecollateralizationLibP1>await TradingLibFactory.deploy()

    // Setup factories
    MainFactory = await ethers.getContractFactory('MainP1')
    RTokenFactory = await ethers.getContractFactory('RTokenP1')
    FurnaceFactory = await ethers.getContractFactory('FurnaceP1')
    RevenueTraderFactory = await ethers.getContractFactory('RevenueTraderP1')
    BackingManagerFactory = await ethers.getContractFactory('BackingManagerP1', {
      libraries: {
        RecollateralizationLibP1: tradingLib.address,
      },
    })
    AssetRegistryFactory = await ethers.getContractFactory('AssetRegistryP1')
    BasketHandlerFactory = await ethers.getContractFactory('BasketHandlerP1')
    DistributorFactory = await ethers.getContractFactory('DistributorP1')
    BrokerFactory = await ethers.getContractFactory('BrokerP1')
    TradeFactory = await ethers.getContractFactory('GnosisTrade')
    StRSRFactory = await ethers.getContractFactory('StRSRP1Votes')

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
        [components, rsr.address, 1, 1],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newMain.deployed()

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

    it('Should deploy valid implementation - BackingManager', async () => {
      const newBackingMgr: BackingManagerP1 = <BackingManagerP1>await upgrades.deployProxy(
        BackingManagerFactory,
        [
          main.address,
          config.tradingDelay,
          config.backingBuffer,
          config.maxTradeSlippage,
          config.minTradeVolume,
        ],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['external-library-linking', 'delegatecall'], // TradingLib (external)
        }
      )
      await newBackingMgr.deployed()

      expect(await newBackingMgr.tradingDelay()).to.equal(config.tradingDelay)
      expect(await newBackingMgr.backingBuffer()).to.equal(config.backingBuffer)
      expect(await newBackingMgr.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await newBackingMgr.main()).to.equal(main.address)
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

    it('Should deploy valid implementation - Broker / Trade', async () => {
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()

      const newBroker: BrokerP1 = <BrokerP1>await upgrades.deployProxy(
        BrokerFactory,
        [main.address, gnosis.address, trade.address, config.auctionLength],
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

      const [rTokenTotal, rsrTotal] = await newDistributor.totals()
      expect(rsrTotal).equal(bn(60))
      expect(rTokenTotal).equal(bn(40))
      expect(await newDistributor.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - Furnace', async () => {
      const newFurnace: FurnaceP1 = <FurnaceP1>await upgrades.deployProxy(
        FurnaceFactory,
        [main.address, config.rewardRatio],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newFurnace.deployed()

      expect(await newFurnace.ratio()).to.equal(config.rewardRatio)
      expect(await newFurnace.lastPayout()).to.be.gt(0)
      expect(await newFurnace.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - RevenueTrader', async () => {
      const newRevenueTrader: RevenueTraderP1 = <RevenueTraderP1>await upgrades.deployProxy(
        RevenueTraderFactory,
        [main.address, rsr.address, config.maxTradeSlippage, config.minTradeVolume],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['delegatecall'], // Multicall
        }
      )
      await newRevenueTrader.deployed()

      expect(await newRevenueTrader.tokenToBuy()).to.equal(rsr.address)
      expect(await newRevenueTrader.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await newRevenueTrader.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - RToken', async () => {
      const newRToken: RTokenP1 = <RTokenP1>await upgrades.deployProxy(
        RTokenFactory,
        [
          main.address,
          'RTKN RToken',
          'RTKN',
          'Manifesto',
          config.issuanceThrottle,
          config.redemptionThrottle,
        ],
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
      expect(await newRToken.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - StRSR', async () => {
      const newStRSR: StRSRP1Votes = <StRSRP1Votes>await upgrades.deployProxy(
        StRSRFactory,
        [main.address, 'rtknRSR Token', 'rtknRSR', config.unstakingDelay, config.rewardRatio],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newStRSR.deployed()

      expect(await newStRSR.name()).to.equal('rtknRSR Token')
      expect(await newStRSR.symbol()).to.equal('rtknRSR')
      expect(await newStRSR.decimals()).to.equal(18)
      expect(await newStRSR.totalSupply()).to.equal(0)
      expect(await newStRSR.unstakingDelay()).to.equal(config.unstakingDelay)
      expect(await newStRSR.rewardRatio()).to.equal(config.rewardRatio)
      expect(await newStRSR.main()).to.equal(main.address)
    })
  })

  describe('Upgrades', () => {
    it('Should only allow OWNER to upgrade - Main', async () => {
      const MainV2Factory: ContractFactory = await ethers.getContractFactory('MainP1V2', notWallet)
      await expect(upgrades.upgradeProxy(main.address, MainV2Factory)).revertedWith(
        `AccessControl: account ${notWallet.address.toLowerCase()} is missing role 0x4f574e4552000000000000000000000000000000000000000000000000000000`
      )
    })

    it('Should only allow governance to upgrade - Component', async () => {
      const AssetRegV2Factory: ContractFactory = await ethers.getContractFactory(
        'AssetRegistryP1V2',
        notWallet
      )
      await expect(upgrades.upgradeProxy(assetRegistry.address, AssetRegV2Factory)).revertedWith(
        'governance only'
      )
    })

    it('Should upgrade correctly - Main', async () => {
      // Upgrading
      const MainV2Factory: ContractFactory = await ethers.getContractFactory('MainP1V2')
      const mainV2: MainP1V2 = <MainP1V2>await upgrades.upgradeProxy(main.address, MainV2Factory)

      // Check address is maintained
      expect(mainV2.address).to.equal(main.address)

      // Check state is preserved
      expect(await mainV2.paused()).to.equal(false)
      expect(await mainV2.frozen()).to.equal(false)
      expect(await mainV2.pausedOrFrozen()).to.equal(false)
      expect(await mainV2.hasRole(OWNER, owner.address)).to.equal(true)
      expect(await mainV2.hasRole(OWNER, main.address)).to.equal(false)
      expect(await mainV2.hasRole(SHORT_FREEZER, owner.address)).to.equal(true)
      expect(await mainV2.hasRole(SHORT_FREEZER, main.address)).to.equal(false)
      expect(await mainV2.hasRole(LONG_FREEZER, owner.address)).to.equal(true)
      expect(await mainV2.hasRole(LONG_FREEZER, main.address)).to.equal(false)
      expect(await mainV2.hasRole(PAUSER, owner.address)).to.equal(true)
      expect(await mainV2.hasRole(PAUSER, main.address)).to.equal(false)

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
      expect(await mainV2.version()).to.equal('2.0.0')

      expect(await mainV2.newValue()).to.equal(0)
      await mainV2.connect(owner).setNewValue(bn(1000))
      expect(await mainV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - AssetRegistry', async () => {
      // Upgrading
      const AssetRegV2Factory: ContractFactory = await ethers.getContractFactory(
        'AssetRegistryP1V2'
      )
      const assetRegV2: AssetRegistryP1V2 = <AssetRegistryP1V2>(
        await upgrades.upgradeProxy(assetRegistry.address, AssetRegV2Factory)
      )

      // Check address is maintained
      expect(assetRegV2.address).to.equal(assetRegistry.address)

      // Check state is preserved
      expect(await assetRegV2.isRegistered(rsr.address)).to.equal(true)
      expect(await assetRegV2.isRegistered(rToken.address)).to.equal(true)
      expect(await assetRegV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await assetRegV2.version()).to.equal('2.0.0')

      expect(await assetRegV2.newValue()).to.equal(0)
      await assetRegV2.connect(owner).setNewValue(bn(1000))
      expect(await assetRegV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - BackingManager', async () => {
      // Upgrading
      const BackingMgrV2Factory: ContractFactory = await ethers.getContractFactory(
        'BackingManagerP1V2',
        {
          libraries: {
            RecollateralizationLibP1: tradingLib.address,
          },
        }
      )
      const backingMgrV2: BackingManagerP1V2 = <BackingManagerP1V2>await upgrades.upgradeProxy(
        backingManager.address,
        BackingMgrV2Factory,
        {
          unsafeAllow: ['external-library-linking', 'delegatecall'], // TradingLib
        }
      )

      // Check address is maintained
      expect(backingMgrV2.address).to.equal(backingManager.address)

      // Check state is preserved
      expect(await backingMgrV2.tradingDelay()).to.equal(config.tradingDelay)
      expect(await backingMgrV2.backingBuffer()).to.equal(config.backingBuffer)
      expect(await backingMgrV2.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await backingMgrV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await backingMgrV2.version()).to.equal('2.0.0')

      expect(await backingMgrV2.newValue()).to.equal(0)
      await backingMgrV2.connect(owner).setNewValue(bn(1000))
      expect(await backingMgrV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - BasketHandler', async () => {
      // Upgrading
      const BasketHandlerV2Factory: ContractFactory = await ethers.getContractFactory(
        'BasketHandlerP1V2'
      )
      const bskHndlrV2: BasketHandlerP1V2 = <BasketHandlerP1V2>(
        await upgrades.upgradeProxy(basketHandler.address, BasketHandlerV2Factory)
      )

      // Check address is maintained
      expect(bskHndlrV2.address).to.equal(basketHandler.address)

      // Check state is preserved
      expect(await bskHndlrV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await bskHndlrV2.version()).to.equal('2.0.0')

      expect(await bskHndlrV2.newValue()).to.equal(0)
      await bskHndlrV2.connect(owner).setNewValue(bn(1000))
      expect(await bskHndlrV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - Broker', async () => {
      // Upgrading
      const BrokerV2Factory: ContractFactory = await ethers.getContractFactory('BrokerP1V2')
      const brokerV2: BrokerP1V2 = <BrokerP1V2>(
        await upgrades.upgradeProxy(broker.address, BrokerV2Factory)
      )

      // Check address is maintained
      expect(brokerV2.address).to.equal(broker.address)

      // Check state is preserved
      expect(await brokerV2.gnosis()).to.equal(gnosis.address)
      expect(await brokerV2.auctionLength()).to.equal(config.auctionLength)
      expect(await brokerV2.disabled()).to.equal(false)
      expect(await brokerV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await brokerV2.version()).to.equal('2.0.0')

      expect(await brokerV2.newValue()).to.equal(0)
      await brokerV2.connect(owner).setNewValue(bn(1000))
      expect(await brokerV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - Distributor', async () => {
      // Upgrading
      const DistributorV2Factory: ContractFactory = await ethers.getContractFactory(
        'DistributorP1V2'
      )
      const distributorV2: DistributorP1V2 = <DistributorP1V2>(
        await upgrades.upgradeProxy(distributor.address, DistributorV2Factory)
      )

      // Check address is maintained
      expect(distributorV2.address).to.equal(distributor.address)

      // Check state is preserved
      const [rTokenTotal, rsrTotal] = await distributorV2.totals()
      expect(rsrTotal).equal(bn(60))
      expect(rTokenTotal).equal(bn(40))
      expect(await distributorV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await distributorV2.version()).to.equal('2.0.0')

      expect(await distributorV2.newValue()).to.equal(0)
      await distributorV2.connect(owner).setNewValue(bn(1000))
      expect(await distributorV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - Furnace', async () => {
      // Upgrading
      const FurnaceV2Factory: ContractFactory = await ethers.getContractFactory('FurnaceP1V2')
      const furnaceV2: FurnaceP1V2 = <FurnaceP1V2>(
        await upgrades.upgradeProxy(furnace.address, FurnaceV2Factory)
      )

      // Check address is maintained
      expect(furnaceV2.address).to.equal(furnace.address)

      // Check state is preserved
      expect(await furnaceV2.ratio()).to.equal(config.rewardRatio)
      expect(await furnaceV2.lastPayout()).to.be.gt(0) // A timestamp is set
      expect(await furnaceV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await furnaceV2.version()).to.equal('2.0.0')

      expect(await furnaceV2.newValue()).to.equal(0)
      await furnaceV2.connect(owner).setNewValue(bn(1000))
      expect(await furnaceV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - RevenueTrader', async () => {
      // Upgrading
      const RevTraderV2Factory: ContractFactory = await ethers.getContractFactory(
        'RevenueTraderP1V2'
      )
      const rsrTraderV2: RevenueTraderP1V2 = <RevenueTraderP1V2>await upgrades.upgradeProxy(
        rsrTrader.address,
        RevTraderV2Factory,
        {
          unsafeAllow: ['delegatecall'], // Multicall
        }
      )

      const rTokenTraderV2: RevenueTraderP1V2 = <RevenueTraderP1V2>await upgrades.upgradeProxy(
        rTokenTrader.address,
        RevTraderV2Factory,
        {
          unsafeAllow: ['delegatecall'], // Multicall
        }
      )

      // Check addresses are maintained
      expect(rsrTraderV2.address).to.equal(rsrTrader.address)
      expect(rTokenTraderV2.address).to.equal(rTokenTrader.address)

      // Check state is preserved
      expect(await rsrTraderV2.tokenToBuy()).to.equal(rsr.address)
      expect(await rsrTraderV2.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await rsrTraderV2.main()).to.equal(main.address)

      expect(await rTokenTraderV2.tokenToBuy()).to.equal(rToken.address)
      expect(await rTokenTraderV2.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await rTokenTraderV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await rsrTraderV2.version()).to.equal('2.0.0')
      expect(await rTokenTraderV2.version()).to.equal('2.0.0')

      expect(await rsrTraderV2.newValue()).to.equal(0)
      await rsrTraderV2.connect(owner).setNewValue(bn(1000))
      expect(await rsrTraderV2.newValue()).to.equal(bn(1000))

      expect(await rTokenTraderV2.newValue()).to.equal(0)
      await rTokenTraderV2.connect(owner).setNewValue(bn(500))
      expect(await rTokenTraderV2.newValue()).to.equal(bn(500))
    })

    it('Should upgrade correctly - RToken', async () => {
      // Upgrading
      const RTokenV2Factory: ContractFactory = await ethers.getContractFactory('RTokenP1V2')
      const rTokenV2: RTokenP1V2 = <RTokenP1V2>(
        await upgrades.upgradeProxy(rToken.address, RTokenV2Factory)
      )

      // Check address is maintained
      expect(rTokenV2.address).to.equal(rToken.address)

      // Check state is preserved
      expect(await rTokenV2.name()).to.equal('RTKN RToken')
      expect(await rTokenV2.symbol()).to.equal('RTKN')
      expect(await rTokenV2.decimals()).to.equal(18)
      expect(await rTokenV2.totalSupply()).to.equal(bn(0))
      expect(await rTokenV2.main()).to.equal(main.address)
      const issThrottle = await rToken.issuanceThrottleParams()
      expect(issThrottle.amtRate).to.equal(config.issuanceThrottle.amtRate)
      expect(issThrottle.pctRate).to.equal(config.issuanceThrottle.pctRate)
      const redemptionThrottle = await rToken.redemptionThrottleParams()
      expect(redemptionThrottle.amtRate).to.equal(config.redemptionThrottle.amtRate)
      expect(redemptionThrottle.pctRate).to.equal(config.redemptionThrottle.pctRate)

      // Check new version is implemented
      expect(await rTokenV2.version()).to.equal('2.0.0')

      expect(await rTokenV2.newValue()).to.equal(0)
      await rTokenV2.connect(owner).setNewValue(bn(1000))
      expect(await rTokenV2.newValue()).to.equal(bn(1000))
    })

    it('Should upgrade correctly - StRSR', async () => {
      // Upgrading
      const StRSRV2Factory: ContractFactory = await ethers.getContractFactory('StRSRP1VotesV2')
      const stRSRV2: StRSRP1VotesV2 = <StRSRP1VotesV2>(
        await upgrades.upgradeProxy(stRSR.address, StRSRV2Factory)
      )

      // Check address is maintained
      expect(stRSRV2.address).to.equal(stRSR.address)

      // Check state is preserved
      expect(await stRSRV2.name()).to.equal('rtknRSR Token')
      expect(await stRSRV2.symbol()).to.equal('rtknRSR')
      expect(await stRSRV2.decimals()).to.equal(18)
      expect(await stRSRV2.totalSupply()).to.equal(0)
      expect(await stRSRV2.unstakingDelay()).to.equal(config.unstakingDelay)
      expect(await stRSRV2.rewardRatio()).to.equal(config.rewardRatio)
      expect(await stRSRV2.main()).to.equal(main.address)

      // Check new version is implemented
      expect(await stRSRV2.version()).to.equal('2.0.0')

      expect(await stRSRV2.newValue()).to.equal(0)
      await stRSRV2.connect(owner).setNewValue(bn(1000))
      expect(await stRSRV2.newValue()).to.equal(bn(1000))
    })
  })
})

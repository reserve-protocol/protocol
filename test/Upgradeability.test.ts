import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { IComponents, IConfig, IImplementations } from '../common/configuration'
import { OWNER, SHORT_FREEZER, LONG_FREEZER, PAUSER } from '../common/constants'
import { whileImpersonating } from './utils/impersonation'
import { bn } from '../common/numbers'
import {
  Asset,
  AssetRegistryP1,
  AssetRegistryP1V2,
  BackingManagerP1,
  BackingManagerP1V2,
  BasketHandlerP1,
  BasketHandlerP1V2,
  BasketLibP1,
  BrokerP1,
  BrokerP1V2,
  DeployerP1,
  DistributorP1,
  DistributorP1V2,
  DutchTrade,
  ERC20Mock,
  FurnaceP1,
  FurnaceP1V2,
  GnosisMock,
  GnosisTrade,
  IAssetRegistry,
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
  TestIBasketHandler,
  TestIBroker,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  RecollateralizationLibP1,
  VersionRegistry,
  DeployerP1V2,
  AssetPluginRegistry,
} from '../typechain'
import { defaultFixture, Implementation, IMPLEMENTATION } from './fixtures'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

const MAIN_OWNER_ROLE = '0x4f574e4552000000000000000000000000000000000000000000000000000000'

// Helper function to calculate hash for a specific version
const toHash = (version: string): string => {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(version))
}

describeP1(`Upgradeability - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let other: SignerWithAddress

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
  let basketHandler: TestIBasketHandler
  let distributor: TestIDistributor
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader
  let tradingLib: RecollateralizationLibP1
  let basketLib: BasketLibP1
  let deployer: DeployerP1

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
  let GnosisTradeFactory: ContractFactory
  let DutchTradeFactory: ContractFactory
  let StRSRFactory: ContractFactory

  beforeEach(async () => {
    ;[owner, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      deployer,
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

    // Deploy BasketLib external library
    const BasketLibFactory: ContractFactory = await ethers.getContractFactory('BasketLibP1')
    basketLib = <BasketLibP1>await BasketLibFactory.deploy()

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
    BasketHandlerFactory = await ethers.getContractFactory('BasketHandlerP1', {
      libraries: { BasketLibP1: basketLib.address },
    })
    DistributorFactory = await ethers.getContractFactory('DistributorP1')
    BrokerFactory = await ethers.getContractFactory('BrokerP1')
    GnosisTradeFactory = await ethers.getContractFactory('GnosisTrade')
    DutchTradeFactory = await ethers.getContractFactory('DutchTrade')
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
        [main.address, config.warmupPeriod, config.reweightable, config.enableIssuancePremium],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['external-library-linking'],
        }
      )
      await newBasketHandler.deployed()

      expect(await newBasketHandler.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - Broker / Trade', async () => {
      const gnosisTrade: GnosisTrade = <GnosisTrade>await GnosisTradeFactory.deploy()
      const dutchTrade: DutchTrade = <DutchTrade>await DutchTradeFactory.deploy()

      const newBroker: BrokerP1 = <BrokerP1>await upgrades.deployProxy(
        BrokerFactory,
        [
          main.address,
          gnosis.address,
          gnosisTrade.address,
          config.batchAuctionLength,
          dutchTrade.address,
          config.dutchAuctionLength,
        ],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newBroker.deployed()

      expect(await newBroker.gnosis()).to.equal(gnosis.address)
      expect(await newBroker.batchAuctionLength()).to.equal(config.batchAuctionLength)
      expect(await newBroker.dutchAuctionLength()).to.equal(config.dutchAuctionLength)
      expect(await newBroker.batchTradeDisabled()).to.equal(false)
      expect(await newBroker.dutchTradeDisabled(rToken.address)).to.equal(false)
      expect(await newBroker.dutchTradeDisabled(rsr.address)).to.equal(false)
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
      expect(rsrTotal).equal(bn(6000))
      expect(rTokenTotal).equal(bn(4000))
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
        [
          main.address,
          'rtknRSR Token',
          'rtknRSR',
          config.unstakingDelay,
          config.rewardRatio,
          config.withdrawalLeak,
        ],
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
    it('Should only allow Main to upgrade itself', async () => {
      const MainV2Factory: ContractFactory = await ethers.getContractFactory('MainP1V2')
      const mainV2ImplAddr = (await upgrades.prepareUpgrade(main.address, MainV2Factory, {
        kind: 'uups',
      })) as string

      const upgMain = <MainP1>await ethers.getContractAt('MainP1', main.address)
      await expect(upgMain.connect(owner).upgradeTo(mainV2ImplAddr)).revertedWith('not self')
    })

    it('Should only allow Main to upgrade - Component', async () => {
      const AssetRegV2Factory: ContractFactory = await ethers.getContractFactory(
        'AssetRegistryP1V2'
      )

      const assetRegV2ImplAddr = (await upgrades.prepareUpgrade(
        assetRegistry.address,
        AssetRegV2Factory,
        {
          kind: 'uups',
        }
      )) as string

      const upgAR = <AssetRegistryP1>(
        await ethers.getContractAt('AssetRegistryP1', assetRegistry.address)
      )
      await expect(upgAR.connect(owner).upgradeTo(assetRegV2ImplAddr)).revertedWith('main only')
    })

    context('With deployed implementations', function () {
      let MainV2Factory: ContractFactory
      let AssetRegV2Factory: ContractFactory
      let BackingMgrV2Factory: ContractFactory
      let BasketHandlerV2Factory: ContractFactory
      let BrokerV2Factory: ContractFactory
      let DistributorV2Factory: ContractFactory
      let FurnaceV2Factory: ContractFactory
      let RevTraderV2Factory: ContractFactory
      let RTokenV2Factory: ContractFactory
      let StRSRV2Factory: ContractFactory

      let mainV2ImplAddr: string
      let assetRegV2ImplAddr: string
      let backingMgrV2ImplAddr: string
      let bskHndlrV2ImplAddr: string
      let brokerV2ImplAddr: string
      let distributorV2ImplAddr: string
      let furnaceV2ImplAddr: string
      let rsrTraderV2ImplAddr: string
      let rTokenTraderV2ImplAddr: string
      let rTokenV2ImplAddr: string
      let stRSRV2ImplAddr: string

      beforeEach(async () => {
        MainV2Factory = await ethers.getContractFactory('MainP1V2')
        AssetRegV2Factory = await ethers.getContractFactory('AssetRegistryP1V2')
        BackingMgrV2Factory = await ethers.getContractFactory('BackingManagerP1V2', {
          libraries: {
            RecollateralizationLibP1: tradingLib.address,
          },
        })

        BasketHandlerV2Factory = await ethers.getContractFactory('BasketHandlerP1V2', {
          libraries: { BasketLibP1: basketLib.address },
        })

        BrokerV2Factory = await ethers.getContractFactory('BrokerP1V2')
        DistributorV2Factory = await ethers.getContractFactory('DistributorP1V2')
        FurnaceV2Factory = await ethers.getContractFactory('FurnaceP1V2')
        RevTraderV2Factory = await ethers.getContractFactory('RevenueTraderP1V2')
        RTokenV2Factory = await ethers.getContractFactory('RTokenP1V2')
        StRSRV2Factory = await ethers.getContractFactory('StRSRP1VotesV2')

        mainV2ImplAddr = (await upgrades.prepareUpgrade(main.address, MainV2Factory, {
          kind: 'uups',
        })) as string

        assetRegV2ImplAddr = (await upgrades.prepareUpgrade(
          assetRegistry.address,
          AssetRegV2Factory,
          {
            kind: 'uups',
          }
        )) as string

        backingMgrV2ImplAddr = (await upgrades.prepareUpgrade(
          backingManager.address,
          BackingMgrV2Factory,
          {
            kind: 'uups',
            unsafeAllow: ['external-library-linking', 'delegatecall'], // TradingLib
          }
        )) as string

        bskHndlrV2ImplAddr = (await upgrades.prepareUpgrade(
          basketHandler.address,
          BasketHandlerV2Factory,
          {
            kind: 'uups',
            unsafeAllow: ['external-library-linking'], // BasketLibP1
          }
        )) as string

        brokerV2ImplAddr = (await upgrades.prepareUpgrade(broker.address, BrokerV2Factory, {
          kind: 'uups',
        })) as string

        distributorV2ImplAddr = (await upgrades.prepareUpgrade(
          distributor.address,
          DistributorV2Factory,
          {
            kind: 'uups',
          }
        )) as string

        furnaceV2ImplAddr = (await upgrades.prepareUpgrade(furnace.address, FurnaceV2Factory, {
          kind: 'uups',
        })) as string

        rsrTraderV2ImplAddr = (await upgrades.prepareUpgrade(
          rsrTrader.address,
          RevTraderV2Factory,
          {
            kind: 'uups',
            unsafeAllow: ['delegatecall'], // Multicall
          }
        )) as string

        rTokenTraderV2ImplAddr = (await upgrades.prepareUpgrade(
          rTokenTrader.address,
          RevTraderV2Factory,
          {
            kind: 'uups',
            unsafeAllow: ['delegatecall'], // Multicall
          }
        )) as string

        rTokenV2ImplAddr = (await upgrades.prepareUpgrade(rToken.address, RTokenV2Factory, {
          kind: 'uups',
        })) as string

        stRSRV2ImplAddr = (await upgrades.prepareUpgrade(stRSR.address, StRSRV2Factory, {
          kind: 'uups',
        })) as string
      })

      it('Should upgrade correctly - Main', async () => {
        const upgMain = <MainP1>await ethers.getContractAt('MainP1', main.address)

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgMain.connect(upgSigner).upgradeTo(mainV2ImplAddr)
        })

        const mainV2: MainP1V2 = <MainP1V2>await ethers.getContractAt('MainP1V2', main.address)

        // Check address is maintained
        expect(mainV2.address).to.equal(main.address)

        // Check state is preserved
        expect(await mainV2.tradingPaused()).to.equal(false)
        expect(await mainV2.issuancePaused()).to.equal(false)
        expect(await mainV2.frozen()).to.equal(false)
        expect(await mainV2.tradingPausedOrFrozen()).to.equal(false)
        expect(await mainV2.issuancePausedOrFrozen()).to.equal(false)
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
        const upgAR = <AssetRegistryP1>(
          await ethers.getContractAt('AssetRegistryP1', assetRegistry.address)
        )

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgAR.connect(upgSigner).upgradeTo(assetRegV2ImplAddr)
        })

        const assetRegV2: AssetRegistryP1V2 = <AssetRegistryP1V2>(
          await ethers.getContractAt('AssetRegistryP1V2', assetRegistry.address)
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
        const upgBM = <BackingManagerP1>(
          await ethers.getContractAt('BackingManagerP1', backingManager.address)
        )

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgBM.connect(upgSigner).upgradeTo(backingMgrV2ImplAddr)
        })

        const backingMgrV2: BackingManagerP1V2 = <BackingManagerP1V2>(
          await ethers.getContractAt('BackingManagerP1V2', backingManager.address)
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
        const upgBH = <BasketHandlerP1>(
          await ethers.getContractAt('BasketHandlerP1', basketHandler.address)
        )

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgBH.connect(upgSigner).upgradeTo(bskHndlrV2ImplAddr)
        })

        const bskHndlrV2: BasketHandlerP1V2 = <BasketHandlerP1V2>(
          await ethers.getContractAt('BasketHandlerP1V2', basketHandler.address)
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
        const upgBroker = <BrokerP1>await ethers.getContractAt('BrokerP1', broker.address)

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgBroker.connect(upgSigner).upgradeTo(brokerV2ImplAddr)
        })

        const brokerV2: BrokerP1V2 = <BrokerP1V2>(
          await ethers.getContractAt('BrokerP1V2', broker.address)
        )

        // Check address is maintained
        expect(brokerV2.address).to.equal(broker.address)

        // Check state is preserved
        expect(await brokerV2.gnosis()).to.equal(gnosis.address)
        expect(await brokerV2.batchAuctionLength()).to.equal(config.batchAuctionLength)
        expect(await brokerV2.batchTradeDisabled()).to.equal(false)
        expect(await brokerV2.dutchTradeDisabled(rToken.address)).to.equal(false)
        expect(await brokerV2.dutchTradeDisabled(rsr.address)).to.equal(false)
        expect(await brokerV2.main()).to.equal(main.address)

        // Check new version is implemented
        expect(await brokerV2.version()).to.equal('2.0.0')

        expect(await brokerV2.newValue()).to.equal(0)
        await brokerV2.connect(owner).setNewValue(bn(1000))
        expect(await brokerV2.newValue()).to.equal(bn(1000))
      })

      it('Should upgrade correctly - Distributor', async () => {
        const upgDist = <DistributorP1>(
          await ethers.getContractAt('DistributorP1', distributor.address)
        )

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgDist.connect(upgSigner).upgradeTo(distributorV2ImplAddr)
        })

        const distributorV2: DistributorP1V2 = <DistributorP1V2>(
          await ethers.getContractAt('DistributorP1V2', distributor.address)
        )

        // Check address is maintained
        expect(distributorV2.address).to.equal(distributor.address)

        // Check state is preserved
        const [rTokenTotal, rsrTotal] = await distributorV2.totals()
        expect(rsrTotal).equal(bn(6000))
        expect(rTokenTotal).equal(bn(4000))
        expect(await distributorV2.main()).to.equal(main.address)

        // Check new version is implemented
        expect(await distributorV2.version()).to.equal('2.0.0')

        expect(await distributorV2.newValue()).to.equal(0)
        await distributorV2.connect(owner).setNewValue(bn(1000))
        expect(await distributorV2.newValue()).to.equal(bn(1000))
      })

      it('Should upgrade correctly - Furnace', async () => {
        const upgFur = <FurnaceP1>await ethers.getContractAt('FurnaceP1', furnace.address)

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgFur.connect(upgSigner).upgradeTo(furnaceV2ImplAddr)
        })

        const furnaceV2: FurnaceP1V2 = <FurnaceP1V2>(
          await ethers.getContractAt('FurnaceP1V2', furnace.address)
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
        const upgRSRRevTrader = <RevenueTraderP1>(
          await ethers.getContractAt('RevenueTraderP1', rsrTrader.address)
        )
        const upgRTokRevTrader = <RevenueTraderP1>(
          await ethers.getContractAt('RevenueTraderP1', rTokenTrader.address)
        )

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgRSRRevTrader.connect(upgSigner).upgradeTo(rsrTraderV2ImplAddr)
        })
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgRTokRevTrader.connect(upgSigner).upgradeTo(rTokenTraderV2ImplAddr)
        })

        const rsrTraderV2: RevenueTraderP1V2 = <RevenueTraderP1V2>(
          await ethers.getContractAt('RevenueTraderP1V2', rsrTrader.address)
        )

        const rTokenTraderV2: RevenueTraderP1V2 = <RevenueTraderP1V2>(
          await ethers.getContractAt('RevenueTraderP1V2', rTokenTrader.address)
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
        const upgRToken = <RTokenP1>await ethers.getContractAt('RTokenP1', rToken.address)

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgRToken.connect(upgSigner).upgradeTo(rTokenV2ImplAddr)
        })

        const rTokenV2: RTokenP1V2 = <RTokenP1V2>(
          await ethers.getContractAt('RTokenP1V2', rToken.address)
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
        const upgStRSR = <StRSRP1Votes>await ethers.getContractAt('StRSRP1Votes', stRSR.address)

        // Upgrade via Main
        await whileImpersonating(main.address, async (upgSigner) => {
          await upgStRSR.connect(upgSigner).upgradeTo(stRSRV2ImplAddr)
        })

        const stRSRV2: StRSRP1VotesV2 = <StRSRP1VotesV2>(
          await ethers.getContractAt('StRSRP1VotesV2', stRSR.address)
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

      context('Using Registries', function () {
        let versionRegistry: VersionRegistry
        let assetPluginRegistry: AssetPluginRegistry

        let implementationsV2: IImplementations
        let deployerV2: DeployerP1V2

        beforeEach(async () => {
          const versionRegistryFactory = await ethers.getContractFactory('VersionRegistry')
          const mockRoleRegistryFactory = await ethers.getContractFactory('MockRoleRegistry')
          const mockRoleRegistry = await mockRoleRegistryFactory.deploy()
          versionRegistry = await versionRegistryFactory.deploy(mockRoleRegistry.address)

          const assetPluginRegistryFactory = await ethers.getContractFactory('AssetPluginRegistry')
          assetPluginRegistry = await assetPluginRegistryFactory.deploy(versionRegistry.address)

          // Prepare V2 Deployer and register new version
          implementationsV2 = {
            main: mainV2ImplAddr,
            components: {
              assetRegistry: assetRegV2ImplAddr,
              basketHandler: bskHndlrV2ImplAddr,
              distributor: distributorV2ImplAddr,
              broker: brokerV2ImplAddr,
              backingManager: backingMgrV2ImplAddr,
              furnace: furnaceV2ImplAddr,
              rToken: rTokenV2ImplAddr,
              rsrTrader: rsrTraderV2ImplAddr,
              rTokenTrader: rTokenTraderV2ImplAddr,
              stRSR: stRSRV2ImplAddr,
            },
            trading: {
              gnosisTrade: await broker.batchTradeImplementation(),
              dutchTrade: await broker.dutchTradeImplementation(),
            },
          }

          const DeployerV2Factory = await ethers.getContractFactory('DeployerP1V2')
          deployerV2 = await DeployerV2Factory.deploy(
            rsr.address,
            gnosis.address,
            rsrAsset.address,
            implementationsV2
          )
        })
        it('Should upgrade all contracts at once - Using Registries', async () => {
          // Register current deployment
          await versionRegistry.connect(owner).registerVersion(deployer.address)

          // Register new deployment
          await versionRegistry.connect(owner).registerVersion(deployerV2.address)

          // Update Main to new version
          const versionV1Hash = toHash(await deployer.version())
          const versionV2Hash = toHash(await deployerV2.version())
          const upgMain = <MainP1>await ethers.getContractAt('MainP1', main.address)

          // Update Main to have a Registry
          await main.connect(owner).setVersionRegistry(versionRegistry.address)

          // Upgrade Main
          expect(toHash(await main.version())).to.equal(versionV1Hash)
          await upgMain.connect(owner).upgradeMainTo(versionV2Hash)
          expect(toHash(await main.version())).to.equal(versionV2Hash)

          // Components still in original version
          expect(toHash(await assetRegistry.version())).to.equal(versionV1Hash)
          expect(toHash(await backingManager.version())).to.equal(versionV1Hash)
          expect(toHash(await basketHandler.version())).to.equal(versionV1Hash)
          expect(toHash(await broker.version())).to.equal(versionV1Hash)
          expect(toHash(await distributor.version())).to.equal(versionV1Hash)
          expect(toHash(await furnace.version())).to.equal(versionV1Hash)
          expect(toHash(await rsrTrader.version())).to.equal(versionV1Hash)
          expect(toHash(await rTokenTrader.version())).to.equal(versionV1Hash)
          expect(toHash(await rToken.version())).to.equal(versionV1Hash)
          expect(toHash(await stRSR.version())).to.equal(versionV1Hash)

          // Upgrade RToken
          expect(toHash(await rToken.version())).to.equal(versionV1Hash)
          await upgMain.connect(owner).upgradeRTokenTo(versionV2Hash, false, false)
          expect(toHash(await rToken.version())).to.equal(versionV2Hash)

          // All components updated
          expect(toHash(await assetRegistry.version())).to.equal(versionV2Hash)
          expect(toHash(await backingManager.version())).to.equal(versionV2Hash)
          expect(toHash(await basketHandler.version())).to.equal(versionV2Hash)
          expect(toHash(await broker.version())).to.equal(versionV2Hash)
          expect(toHash(await distributor.version())).to.equal(versionV2Hash)
          expect(toHash(await furnace.version())).to.equal(versionV2Hash)
          expect(toHash(await rsrTrader.version())).to.equal(versionV2Hash)
          expect(toHash(await rTokenTrader.version())).to.equal(versionV2Hash)
          expect(toHash(await rToken.version())).to.equal(versionV2Hash)
          expect(toHash(await stRSR.version())).to.equal(versionV2Hash)
        })

        it('Should perform pre and post validations on Assets- Using Registries', async () => {
          // Register deployments
          await versionRegistry.connect(owner).registerVersion(deployer.address)
          await versionRegistry.connect(owner).registerVersion(deployerV2.address)

          // Update Main to have both registries
          await main.connect(owner).setVersionRegistry(versionRegistry.address)
          await main.connect(owner).setAssetPluginRegistry(assetPluginRegistry.address)

          // Update Main to new version
          const versionV1Hash = toHash(await deployer.version())
          const versionV2Hash = toHash(await deployerV2.version())
          const upgMain = <MainP1>await ethers.getContractAt('MainP1', main.address)
          await upgMain.connect(owner).upgradeMainTo(versionV2Hash)

          // Upgrade to RToken fails if not assets registered
          await expect(
            upgMain.connect(owner).upgradeRTokenTo(versionV2Hash, true, true)
          ).to.be.revertedWith('unsupported asset')

          // Register Assets in the Registry for current version
          const currentAssetRegistry = await assetRegistry.getRegistry()
          const currentAssetPlugins = currentAssetRegistry.assets

          await assetPluginRegistry.connect(owner).updateAssetsByVersion(
            versionV1Hash,
            currentAssetPlugins,
            currentAssetPlugins.map(() => true)
          )

          // Upgrade to RToken fails, still not registered for the new version
          await expect(
            upgMain.connect(owner).upgradeRTokenTo(versionV2Hash, true, true)
          ).to.be.revertedWith('unsupported asset')

          // Register Assets in the Registry for new version
          await assetPluginRegistry.connect(owner).updateAssetsByVersion(
            versionV2Hash,
            currentAssetPlugins,
            currentAssetPlugins.map(() => true)
          )

          // Upgrade RToken
          expect(toHash(await rToken.version())).to.equal(versionV1Hash)
          await upgMain.connect(owner).upgradeRTokenTo(versionV2Hash, true, true)
          expect(toHash(await rToken.version())).to.equal(versionV2Hash)

          // All components updated
          expect(toHash(await assetRegistry.version())).to.equal(versionV2Hash)
          expect(toHash(await backingManager.version())).to.equal(versionV2Hash)
          expect(toHash(await basketHandler.version())).to.equal(versionV2Hash)
          expect(toHash(await broker.version())).to.equal(versionV2Hash)
          expect(toHash(await distributor.version())).to.equal(versionV2Hash)
          expect(toHash(await furnace.version())).to.equal(versionV2Hash)
          expect(toHash(await rsrTrader.version())).to.equal(versionV2Hash)
          expect(toHash(await rTokenTrader.version())).to.equal(versionV2Hash)
          expect(toHash(await rToken.version())).to.equal(versionV2Hash)
          expect(toHash(await stRSR.version())).to.equal(versionV2Hash)
        })

        it('Should perform validation in the upgrade process - Using Registries', async () => {
          // Register current deployment
          await versionRegistry.connect(owner).registerVersion(deployer.address)

          // Get V2 version
          const versionV2Hash = toHash(await deployerV2.version())

          const upgMain = <MainP1>await ethers.getContractAt('MainP1', main.address)

          // Cannot upgrade if no registry in Main
          await expect(upgMain.connect(owner).upgradeMainTo(versionV2Hash)).to.be.revertedWith(
            'no registry'
          )
          await expect(
            upgMain.connect(owner).upgradeRTokenTo(versionV2Hash, false, false)
          ).to.be.revertedWith('no registry')

          // Update Main to have a Registry
          await main.connect(owner).setVersionRegistry(versionRegistry.address)

          // If not governance cannot upgrade
          await expect(upgMain.connect(other).upgradeMainTo(versionV2Hash)).to.be.revertedWith(
            `AccessControl: account ${other.address.toLowerCase()} is missing role ${MAIN_OWNER_ROLE}`
          )
          await expect(
            upgMain.connect(other).upgradeRTokenTo(versionV2Hash, false, false)
          ).to.be.revertedWith(
            `AccessControl: account ${other.address.toLowerCase()} is missing role ${MAIN_OWNER_ROLE}`
          )

          // Cannot upgrade if version not registered
          await expect(upgMain.connect(owner).upgradeMainTo(versionV2Hash)).to.be.reverted
          await expect(upgMain.connect(owner).upgradeRTokenTo(versionV2Hash, false, false)).to.be
            .reverted

          // Register new deployment
          await versionRegistry.connect(owner).registerVersion(deployerV2.address)

          // Cannot upgrade RToken before main
          await expect(
            upgMain.connect(owner).upgradeRTokenTo(versionV2Hash, false, false)
          ).to.be.revertedWith('upgrade main first')

          // Cannot upgrade to deprecated version
          await versionRegistry.connect(owner).deprecateVersion(versionV2Hash)
          await expect(upgMain.connect(owner).upgradeMainTo(versionV2Hash)).to.be.revertedWith(
            'version deprecated'
          )
        })
      })
    })
  })
})

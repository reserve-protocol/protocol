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

      const MainFactory: ContractFactory = await ethers.getContractFactory('MainP1')
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
      const RTokenFactory: ContractFactory = await ethers.getContractFactory('RTokenP1')
      const newRToken: RTokenP1 = <RTokenP1>await upgrades.deployProxy(
        RTokenFactory,
        [main.address, 'RTKN RToken', 'RTKN', 'newConstitution', config.issuanceRate],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['delegatecall'], // Review - Address.sol/SafeERC20.sol
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
      const FurnaceFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
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
      const RevenueTraderFactory: ContractFactory = await ethers.getContractFactory(
        'RevenueTradingP1',
        { libraries: { TradingLibP1: tradingLib.address } }
      )
      const newRevenueTrader: RevenueTradingP1 = <RevenueTradingP1>await upgrades.deployProxy(
        RevenueTraderFactory,
        [main.address, rsr.address, config.maxTradeSlippage, config.dustAmount],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['external-library-linking', 'delegatecall'], // Review - TradingLib (external) and Address/SafeERC20
        }
      )
      await newRevenueTrader.deployed()

      expect(await newRevenueTrader.tokenToBuy()).to.equal(rsr.address)
      expect(await newRevenueTrader.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await newRevenueTrader.dustAmount()).to.equal(config.dustAmount)
      expect(await newRevenueTrader.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - BackingManager', async () => {
      const BackingManagerFactory: ContractFactory = await ethers.getContractFactory(
        'BackingManagerP1',
        { libraries: { TradingLibP1: tradingLib.address } }
      )
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
          unsafeAllow: ['external-library-linking', 'delegatecall'], // Review - TradingLib (external) and Address/SafeERC20
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
      const AssetRegistryFactory: ContractFactory = await ethers.getContractFactory(
        'AssetRegistryP1'
      )
      const newAssetRegistry: AssetRegistryP1 = <AssetRegistryP1>await upgrades.deployProxy(
        AssetRegistryFactory,
        [
          main.address,
          [rsrAsset.address, rTokenAsset.address]
        ],
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
      const BasketHandlerFactory: ContractFactory = await ethers.getContractFactory(
        'BasketHandlerP1'
      )
      const newBasketHandler: BasketHandlerP1 = <BasketHandlerP1>await upgrades.deployProxy(
        BasketHandlerFactory,
        [
          main.address
        ],
        {
          initializer: 'init',
          kind: 'uups',
        }
      )
      await newBasketHandler.deployed()

      expect(await newBasketHandler.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - Distributor', async () => {
      const DistributorFactory: ContractFactory = await ethers.getContractFactory(
        'DistributorP1'
      )
      const newDistributor: DistributorP1 = <DistributorP1>await upgrades.deployProxy(
        DistributorFactory,
        [
          main.address,
          config.dist
        ],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['delegatecall'], // Review - Address/SafeERC20
        }
      )
      await newDistributor.deployed()

      const totals = await newDistributor.totals()
      expect(totals.rsrTotal).equal(bn(60))
      expect(totals.rTokenTotal).equal(bn(40))
      expect(await newDistributor.main()).to.equal(main.address)
    })
    
    it('Should deploy valid implementation - Broker', async () => {
      const BrokerFactory: ContractFactory = await ethers.getContractFactory(
        'BrokerP1'
      )
      const newBroker: BrokerP1 = <BrokerP1>await upgrades.deployProxy(
        BrokerFactory,
        [
          main.address,
          gnosis.address,
          config.auctionLength
        ],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['delegatecall'], // Review - Address/SafeERC20
        }
      )
      await newBroker.deployed()

      expect(await newBroker.gnosis()).to.equal(gnosis.address)
      expect(await newBroker.auctionLength()).to.equal(config.auctionLength)
      expect(await newBroker.disabled()).to.equal(false)
      expect(await newBroker.main()).to.equal(main.address)
    })

    it('Should deploy valid implementation - StRSR', async () => {
      const StRSRFactory: ContractFactory = await ethers.getContractFactory(
        'StRSRP1'
      )
      const newStRSR: StRSRP1 = <StRSRP1>await upgrades.deployProxy(
        StRSRFactory,
        [
          main.address,
         'stRTKNRSR Token',
         'stRTKNRSR',
         config.unstakingDelay,
         config.rewardPeriod,
         config.rewardRatio
        ],
        {
          initializer: 'init',
          kind: 'uups',
          unsafeAllow: ['delegatecall'], // Review - Address/SafeERC20
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
})

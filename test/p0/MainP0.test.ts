import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { CollateralStatus, ZERO_ADDRESS } from '../../common/constants'
import { expectInIndirectReceipt, expectInReceipt } from '../../common/events'
import { bn, fp } from '../../common/numbers'
import {
  Asset,
  AssetRegistryP0,
  ATokenFiatCollateral,
  BackingManagerP0,
  BasketHandlerP0,
  BrokerP0,
  CompoundPricedAsset,
  ComptrollerMock,
  CTokenFiatCollateral,
  CTokenMock,
  DeployerP0,
  DistributorP0,
  ERC20Mock,
  FacadeP0,
  FurnaceP0,
  MainP0,
  GnosisMock,
  RevenueTradingP0,
  RTokenAsset,
  RTokenP0,
  StaticATokenMock,
  StRSRP0,
  USDCMock,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('MainP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: Asset
  let compToken: ERC20Mock
  let compAsset: Asset
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock
  let aaveAsset: Asset

  // Trading
  let gnosis: GnosisMock
  let broker: BrokerP0
  let rsrTrader: RevenueTradingP0
  let rTokenTrader: RevenueTradingP0

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let erc20s: ERC20Mock[]

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let rTokenAsset: RTokenAsset
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let facade: FacadeP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let distributor: DistributorP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet
  let basket: Collateral[]

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compToken,
      aaveToken,
      compAsset,
      aaveAsset,
      compoundMock,
      erc20s,
      collateral,
      basket,
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
      gnosis,
      broker,
      facade,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))
    token0 = <ERC20Mock>erc20s[collateral.indexOf(basket[0])]
    token1 = <USDCMock>erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    collateral0 = <Collateral>basket[0]
    collateral1 = <Collateral>basket[1]
    collateral2 = <ATokenFiatCollateral>basket[2]
    collateral3 = <CTokenFiatCollateral>basket[3]

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
  })

  describe('Deployment', () => {
    it('Should setup Main correctly', async () => {
      // Owner/Pauser
      expect(await main.paused()).to.equal(false)
      expect(await main.owner()).to.equal(owner.address)
      expect(await main.pauser()).to.equal(owner.address)

      // Components
      expect(await main.stRSR()).to.equal(stRSR.address)
      expect(await main.rToken()).to.equal(rToken.address)
      expect(await main.assetRegistry()).to.equal(assetRegistry.address)
      expect(await main.basketHandler()).to.equal(basketHandler.address)
      expect(await main.backingManager()).to.equal(backingManager.address)
      expect(await main.distributor()).to.equal(distributor.address)
      expect(await main.furnace()).to.equal(furnace.address)
      expect(await main.broker()).to.equal(broker.address)
      expect(await main.rsrTrader()).to.equal(rsrTrader.address)
      expect(await main.rTokenTrader()).to.equal(rTokenTrader.address)

      // Configuration
      let totals = await distributor.totals()
      expect(totals.rTokenTotal).to.equal(bn(40))
      expect(totals.rsrTotal).to.equal(bn(60))

      // Check configurations for internal components
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)
      expect(await backingManager.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await backingManager.dustAmount()).to.equal(config.dustAmount)
      expect(await backingManager.backingBuffer()).to.equal(config.backingBuffer)
    })

    it('Should register ERC20s and Assets/Collateral correctly', async () => {
      // RSR
      expect(await assetRegistry.toAsset(rsr.address)).to.equal(rsrAsset.address)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await main.rsr()).to.equal(rsr.address)

      // RToken
      expect(await assetRegistry.toAsset(rToken.address)).to.equal(rTokenAsset.address)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rToken()).to.equal(rToken.address)

      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(aaveToken.address)
      expect(ERC20s[3]).to.equal(compToken.address)

      const initialTokens: string[] = await Promise.all(
        basket.map(async (c): Promise<string> => {
          return await c.erc20()
        })
      )
      expect(ERC20s.slice(4)).to.eql(initialTokens)
      expect(ERC20s.length).to.eql((await facade.basketTokens()).length + 4)

      // Assets
      expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(aaveAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(ERC20s[4])).to.equal(collateral0.address)
      expect(await assetRegistry.toAsset(ERC20s[5])).to.equal(collateral1.address)
      expect(await assetRegistry.toAsset(ERC20s[6])).to.equal(collateral2.address)
      expect(await assetRegistry.toAsset(ERC20s[7])).to.equal(collateral3.address)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[4])).to.equal(collateral0.address)
      expect(await assetRegistry.toColl(ERC20s[5])).to.equal(collateral1.address)
      expect(await assetRegistry.toColl(ERC20s[6])).to.equal(collateral2.address)
      expect(await assetRegistry.toColl(ERC20s[7])).to.equal(collateral3.address)
    })

    it('Should register Basket correctly', async () => {
      // Basket
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing = await facade.basketTokens()
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Check other values
      expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facade.callStatic.totalAssetValue()).to.equal(0)

      // Check RToken price
      expect(await rToken.price()).to.equal(fp('1'))
    })
  })

  describe('Initialization', () => {
    let ctorArgs: any

    beforeEach(async () => {
      ctorArgs = {
        params: config,
        components: {
          rToken: rToken.address,
          stRSR: stRSR.address,
          assetRegistry: assetRegistry.address,
          basketHandler: basketHandler.address,
          backingManager: backingManager.address,
          distributor: distributor.address,
          rsrTrader: rsrTrader.address,
          rTokenTrader: rTokenTrader.address,
          furnace: furnace.address,
          broker: broker.address,
        },
        assets: [rTokenAsset.address, rsrAsset.address, compAsset.address, aaveAsset.address],
        gnosis: gnosis.address,
        rsr: rsr.address,
      }
    })

    it('Should not allow to initialize Main twice', async () => {
      await expect(main.init(ctorArgs)).to.be.revertedWith('Already initialized')
    })

    it('Should not allow to initialize components twice', async () => {
      // Setup new Main
      const MainFactory: ContractFactory = await ethers.getContractFactory('MainP0')
      const newMain = <MainP0>await MainFactory.deploy()

      await expect(newMain.init(ctorArgs)).to.be.revertedWith('Component: already initialized')
    })

    it('Should perform validations on init', async () => {
      // Set invalid RSRPayPeriod
      const newConfig = { ...config }
      newConfig.rewardPeriod = config.unstakingDelay

      // Deploy new system instance
      await expect(
        deployer.deploy('RTKN RToken', 'RTKN', 'constitution', owner.address, newConfig)
      ).to.be.revertedWith('unstakingDelay/rewardPeriod incompatible')
    })

    it('Should emit events on init', async () => {
      // Deploy new system instance
      const receipt = await (
        await deployer.deploy('RTKN RToken', 'RTKN', 'constitution', owner.address, config)
      ).wait()

      const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
      const newMain: MainP0 = <MainP0>await ethers.getContractAt('MainP0', mainAddr)

      expectInIndirectReceipt(receipt, newMain.interface, 'Initialized')
      expectInIndirectReceipt(receipt, newMain.interface, 'AssetRegistrySet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.assetRegistry(),
      })

      expectInIndirectReceipt(receipt, newMain.interface, 'BasketHandlerSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.basketHandler(),
      })
      expectInIndirectReceipt(receipt, newMain.interface, 'BackingManagerSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.backingManager(),
      })
      expectInIndirectReceipt(receipt, newMain.interface, 'DistributorSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.distributor(),
      })

      expectInIndirectReceipt(receipt, newMain.interface, 'RTokenSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.rToken(),
      })
      expectInIndirectReceipt(receipt, newMain.interface, 'StRSRSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.stRSR(),
      })

      expectInIndirectReceipt(receipt, newMain.interface, 'RSRTraderSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.rsrTrader(),
      })

      expectInIndirectReceipt(receipt, newMain.interface, 'RTokenTraderSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.rTokenTrader(),
      })

      expectInIndirectReceipt(receipt, newMain.interface, 'FurnaceSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.furnace(),
      })

      expectInIndirectReceipt(receipt, newMain.interface, 'BrokerSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.broker(),
      })

      expectInIndirectReceipt(receipt, newMain.interface, 'RSRSet', {
        oldVal: ZERO_ADDRESS,
        newVal: await newMain.rsr(),
      })
    })
  })

  describe('Pause/Unpause', () => {
    it('Should Pause/Unpause for Pauser and Owner', async () => {
      // Set different Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Check initial status
      expect(await main.pauser()).to.equal(addr1.address)
      expect(await main.paused()).to.equal(false)

      // Pause with Pauser
      await main.connect(addr1).pause()

      // Check if Paused
      expect(await main.paused()).to.equal(true)

      // Unpause with Pauser
      await main.connect(addr1).unpause()

      expect(await main.paused()).to.equal(false)

      // Owner should still be able to Pause
      await main.connect(owner).pause()

      // Check if Paused
      expect(await main.paused()).to.equal(true)

      // Unpause with Owner
      await main.connect(owner).unpause()

      expect(await main.paused()).to.equal(false)
    })

    it('Should not allow to Pause/Unpause if not Pauser or Owner', async () => {
      // Set different Pauser
      await main.connect(owner).setPauser(addr1.address)

      await expect(main.connect(other).pause()).to.be.revertedWith('only pauser or owner')

      // Check no changes
      expect(await main.paused()).to.equal(false)

      // Attempt to unpause
      await expect(main.connect(other).unpause()).to.be.revertedWith('only pauser or owner')

      // Check no changes
      expect(await main.paused()).to.equal(false)
    })

    it('Should allow to set Pauser if Owner or Pauser', async () => {
      // Set Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Check Pauser updated
      expect(await main.pauser()).to.equal(addr1.address)

      // Now update it with Pauser
      await main.connect(addr1).setPauser(owner.address)

      // Check Pauser updated
      expect(await main.pauser()).to.equal(owner.address)
    })

    it('Should not allow to set Pauser if not Owner', async () => {
      // Set Pauser
      await main.connect(owner).setPauser(addr1.address)

      // Set Pauser
      await expect(main.connect(other).setPauser(other.address)).to.be.revertedWith(
        'only pauser or owner'
      )

      // Check Pauser not updated
      expect(await main.pauser()).to.equal(addr1.address)
    })
  })

  describe('Configuration/State', () => {
    it('Should allow to update tradingDelay if Owner', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)

      // If not owner cannot update
      await expect(backingManager.connect(other).setAuctionDelay(newValue)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Check value did not change
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)

      // Update with owner
      await expect(backingManager.connect(owner).setAuctionDelay(newValue))
        .to.emit(backingManager, 'AuctionDelaySet')
        .withArgs(config.tradingDelay, newValue)

      // Check value was updated
      expect(await backingManager.tradingDelay()).to.equal(newValue)
    })

    it('Should allow to update maxTradeSlippage if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await backingManager.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

      // If not owner cannot update
      await expect(backingManager.connect(other).setMaxTradeSlippage(newValue)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Check value did not change
      expect(await backingManager.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

      // Update with owner
      await expect(backingManager.connect(owner).setMaxTradeSlippage(newValue))
        .to.emit(backingManager, 'MaxTradeSlippageSet')
        .withArgs(config.maxTradeSlippage, newValue)

      // Check value was updated
      expect(await backingManager.maxTradeSlippage()).to.equal(newValue)
    })

    it('Should allow to update dustAmount if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await backingManager.dustAmount()).to.equal(config.dustAmount)

      // If not owner cannot update
      await expect(backingManager.connect(other).setDustAmount(newValue)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Check value did not change
      expect(await backingManager.dustAmount()).to.equal(config.dustAmount)

      // Update with owner
      await expect(backingManager.connect(owner).setDustAmount(newValue))
        .to.emit(backingManager, 'DustAmountSet')
        .withArgs(config.dustAmount, newValue)

      // Check value was updated
      expect(await backingManager.dustAmount()).to.equal(newValue)
    })

    it('Should allow to update backingBuffer if Owner', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await backingManager.backingBuffer()).to.equal(config.backingBuffer)

      // If not owner cannot update
      await expect(backingManager.connect(other).setBackingBuffer(newValue)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Check value did not change
      expect(await backingManager.backingBuffer()).to.equal(config.backingBuffer)

      // Update with owner
      await expect(backingManager.connect(owner).setBackingBuffer(newValue))
        .to.emit(backingManager, 'BackingBufferSet')
        .withArgs(config.backingBuffer, newValue)

      // Check value was updated
      expect(await backingManager.backingBuffer()).to.equal(newValue)
    })

    it('Should return backing tokens', async () => {
      expect(await facade.basketTokens()).to.eql([
        token0.address,
        token1.address,
        token2.address,
        token3.address,
      ])
    })

    it('Should allow to set Broker if Owner', async () => {
      // Check existing value
      expect(await main.broker()).to.equal(broker.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setBroker(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.broker()).to.equal(broker.address)

      // Update with owner
      await expect(main.connect(owner).setBroker(other.address))
        .to.emit(main, 'BrokerSet')
        .withArgs(broker.address, other.address)

      // Check value was updated
      expect(await main.broker()).to.equal(other.address)
    })

    it('Should allow to set RSR if Owner', async () => {
      // Check existing value
      expect(await main.rsr()).to.equal(rsr.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setRSR(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.rsr()).to.equal(rsr.address)

      // Update with owner
      await expect(main.connect(owner).setRSR(other.address))
        .to.emit(main, 'RSRSet')
        .withArgs(rsr.address, other.address)

      // Check value was updated
      expect(await main.rsr()).to.equal(other.address)
    })

    it('Should allow to set StRSR if Owner', async () => {
      // Check existing value
      expect(await main.stRSR()).to.equal(stRSR.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setStRSR(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.stRSR()).to.equal(stRSR.address)

      // Update with owner
      await expect(main.connect(owner).setStRSR(other.address))
        .to.emit(main, 'StRSRSet')
        .withArgs(stRSR.address, other.address)

      // Check value was updated
      expect(await main.stRSR()).to.equal(other.address)
    })

    it('Should allow to set RToken if Owner', async () => {
      // Check existing value
      expect(await main.rToken()).to.equal(rToken.address)

      // If not owner cannot update - use mock address
      await expect(main.connect(other).setRToken(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.rToken()).to.equal(rToken.address)

      // Update with owner
      await expect(main.connect(owner).setRToken(other.address))
        .to.emit(main, 'RTokenSet')
        .withArgs(rToken.address, other.address)

      // Check value was updated
      expect(await main.rToken()).to.equal(other.address)
    })

    it('Should allow to set Furnace if Owner and perform validations', async () => {
      // Setup test furnaces
      const FurnaceFactory: ContractFactory = await ethers.getContractFactory('FurnaceP0')
      const newFurnace = <FurnaceP0>await FurnaceFactory.deploy()

      // Check existing value
      expect(await main.furnace()).to.equal(furnace.address)

      // If not owner cannot update
      await expect(main.connect(other).setFurnace(newFurnace.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check value did not change
      expect(await main.furnace()).to.equal(furnace.address)

      // Update with owner
      await expect(main.connect(owner).setFurnace(newFurnace.address))
        .to.emit(main, 'FurnaceSet')
        .withArgs(furnace.address, newFurnace.address)

      // Check value was updated
      expect(await main.furnace()).to.equal(newFurnace.address)
    })
  })

  describe('Actions / Refreshers / Completions / Others', () => {
    it('Should not allow to run functions if paused', async () => {
      // By default functions can be run
      await main.poke()

      // Pause Main
      await main.connect(owner).pause()

      // Attempt to run functions again
      await expect(main.poke()).to.be.revertedWith('paused')
    })

    it('Should not allow actions on components if paused', async () => {
      // Ensure valid basket action
      await basketHandler.ensureBasket()

      // Pause Main
      await main.connect(owner).pause()

      // Attempt to run action again
      await expect(basketHandler.ensureBasket()).to.be.revertedWith('Component: system is paused')
    })
  })

  describe('Asset Registry', () => {
    it('Should confirm if ERC20s are registered', async () => {
      expect(await assetRegistry.isRegistered(token0.address)).to.equal(true)
      expect(await assetRegistry.isRegistered(token1.address)).to.equal(true)
      expect(await assetRegistry.isRegistered(token2.address)).to.equal(true)
      expect(await assetRegistry.isRegistered(token3.address)).to.equal(true)

      // Try with non-registered address
      expect(await assetRegistry.isRegistered(other.address)).to.equal(false)
    })

    it('Should allow to register Asset if Owner', async () => {
      // Setup new Asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAsset')
      const newAsset: CompoundPricedAsset = <CompoundPricedAsset>(
        await AssetFactory.deploy(
          erc20s[5].address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      const duplicateAsset: CompoundPricedAsset = <CompoundPricedAsset>(
        await AssetFactory.deploy(
          token0.address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.erc20s()).length

      // Cannot add asset if not owner
      await expect(assetRegistry.connect(other).register(newAsset.address)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Reverts if attempting to add an existing ERC20 with different asset
      await expect(
        assetRegistry.connect(owner).register(duplicateAsset.address)
      ).to.be.revertedWith('duplicate ERC20 detected')

      // Nothing happens if attempting to register an already registered asset
      await expect(assetRegistry.connect(owner).register(aaveAsset.address)).to.not.emit(
        assetRegistry,
        'AssetRegistered'
      )

      // Check nothing changed
      let allERC20s = await assetRegistry.erc20s()
      expect(allERC20s.length).to.equal(previousLength)

      // Add new asset
      await expect(assetRegistry.connect(owner).register(newAsset.address))
        .to.emit(assetRegistry, 'AssetRegistered')
        .withArgs(erc20s[5].address, newAsset.address)

      // Check it was added
      allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.contain(erc20s[5].address)
      expect(allERC20s.length).to.equal(previousLength + 1)
    })

    it('Should allow to unregister asset if Owner', async () => {
      // Setup new Asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAsset')
      const newAsset: CompoundPricedAsset = <CompoundPricedAsset>(
        await AssetFactory.deploy(
          token0.address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Setup new asset with new ERC20
      const ERC20Factory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
      const newToken: ERC20Mock = <ERC20Mock>await ERC20Factory.deploy('NewTKN Token', 'NewTKN')
      const newTokenAsset: CompoundPricedAsset = <CompoundPricedAsset>(
        await AssetFactory.deploy(
          newToken.address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.erc20s()).length

      // Check assets
      let allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.contain(compToken.address)
      expect(allERC20s).to.not.contain(erc20s[5].address)

      // Cannot remove asset if not owner
      await expect(assetRegistry.connect(other).unregister(compAsset.address)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Cannot remove asset that does not exist
      await expect(assetRegistry.connect(owner).unregister(newAsset.address)).to.be.revertedWith(
        'asset not found'
      )

      // Cannot remove asset with non-registered ERC20
      await expect(
        assetRegistry.connect(owner).unregister(newTokenAsset.address)
      ).to.be.revertedWith('no asset to unregister')

      // Check nothing changed
      allERC20s = await assetRegistry.erc20s()
      expect(allERC20s.length).to.equal(previousLength)
      expect(allERC20s).to.contain(compToken.address)
      expect(allERC20s).to.not.contain(erc20s[5].address)

      // Remove asset
      await expect(assetRegistry.connect(owner).unregister(compAsset.address))
        .to.emit(assetRegistry, 'AssetUnregistered')
        .withArgs(compToken.address, compAsset.address)

      // Check if it was removed
      allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.not.contain(compToken.address)
      expect(allERC20s.length).to.equal(previousLength - 1)
    })

    it('Should allow to swap Asset if Owner', async () => {
      // Setup new Asset - Reusing token
      const AssetFactory: ContractFactory = await ethers.getContractFactory('CompoundPricedAsset')
      const newAsset: CompoundPricedAsset = <CompoundPricedAsset>(
        await AssetFactory.deploy(
          token0.address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Setup another one with new token (cannot be used in swap)
      const invalidAssetForSwap: CompoundPricedAsset = <CompoundPricedAsset>(
        await AssetFactory.deploy(
          erc20s[5].address,
          await collateral0.maxAuctionSize(),
          compoundMock.address
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.erc20s()).length

      // Cannot swap asset if not owner
      await expect(
        assetRegistry.connect(other).swapRegistered(newAsset.address)
      ).to.be.revertedWith('Component: caller is not the owner')

      // Cannot swap asset if ERC20 is not registered
      await expect(
        assetRegistry.connect(owner).swapRegistered(invalidAssetForSwap.address)
      ).to.be.revertedWith('no ERC20 collision')

      // Check asset remains the same
      expect(await assetRegistry.toAsset(token0.address)).to.equal(collateral0.address)

      // Swap Asset
      await expect(assetRegistry.connect(owner).swapRegistered(newAsset.address))
        .to.emit(main, 'AssetUnregistered')
        .withArgs(token0.address, collateral0.address)
        .to.emit(assetRegistry, 'AssetRegistered')
        .withArgs(token0.address, newAsset.address)

      // Check length is not modified and erc20 remains registered
      let allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.contain(token0.address)
      expect(allERC20s.length).to.equal(previousLength)

      // Check asset was modified
      expect(await assetRegistry.toAsset(token0.address)).to.equal(newAsset.address)
    })

    it('Should return the Asset for an ERC20 and perform validations', async () => {
      // Reverts if ERC20 is not registered
      await expect(assetRegistry.toAsset(other.address)).to.be.revertedWith('erc20 unregistered')

      // Reverts if no registered asset - After unregister
      await expect(assetRegistry.connect(owner).unregister(rsrAsset.address))
        .to.emit(assetRegistry, 'AssetUnregistered')
        .withArgs(rsr.address, rsrAsset.address)
      await expect(assetRegistry.toAsset(rsr.address)).to.be.revertedWith('erc20 unregistered')

      // Returns correctly the asset
      expect(await assetRegistry.toAsset(rToken.address)).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(aaveToken.address)).to.equal(aaveAsset.address)
      expect(await assetRegistry.toAsset(compToken.address)).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(token0.address)).to.equal(collateral0.address)
      expect(await assetRegistry.toAsset(token1.address)).to.equal(collateral1.address)
      expect(await assetRegistry.toAsset(token2.address)).to.equal(collateral2.address)
      expect(await assetRegistry.toAsset(token3.address)).to.equal(collateral3.address)
    })

    it('Should return the Collateral for an ERC20 and perform validations', async () => {
      // Reverts if ERC20 is not registered
      await expect(assetRegistry.toColl(other.address)).to.be.revertedWith('erc20 unregistered')

      // Reverts if no registered collateral - After unregister
      await assetRegistry.connect(owner).unregister(collateral0.address)
      await expect(assetRegistry.toColl(token0.address)).to.be.revertedWith('erc20 unregistered')

      // Reverts if asset is not collateral
      await expect(assetRegistry.toColl(rsr.address)).to.be.revertedWith('erc20 is not collateral')

      // Returns correctly the collaterals
      expect(await assetRegistry.toColl(token1.address)).to.equal(collateral1.address)
      expect(await assetRegistry.toColl(token2.address)).to.equal(collateral2.address)
      expect(await assetRegistry.toColl(token3.address)).to.equal(collateral3.address)
    })

    it('Should allow to forceUpdates on assetRegistry only from basketHandler', async () => {
      // Basket handler can run forceUpdates
      await whileImpersonating(basketHandler.address, async (bhsigner) => {
        await assetRegistry.connect(bhsigner).forceUpdates()
      })

      // Attempt to run from another account
      await expect(assetRegistry.connect(other).forceUpdates()).to.be.revertedWith(
        'basket handler only'
      )
    })
  })

  describe('Basket Handling', () => {
    it('Should not allow to set prime Basket if not Owner', async () => {
      await expect(
        basketHandler.connect(other).setPrimeBasket([collateral0.address], [fp('1')])
      ).to.be.revertedWith('Component: caller is not the owner')
    })

    it('Should not allow to set prime Basket with invalid length', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([collateral0.address], [])
      ).to.be.revertedWith('must be same length')
    })

    it('Should allow to set prime Basket if Owner', async () => {
      // Set basket
      await expect(basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')]))
        .to.emit(basketHandler, 'PrimeBasketSet')
        .withArgs([token0.address], [fp('1')])
    })

    it('Should not allow to set backup Config if not Owner', async () => {
      await expect(
        basketHandler
          .connect(other)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
      ).to.be.revertedWith('Component: caller is not the owner')
    })

    it('Should allow to set backup Config if Owner', async () => {
      // Set basket
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
      )
        .to.emit(basketHandler, 'BackupConfigSet')
        .withArgs(ethers.utils.formatBytes32String('USD'), bn(1), [collateral0.address])
    })

    it('Should not allow to switch basket if not Owner', async () => {
      await expect(basketHandler.connect(other).switchBasket()).to.be.revertedWith(
        'Component: caller is not the owner'
      )
    })

    it('Should allow to call switch Basket if Owner - No changes', async () => {
      // Switch basket - No backup nor default
      await expect(basketHandler.connect(owner).switchBasket()).to.emit(basketHandler, 'BasketSet')

      // Basket remains the same in this case
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing = await facade.basketTokens()
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Not updated so basket last changed is not set
      expect((await basketHandler.lastSet())[0]).to.be.gt(bn(1))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facade.callStatic.totalAssetValue()).to.equal(0)
    })
  })
})

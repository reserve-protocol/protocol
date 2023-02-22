import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import {
  IConfig,
  MAX_TRADING_DELAY,
  MAX_TRADE_SLIPPAGE,
  MAX_BACKING_BUFFER,
  MAX_TARGET_AMT,
  MAX_MIN_TRADE_VOLUME,
  IComponents,
} from '../common/configuration'
import {
  CollateralStatus,
  ZERO_ADDRESS,
  ONE_ADDRESS,
  MAX_UINT256,
  OWNER,
  SHORT_FREEZER,
  LONG_FREEZER,
  PAUSER,
  MAX_UINT192,
} from '../common/constants'
import { expectInIndirectReceipt, expectInReceipt, expectEvents } from '../common/events'
import { expectPrice, expectUnpriced, setOraclePrice } from './utils/oracles'
import { bn, fp } from '../common/numbers'
import {
  Asset,
  ATokenFiatCollateral,
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
  InvalidRefPerTokCollateralMock,
  MockV3Aggregator,
  MockableCollateral,
  RTokenAsset,
  StaticATokenMock,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  USDCMock,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import {
  Collateral,
  defaultFixture,
  Implementation,
  IMPLEMENTATION,
  ORACLE_ERROR,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
} from './fixtures'
import snapshotGasCost from './utils/snapshotGasCost'
import { advanceTime } from './utils/time'
import { useEnv } from '#/utils/env'

const DEFAULT_THRESHOLD = fp('0.01') // 1%

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describe(`MainP${IMPLEMENTATION} contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: TestIDeployer

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: Asset
  let compToken: ERC20Mock
  let compAsset: Asset
  let aaveToken: ERC20Mock
  let aaveAsset: Asset

  // Trading
  let gnosis: GnosisMock
  let broker: TestIBroker
  let rsrTrader: TestIRevenueTrader
  let rTokenTrader: TestIRevenueTrader

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: FiatCollateral
  let collateral1: FiatCollateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let erc20s: ERC20Mock[]
  let basketsNeededAmts: BigNumber[]

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let rTokenAsset: RTokenAsset
  let stRSR: TestIStRSR
  let furnace: TestIFurnace
  let main: TestIMain
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let distributor: TestIDistributor

  let basket: Collateral[]

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
      erc20s,
      collateral,
      basket,
      basketsNeededAmts,
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
      facadeTest,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))
    token0 = <ERC20Mock>erc20s[collateral.indexOf(basket[0])]
    token1 = <USDCMock>erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    collateral0 = <FiatCollateral>basket[0]
    collateral1 = <FiatCollateral>basket[1]
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

  describe('Deployment #fast', () => {
    it('Should setup Main correctly', async () => {
      // Auth roles
      expect(await main.hasRole(OWNER, owner.address)).to.equal(true)
      expect(await main.hasRole(SHORT_FREEZER, owner.address)).to.equal(true)
      expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(true)
      expect(await main.longFreezes(owner.address)).to.equal(6)
      expect(await main.hasRole(PAUSER, owner.address)).to.equal(true)
      expect(await main.hasRole(OWNER, deployer.address)).to.equal(false)
      expect(await main.hasRole(SHORT_FREEZER, deployer.address)).to.equal(false)
      expect(await main.hasRole(LONG_FREEZER, deployer.address)).to.equal(false)
      expect(await main.hasRole(PAUSER, deployer.address)).to.equal(false)
      expect(await main.getRoleAdmin(OWNER)).to.equal(OWNER)
      expect(await main.getRoleAdmin(SHORT_FREEZER)).to.equal(OWNER)
      expect(await main.getRoleAdmin(LONG_FREEZER)).to.equal(OWNER)
      expect(await main.getRoleAdmin(PAUSER)).to.equal(OWNER)

      // Should start unfrozen and unpaused
      expect(await main.paused()).to.equal(false)
      expect(await main.pausedOrFrozen()).to.equal(false)
      expect(await main.frozen()).to.equal(false)

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
      const [rTokenTotal, rsrTotal] = await distributor.totals()
      expect(rTokenTotal).to.equal(bn(40))
      expect(rsrTotal).to.equal(bn(60))
      expect(await main.shortFreeze()).to.equal(config.shortFreeze)
      expect(await main.longFreeze()).to.equal(config.longFreeze)

      // Check configurations for internal components
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)
      expect(await backingManager.maxTradeSlippage()).to.equal(config.maxTradeSlippage)
      expect(await backingManager.backingBuffer()).to.equal(config.backingBuffer)

      // Should have semver version from deployer
      expect(await main.version()).to.equal(await deployer.version())
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
      expect(ERC20s.length).to.eql((await facade.basketTokens(rToken.address)).length + 4)

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
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Check other values

      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // Check BU price
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)
    })
  })

  describe('Initialization #fast', () => {
    let components: Parameters<typeof main.init>[0]

    beforeEach(async () => {
      components = {
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
      }
    })

    it('Should not allow to initialize Main twice', async () => {
      await expect(main.init(components, rsr.address, 1, 1)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )
    })

    it('Should prevent granting roles to the zero address', async () => {
      await expect(main.connect(owner).grantRole(PAUSER, ZERO_ADDRESS)).to.be.revertedWith(
        'cannot grant role to address 0'
      )
    })

    it('Should not allow to initialize components twice', async () => {
      // Attempt to reinitialize - Asset Registry
      const assets = [rTokenAsset.address, rsrAsset.address, compAsset.address, aaveAsset.address]
      await expect(assetRegistry.init(main.address, assets)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )

      // Attempt to reinitialize - Backing Manager
      await expect(
        backingManager.init(
          main.address,
          config.tradingDelay,
          config.backingBuffer,
          config.maxTradeSlippage,
          config.minTradeVolume
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')

      // Attempt to reinitialize - Basket Handler
      await expect(basketHandler.init(main.address)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )

      // Attempt to reinitialize - Distributor
      await expect(distributor.init(main.address, config.dist)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )

      // Attempt to reinitialize - RSR Trader
      await expect(
        rsrTrader.init(main.address, rsr.address, config.maxTradeSlippage, config.minTradeVolume)
      ).to.be.revertedWith('Initializable: contract is already initialized')

      // Attempt to reinitialize - RToken Trader
      await expect(
        rTokenTrader.init(
          main.address,
          rToken.address,
          config.maxTradeSlippage,
          config.minTradeVolume
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')

      // Attempt to reinitialize - Furnace
      await expect(furnace.init(main.address, config.rewardRatio)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      )

      // Attempt to reinitialize - Broker
      const TradeFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const trade: GnosisTrade = <GnosisTrade>await TradeFactory.deploy()
      await expect(
        broker.init(main.address, gnosis.address, trade.address, config.auctionLength)
      ).to.be.revertedWith('Initializable: contract is already initialized')

      // Attempt to reinitialize - RToken
      await expect(
        rToken.init(
          main.address,
          'RTKN RToken',
          'RTKN',
          'Manifesto',
          config.issuanceThrottle,
          config.redemptionThrottle
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')

      // Attempt to reinitialize - StRSR
      await expect(
        stRSR.init(
          main.address,
          'stRTKNRSR Token',
          'stRTKNRSR',
          config.unstakingDelay,
          config.rewardRatio
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')
    })

    it('Should perform validations on init', async () => {
      const validateComponentAddress = async (
        mainInstance: TestIMain,
        components: IComponents,
        name: keyof IComponents,
        desc: string
      ) => {
        const prevValue = components[name]
        components[name] = ZERO_ADDRESS
        await expect(mainInstance.init(components, rsr.address, 1, 1)).to.be.revertedWith(
          `invalid ${desc} address`
        )
        components[name] = prevValue
      }
      // Distributor validation - Set invalid distribution
      const invalidDistConfig = { ...config }
      invalidDistConfig.dist = { rTokenDist: bn(0), rsrDist: bn(0) }

      await expect(
        deployer.deploy('RTKN RToken', 'RTKN', 'mandate', owner.address, invalidDistConfig)
      ).to.be.revertedWith('no distribution defined')

      // Create a new instance of Main
      const MainFactory: ContractFactory = await ethers.getContractFactory(`MainP${IMPLEMENTATION}`)

      let newMain: TestIMain = <TestIMain>await MainFactory.deploy()

      if (IMPLEMENTATION == Implementation.P1) {
        newMain = <TestIMain>await upgrades.deployProxy(MainFactory, [], {
          kind: 'uups',
        })
      }

      await expect(newMain.init(components, ZERO_ADDRESS, 1, 1)).to.be.revertedWith(
        'invalid RSR address'
      )

      // Check component addresses
      await validateComponentAddress(newMain, components, 'assetRegistry', 'AssetRegistry')
      await validateComponentAddress(newMain, components, 'backingManager', 'BackingManager')
      await validateComponentAddress(newMain, components, 'basketHandler', 'BasketHandler')
      await validateComponentAddress(newMain, components, 'broker', 'Broker')
      await validateComponentAddress(newMain, components, 'distributor', 'Distributor')
      await validateComponentAddress(newMain, components, 'furnace', 'Furnace')
      await validateComponentAddress(newMain, components, 'rsrTrader', 'RSRTrader')
      await validateComponentAddress(newMain, components, 'rTokenTrader', 'RTokenTrader')
      await validateComponentAddress(newMain, components, 'rToken', 'RToken')
      await validateComponentAddress(newMain, components, 'stRSR', 'StRSR')
    })

    it('Should emit events on init', async () => {
      // Deploy new system instance
      const receipt = await (
        await deployer.deploy('RTKN RToken', 'RTKN', 'mandate', owner.address, config)
      ).wait()

      const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
      const newMain: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

      expectInIndirectReceipt(receipt, newMain.interface, 'MainInitialized')
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
    })
  })

  describe('Pause/Unpause #fast', () => {
    beforeEach(async () => {
      // Set different PAUSER
      await main.connect(owner).grantRole(PAUSER, addr1.address)
    })

    it('Should Pause for PAUSER and OWNER', async () => {
      // Check initial status
      expect(await main.hasRole(PAUSER, owner.address)).to.equal(true)
      expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)
      expect(await main.paused()).to.equal(false)
      expect(await main.pausedOrFrozen()).to.equal(false)

      // Pause with PAUSER
      await main.connect(addr1).pause()

      // Check if Paused, should not lose PAUSER
      expect(await main.paused()).to.equal(true)
      expect(await main.hasRole(PAUSER, owner.address)).to.equal(true)
      expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

      // Unpause
      await main.connect(addr1).unpause()

      expect(await main.paused()).to.equal(false)

      // OWNER should still be able to Pause
      await main.connect(owner).pause()

      // Check if Paused
      expect(await main.pausedOrFrozen()).to.equal(true)
      expect(await main.paused()).to.equal(true)
    })

    it('Should not allow to Pause/Unpause if not PAUSER or OWNER', async () => {
      await expect(main.connect(other).pause()).to.be.reverted

      // Check no changes
      expect(await main.paused()).to.equal(false)

      // Attempt to unpause
      await expect(main.connect(other).unpause()).to.be.reverted

      // Check no changes
      expect(await main.paused()).to.equal(false)
    })

    it('Should not allow to set PAUSER if not OWNER', async () => {
      // Set PAUSER
      await expect(main.connect(addr1).grantRole(PAUSER, other.address)).to.be.reverted
      await expect(main.connect(other).grantRole(PAUSER, other.address)).to.be.reverted

      // Check PAUSER not updated
      expect(await main.hasRole(PAUSER, owner.address)).to.equal(true)
      expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)
    })

    it('Should allow to renounce role if OWNER', async () => {
      // Check PAUSER updated
      expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

      // Attempt to renounce role with another account
      await expect(main.connect(other).renounceRole(PAUSER, addr1.address)).to.be.reverted

      // Renounce role with owner
      await main.connect(owner).renounceRole(PAUSER, owner.address)

      // Check PAUSER renounced
      expect(await main.hasRole(PAUSER, owner.address)).to.equal(false)

      // Owner should still be OWNER
      expect(await main.hasRole(OWNER, owner.address)).to.equal(true)
    })

    it('Should allow to renounce role if PAUSER', async () => {
      // Check PAUSER updated
      expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

      // Renounce role with pauser
      await main.connect(addr1).renounceRole(PAUSER, addr1.address)

      // Check PAUSER renounced
      expect(await main.hasRole(PAUSER, addr1.address)).to.equal(false)

      // Owner should still be OWNER
      expect(await main.hasRole(PAUSER, owner.address)).to.equal(true)
    })
  })

  describe('Freeze/Unfreeze #fast', () => {
    beforeEach(async () => {
      // Set SHORT_FREEZER + LONG_FREEZER
      await main.connect(owner).grantRole(SHORT_FREEZER, addr1.address)
      await main.connect(owner).grantRole(LONG_FREEZER, addr2.address)

      // Check initial status
      expect(await main.hasRole(SHORT_FREEZER, owner.address)).to.equal(true)
      expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(true)
      expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(true)
      expect(await main.hasRole(SHORT_FREEZER, addr2.address)).to.equal(false)
      expect(await main.hasRole(LONG_FREEZER, addr1.address)).to.equal(false)
      expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(true)
      expect(await main.frozen()).to.equal(false)
      expect(await main.pausedOrFrozen()).to.equal(false)
    })

    it('Should only permit owner to freeze forever', async () => {
      await expect(main.connect(addr1).freezeForever()).to.be.reverted
      await expect(main.connect(addr2).freezeForever()).to.be.reverted
      await expect(main.connect(other).freezeForever()).to.be.reverted
    })

    it('A permanent freeze should last forever', async () => {
      // Freeze forever with OWNER
      await main.connect(owner).freezeForever()
      expect(await main.frozen()).to.equal(true)

      // Should not thaw naturally
      await advanceTime(config.shortFreeze.toString())
      expect(await main.frozen()).to.equal(true)

      // Should not be able to change this via fixed-duration freezing
      await expect(main.connect(addr1).freezeShort()).to.be.revertedWith('frozen')
      expect(await main.frozen()).to.equal(true)
      await advanceTime(bn('2').pow(29).toString())
      expect(await main.frozen()).to.equal(true)

      // Should not be able to change this via fixed-duration freezing
      await expect(main.connect(addr2).freezeLong()).to.be.revertedWith('frozen')
      expect(await main.frozen()).to.equal(true)
      await advanceTime(bn('2').pow(29).toString())
      expect(await main.frozen()).to.equal(true)
    })

    it('Should allow unfreeze during short-duration freeze', async () => {
      // Freeze with non-owner SHORT_FREEZER
      await main.connect(addr1).freezeShort()

      // Role revoked
      expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(false)

      // Cannot unfreeze from short freezer
      await expect(main.connect(addr1).unfreeze()).to.be.reverted

      // Unfreeze
      await main.connect(owner).unfreeze()
      expect(await main.frozen()).to.equal(false)
    })

    it('Should allow unfreeze during long-duration freeze', async () => {
      expect(await main.longFreezes(addr2.address)).to.equal(6)

      // Freeze with non-owner LONG_FREEZER
      await main.connect(addr2).freezeLong()

      // Charge used
      expect(await main.longFreezes(addr2.address)).to.equal(5)

      // Cannot unfreeze from long freezer
      await expect(main.connect(addr2).unfreeze()).to.be.reverted

      // Unfreeze
      await main.connect(owner).unfreeze()
      expect(await main.frozen()).to.equal(false)
    })

    it('Should not allow unfreeze from SHORT_FREEZER or LONG_FREEZER', async () => {
      // Freeze with OWNER
      await main.connect(owner).freezeForever()
      expect(await main.frozen()).to.equal(true)
      await expect(main.connect(addr1).unfreeze()).to.be.reverted
      await expect(main.connect(addr2).unfreeze()).to.be.reverted

      // Should not be able to start finite-duration freezes either
      await expect(main.connect(addr1).freezeShort()).to.be.revertedWith('frozen')
      await expect(main.connect(addr2).freezeLong()).to.be.revertedWith('frozen')

      // Unfreeze
      await main.connect(owner).unfreeze()
      expect(await main.frozen()).to.equal(false)
    })

    it('Short freezing should revoke SHORT_FREEZER + eventually thaw on its own', async () => {
      // Freeze with short freezer
      await main.connect(addr1).freezeShort()
      expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(false) // revoked
      expect(await main.frozen()).to.equal(true)

      // Advance time to thaw
      await advanceTime(config.shortFreeze.toString())
      expect(await main.frozen()).to.equal(false)

      // Should not be able to re-initiate freezing
      await expect(main.connect(addr1).freezeShort()).to.be.reverted

      // Cannot grant role unless owner
      await expect(main.connect(addr1).grantRole(SHORT_FREEZER, addr1.address)).to.be.reverted
      await expect(main.connect(addr2).grantRole(SHORT_FREEZER, addr1.address)).to.be.reverted
    })

    it('Should be able to chain short freeze into long freeze', async () => {
      // Freeze with short freezer
      await main.connect(addr1).freezeShort()
      expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(false) // revoked
      expect(await main.frozen()).to.equal(true)
      await advanceTime(config.shortFreeze.div(2).toString())

      // Do long freeze
      await main.connect(addr2).freezeLong()
      expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(true)
      expect(await main.longFreezes(addr2.address)).to.equal(5) // lost one charge
      expect(await main.frozen()).to.equal(true)
      await advanceTime(config.shortFreeze.toString())
      expect(await main.frozen()).to.equal(true)

      // Advance time to thaw
      await advanceTime(config.longFreeze.toString())
      expect(await main.frozen()).to.equal(false)

      // Should be able to re-freeze
      await main.connect(addr2).freezeLong()
      expect(await main.frozen()).to.equal(true)
      expect(await main.longFreezes(addr2.address)).to.equal(4) // lost another charge
    })

    it('Should not allow to set SHORT_FREEZER if not OWNER', async () => {
      expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(true)
      expect(await main.hasRole(SHORT_FREEZER, addr2.address)).to.equal(false)
      expect(await main.hasRole(SHORT_FREEZER, other.address)).to.equal(false)

      // Set SHORT_FREEZER from non-owner
      await expect(main.connect(addr1).grantRole(SHORT_FREEZER, other.address)).to.be.reverted
      await expect(main.connect(addr2).grantRole(SHORT_FREEZER, other.address)).to.be.reverted
      await expect(main.connect(other).grantRole(SHORT_FREEZER, other.address)).to.be.reverted

      // Check SHORT_FREEZER not updated
      expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(true)
      expect(await main.hasRole(SHORT_FREEZER, addr2.address)).to.equal(false)
      expect(await main.hasRole(SHORT_FREEZER, other.address)).to.equal(false)
    })

    it('Should not allow to set LONG_FREEZER if not OWNER', async () => {
      expect(await main.hasRole(LONG_FREEZER, addr1.address)).to.equal(false)
      expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(true)
      expect(await main.hasRole(LONG_FREEZER, other.address)).to.equal(false)

      // Set LONG_FREEZER from non-owner
      await expect(main.connect(addr1).grantRole(LONG_FREEZER, other.address)).to.be.reverted
      await expect(main.connect(addr2).grantRole(LONG_FREEZER, other.address)).to.be.reverted
      await expect(main.connect(other).grantRole(LONG_FREEZER, other.address)).to.be.reverted

      // Check LONG_FREEZER not updated
      expect(await main.hasRole(LONG_FREEZER, addr1.address)).to.equal(false)
      expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(true)
      expect(await main.hasRole(LONG_FREEZER, other.address)).to.equal(false)
    })

    it('Should allow to renounce SHORT_FREEZER', async () => {
      // Renounce role
      await main.connect(addr1).renounceRole(SHORT_FREEZER, addr1.address)

      // Check SHORT_FREEZER renounced
      expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(false)
      await expect(main.connect(addr1).freezeShort()).to.be.reverted

      // Owner should still be OWNER
      expect(await main.hasRole(SHORT_FREEZER, owner.address)).to.equal(true)
    })

    it('Should allow to renounce LONG_FREEZER', async () => {
      // Renounce role
      await main.connect(addr2).renounceRole(LONG_FREEZER, addr2.address)

      // Check LONG_FREEZER renounced
      expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(false)
      await expect(main.connect(addr2).freezeLong()).to.be.reverted // refresh call

      // Owner should still be OWNER
      expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(true)
    })

    it('Should renounce LONG_FREEZER automatically after 6 uses', async () => {
      // 6 uses
      await main.connect(addr2).freezeLong()
      await main.connect(addr2).freezeLong()
      await main.connect(addr2).freezeLong()
      await main.connect(addr2).freezeLong()
      await main.connect(addr2).freezeLong()
      await main.connect(addr2).freezeLong()

      // Check LONG_FREEZER renounced
      expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(false)
      expect(await main.longFreezes(addr2.address)).to.equal(0)
      await expect(main.connect(addr2).freezeLong()).to.be.reverted // refresh call

      // Owner should still be OWNER
      expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(true)
    })

    it('Should allow to renounce SHORT_FREEZER if OWNER without losing OWNER', async () => {
      // Renounce role with owner
      await main.connect(owner).renounceRole(SHORT_FREEZER, owner.address)

      // Check SHORT_FREEZER renounced
      expect(await main.hasRole(SHORT_FREEZER, owner.address)).to.equal(false)

      // Owner should still be OWNER
      expect(await main.hasRole(OWNER, owner.address)).to.equal(true)

      // Can re-grant to self
      await main.connect(owner).grantRole(SHORT_FREEZER, owner.address)
      expect(await main.hasRole(SHORT_FREEZER, owner.address)).to.equal(true)
    })

    it('Should allow to renounce LONG_FREEZER if OWNER without losing OWNER', async () => {
      // Renounce role with owner
      await main.connect(owner).renounceRole(LONG_FREEZER, owner.address)

      // Check LONG_FREEZER renounced
      expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(false)

      // Owner should still be OWNER
      expect(await main.hasRole(OWNER, owner.address)).to.equal(true)

      // Can re-grant to self
      await main.connect(owner).grantRole(LONG_FREEZER, owner.address)
      expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(true)
    })

    it('Should allow to set short freeze properly', async () => {
      await expect(main.connect(addr2).setShortFreeze(1)).to.be.reverted
      await expect(main.connect(owner).setShortFreeze(0)).to.be.revertedWith(
        'short freeze out of range'
      )
      await expect(main.connect(owner).setShortFreeze(2592000 + 1)).to.be.revertedWith(
        'short freeze out of range'
      )
      await main.connect(owner).setShortFreeze(2592000)
      expect(await main.shortFreeze()).to.equal(2592000)
      await main.connect(owner).setShortFreeze(2)
      expect(await main.shortFreeze()).to.equal(2)
    })

    it('Should allow to set long freeze properly', async () => {
      await expect(main.connect(addr2).setLongFreeze(1)).to.be.reverted
      await expect(main.connect(owner).setLongFreeze(0)).to.be.revertedWith(
        'long freeze out of range'
      )
      await expect(main.connect(owner).setLongFreeze(31536000 + 1)).to.be.revertedWith(
        'long freeze out of range'
      )
      await main.connect(owner).setLongFreeze(31536000)
      expect(await main.longFreeze()).to.equal(31536000)

      await main.connect(owner).setLongFreeze(2)
      expect(await main.longFreeze()).to.equal(2)
    })
  })

  describe('Configuration/State #fast', () => {
    it('Should allow to update tradingDelay if OWNER and perform validations', async () => {
      const newValue: BigNumber = bn('360')

      // Check existing value
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)

      // If not owner cannot update
      await expect(backingManager.connect(other).setTradingDelay(newValue)).to.be.reverted

      // Check value did not change
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)

      // Update with owner
      await expect(backingManager.connect(owner).setTradingDelay(newValue))
        .to.emit(backingManager, 'TradingDelaySet')
        .withArgs(config.tradingDelay, newValue)

      // Check value was updated
      expect(await backingManager.tradingDelay()).to.equal(newValue)

      // Cannot update with value > max
      await expect(
        backingManager.connect(owner).setTradingDelay(MAX_TRADING_DELAY + 1)
      ).to.be.revertedWith('invalid tradingDelay')
    })

    it('Should allow to update maxTradeSlippage if OWNER and perform validations', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await backingManager.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

      // If not owner cannot update
      await expect(backingManager.connect(other).setMaxTradeSlippage(newValue)).to.be.reverted

      // Check value did not change
      expect(await backingManager.maxTradeSlippage()).to.equal(config.maxTradeSlippage)

      // Update with owner
      await expect(backingManager.connect(owner).setMaxTradeSlippage(newValue))
        .to.emit(backingManager, 'MaxTradeSlippageSet')
        .withArgs(config.maxTradeSlippage, newValue)

      // Check value was updated
      expect(await backingManager.maxTradeSlippage()).to.equal(newValue)

      // Cannot update with value > max
      await expect(
        backingManager.connect(owner).setMaxTradeSlippage(MAX_TRADE_SLIPPAGE)
      ).to.be.revertedWith('invalid maxTradeSlippage')
    })

    it('Should allow to update minTradeVolume if OWNER and perform validations', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await backingManager.minTradeVolume()).to.equal(config.minTradeVolume)

      // If not owner cannot update
      await expect(backingManager.connect(other).setMinTradeVolume(newValue)).to.be.reverted

      // Check value did not change
      expect(await backingManager.minTradeVolume()).to.equal(config.minTradeVolume)

      // Update with owner
      await expect(backingManager.connect(owner).setMinTradeVolume(newValue))
        .to.emit(backingManager, 'MinTradeVolumeSet')
        .withArgs(config.minTradeVolume, newValue)

      // Check value was updated
      expect(await backingManager.minTradeVolume()).to.equal(newValue)

      // Cannot update with value > max
      await expect(
        backingManager.connect(owner).setMinTradeVolume(MAX_MIN_TRADE_VOLUME.add(1))
      ).to.be.revertedWith('invalid minTradeVolume')
    })

    it('Should allow to update backingBuffer if OWNER and perform validations', async () => {
      const newValue: BigNumber = fp('0.02')

      // Check existing value
      expect(await backingManager.backingBuffer()).to.equal(config.backingBuffer)

      // If not owner cannot update
      await expect(backingManager.connect(other).setBackingBuffer(newValue)).to.be.reverted

      // Check value did not change
      expect(await backingManager.backingBuffer()).to.equal(config.backingBuffer)

      // Update with owner
      await expect(backingManager.connect(owner).setBackingBuffer(newValue))
        .to.emit(backingManager, 'BackingBufferSet')
        .withArgs(config.backingBuffer, newValue)

      // Check value was updated
      expect(await backingManager.backingBuffer()).to.equal(newValue)

      // Cannot update with value > max
      await expect(
        backingManager.connect(owner).setBackingBuffer(MAX_BACKING_BUFFER.add(1))
      ).to.be.revertedWith('invalid backingBuffer')
    })

    it('Should perform validations on for granting allowances', async () => {
      // These should start with allowance
      expect(await token0.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)
      expect(await token1.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)
      expect(await token2.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)
      expect(await token3.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)

      // Cannot grant allowance token not registered
      await expect(
        backingManager.connect(addr1).grantRTokenAllowance(erc20s[5].address)
      ).to.be.revertedWith('erc20 unregistered')
    })

    it('Should grant allowances when paused', async () => {
      await main.connect(owner).pause()
      await expect(backingManager.grantRTokenAllowance(ZERO_ADDRESS)).to.be.revertedWith(
        'erc20 unregistered'
      )
      await expect(backingManager.grantRTokenAllowance(erc20s[0].address)).to.not.be.reverted
    })

    it('Should not grant allowances when frozen', async () => {
      await main.connect(owner).freezeForever()
      await expect(backingManager.grantRTokenAllowance(ZERO_ADDRESS)).to.be.revertedWith('frozen')
    })

    it('Should return backing tokens', async () => {
      expect(await facade.basketTokens(rToken.address)).to.eql([
        token0.address,
        token1.address,
        token2.address,
        token3.address,
      ])
    })

    it('Should allow to update shortFreeze if OWNER', async () => {
      const newValue: BigNumber = bn(1)
      await main.connect(owner).grantRole(SHORT_FREEZER, addr1.address)

      // Check existing value
      expect(await main.shortFreeze()).to.equal(config.shortFreeze)

      // If not owner cannot update
      await expect(main.connect(addr1).setShortFreeze(newValue)).to.be.reverted

      // Check value did not change
      expect(await main.shortFreeze()).to.equal(config.shortFreeze)

      // Update with owner
      await expect(main.connect(owner).setShortFreeze(newValue))
        .to.emit(main, 'ShortFreezeDurationSet')
        .withArgs(config.shortFreeze, newValue)

      // Check value was updated
      expect(await main.shortFreeze()).to.equal(newValue)
    })

    it('Should allow to update longFreeze if OWNER', async () => {
      const newValue: BigNumber = bn(1)
      await main.connect(owner).grantRole(SHORT_FREEZER, addr1.address)

      // Check existing value
      expect(await main.longFreeze()).to.equal(config.longFreeze)

      // If not owner cannot update
      await expect(main.connect(addr1).setShortFreeze(newValue)).to.be.reverted

      // Check value did not change
      expect(await main.longFreeze()).to.equal(config.longFreeze)

      // Update with owner
      await expect(main.connect(owner).setLongFreeze(newValue))
        .to.emit(main, 'LongFreezeDurationSet')
        .withArgs(config.longFreeze, newValue)

      // Check value was updated
      expect(await main.longFreeze()).to.equal(newValue)
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

    it('Should revert with gas error if cannot reserve 900k gas', async () => {
      expect(await assetRegistry.isRegistered(collateral0.address))
      await expect(
        assetRegistry.unregister(collateral0.address, { gasLimit: bn('9e5') })
      ).to.be.revertedWith('not enough gas to unregister safely')
    })

    it('Should be able to disableBasket during deregistration with basket size of 128', async () => {
      // Set up backup config
      await basketHandler.setBackupConfig(await ethers.utils.formatBytes32String('USD'), 1, [
        token1.address,
      ])

      // Register 128 coll
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )
      const ERC20Factory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
      const CollFactory: ContractFactory = await ethers.getContractFactory('FiatCollateral')

      const coll = []
      for (let i = 0; i < 127; i++) {
        const newToken: ERC20Mock = <ERC20Mock>(
          await ERC20Factory.deploy('NewTKN Token' + i, 'NewTKN' + i)
        )
        const newColl = await CollFactory.deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: chainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: newToken.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: await collateral0.oracleTimeout(),
          targetName: await ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await collateral0.delayUntilDefault(),
        })
        await assetRegistry.connect(owner).register(newColl.address)
        coll.push(newColl)
      }

      // Register 1 gas-guzzling coll
      const newToken: ERC20Mock = <ERC20Mock>(
        await ERC20Factory.deploy('Gas Guzzling Token', 'GasTKN')
      )
      const GasGuzzlingFactory: ContractFactory = await ethers.getContractFactory(
        'GasGuzzlingFiatCollateral'
      )
      const gasGuzzlingColl = await GasGuzzlingFactory.deploy({
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: await collateral0.chainlinkFeed(),
        oracleError: ORACLE_ERROR,
        erc20: newToken.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: await collateral0.oracleTimeout(),
        targetName: await ethers.utils.formatBytes32String('USD'),
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: await collateral0.delayUntilDefault(),
      })
      await assetRegistry.connect(owner).register(gasGuzzlingColl.address)
      coll.push(gasGuzzlingColl)

      // Put all 128 coll in the basket
      const erc20s = await Promise.all(coll.map(async (c) => await c.erc20()))
      const refAmts = erc20s.map(() => fp('1'))
      expect(erc20s.length).to.equal(128)
      await basketHandler.setPrimeBasket(erc20s, refAmts)
      await basketHandler.refreshBasket()
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      const [quoteERC20s, tokAmts] = await basketHandler.quote(fp('1'), 0)
      expect(quoteERC20s.length).to.equal(128)
      expect(tokAmts.length).to.equal(128)

      // Ensure can disableBasket
      const replacementColl = await CollFactory.deploy({
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: await collateral0.chainlinkFeed(),
        oracleError: ORACLE_ERROR,
        erc20: await gasGuzzlingColl.erc20(),
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: await collateral0.oracleTimeout(),
        targetName: await ethers.utils.formatBytes32String('USD'),
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: await collateral0.delayUntilDefault(),
      })
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await gasGuzzlingColl.setRevertRefPerTok(true)
      await assetRegistry.swapRegistered(replacementColl.address, { gasLimit: bn('1e6') })
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
      await gasGuzzlingColl.setRevertRefPerTok(false)
      await basketHandler.refreshBasket()
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await assetRegistry.swapRegistered(gasGuzzlingColl.address, { gasLimit: bn('1e6') })
      await gasGuzzlingColl.setRevertRefPerTok(true)
      await assetRegistry.unregister(gasGuzzlingColl.address, { gasLimit: bn('1e6') })
      expect(await assetRegistry.isRegistered(gasGuzzlingColl.address)).to.equal(false)
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
      await basketHandler.refreshBasket()
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    })

    it('Should allow to register Asset if OWNER', async () => {
      // Setup new Asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAsset: Asset = <Asset>await AssetFactory.deploy(
        PRICE_TIMEOUT,
        await collateral0.chainlinkFeed(), // any feed will do
        ORACLE_ERROR,
        erc20s[5].address,
        config.rTokenMaxTradeVolume,
        1
      )

      const duplicateAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          ONE_ADDRESS,
          ORACLE_ERROR,
          token0.address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.erc20s()).length

      // Cannot add asset if not owner
      await expect(assetRegistry.connect(other).register(newAsset.address)).to.be.reverted

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

    it('Should allow to unregister asset if OWNER', async () => {
      // Setup new Asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          ONE_ADDRESS,
          ORACLE_ERROR,
          token0.address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Setup new asset with new ERC20
      const ERC20Factory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
      const newToken: ERC20Mock = <ERC20Mock>await ERC20Factory.deploy('NewTKN Token', 'NewTKN')
      const newTokenAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          ONE_ADDRESS,
          ORACLE_ERROR,
          newToken.address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.erc20s()).length

      // Check assets
      let allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.contain(compToken.address)
      expect(allERC20s).to.not.contain(erc20s[5].address)

      // Cannot remove asset if not owner
      await expect(assetRegistry.connect(other).unregister(compAsset.address)).to.be.reverted

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

    it('Should allow to swap Asset if OWNER', async () => {
      // Setup new Asset - Reusing token
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          await collateral0.chainlinkFeed(),
          ORACLE_ERROR,
          token0.address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Setup another one with new token (cannot be used in swap)
      const invalidAssetForSwap: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          ONE_ADDRESS,
          ORACLE_ERROR,
          erc20s[5].address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.erc20s()).length

      // Cannot swap asset if not owner
      await expect(
        assetRegistry.connect(other).swapRegistered(newAsset.address)
      ).to.be.revertedWith('governance only')

      // Cannot swap asset if ERC20 is not registered
      await expect(
        assetRegistry.connect(owner).swapRegistered(invalidAssetForSwap.address)
      ).to.be.revertedWith('no ERC20 collision')

      // Check asset remains the same
      expect(await assetRegistry.toAsset(token0.address)).to.equal(collateral0.address)

      // Swap Asset
      await expectEvents(assetRegistry.connect(owner).swapRegistered(newAsset.address), [
        {
          contract: assetRegistry,
          name: 'AssetUnregistered',
          args: [token0.address, collateral0.address],
          emitted: true,
        },
        {
          contract: assetRegistry,
          name: 'AssetRegistered',
          args: [token0.address, newAsset.address],
          emitted: true,
        },
      ])

      // Check length is not modified and erc20 remains registered
      const allERC20s = await assetRegistry.erc20s()
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

    it('Should allow to register/unregister/swap Assets when frozen', async () => {
      // Setup new Asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAsset: Asset = <Asset>await AssetFactory.deploy(
        PRICE_TIMEOUT,
        await collateral0.chainlinkFeed(), // any feed will do
        ORACLE_ERROR,
        erc20s[5].address,
        config.rTokenMaxTradeVolume,
        1
      )

      // Get previous length for assets
      const previousLength = (await assetRegistry.erc20s()).length

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Add new asset
      await expect(assetRegistry.connect(owner).register(newAsset.address))
        .to.emit(assetRegistry, 'AssetRegistered')
        .withArgs(erc20s[5].address, newAsset.address)

      // Check it was added
      let allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.contain(erc20s[5].address)
      expect(allERC20s.length).to.equal(previousLength + 1)

      // Remove asset
      await expect(assetRegistry.connect(owner).unregister(newAsset.address))
        .to.emit(assetRegistry, 'AssetUnregistered')
        .withArgs(erc20s[5].address, newAsset.address)

      // Check if it was removed
      allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.not.contain(erc20s[5].address)
      expect(allERC20s.length).to.equal(previousLength)

      // SWAP an asset - Reusing token
      const swapAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          await collateral0.chainlinkFeed(),
          ORACLE_ERROR,
          token0.address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Swap Asset
      await expectEvents(assetRegistry.connect(owner).swapRegistered(swapAsset.address), [
        {
          contract: assetRegistry,
          name: 'AssetUnregistered',
          args: [token0.address, collateral0.address],
          emitted: true,
        },
        {
          contract: assetRegistry,
          name: 'AssetRegistered',
          args: [token0.address, swapAsset.address],
          emitted: true,
        },
      ])

      // Check length is not modified and erc20 remains registered
      allERC20s = await assetRegistry.erc20s()
      expect(allERC20s).to.contain(token0.address)
      expect(allERC20s.length).to.equal(previousLength)
    })

    context('With quantity reverting', function () {
      let InvalidRefPerTokFiatCollFactory: ContractFactory
      let revertCollateral: InvalidRefPerTokCollateralMock

      beforeEach(async function () {
        // Setup collateral that can revert on refPerTok
        InvalidRefPerTokFiatCollFactory = await ethers.getContractFactory(
          'InvalidRefPerTokCollateralMock'
        )
        revertCollateral = <InvalidRefPerTokCollateralMock>(
          await InvalidRefPerTokFiatCollFactory.deploy(
            {
              priceTimeout: PRICE_TIMEOUT,
              chainlinkFeed: await collateral2.chainlinkFeed(),
              oracleError: ORACLE_ERROR,
              erc20: erc20s[5].address,
              maxTradeVolume: config.rTokenMaxTradeVolume,
              oracleTimeout: await collateral2.oracleTimeout(),
              targetName: ethers.utils.formatBytes32String('USD'),
              defaultThreshold: DEFAULT_THRESHOLD,
              delayUntilDefault: await collateral2.delayUntilDefault(),
            },
            REVENUE_HIDING
          )
        )

        // Register new asset
        await assetRegistry.connect(owner).register(revertCollateral.address)
        await revertCollateral.refresh()
      })

      it('Should disable basket when quantity reverts on Unregister', async () => {
        // Check basket is sound
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

        // Set the collateral to revert on refPerTok
        await revertCollateral.setRefPerTokRevert(true)

        // Unregister the new collateral - Will disable basket
        await assetRegistry.connect(owner).unregister(revertCollateral.address)

        // Basket is now disabled
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
      })

      it('Should disable basket when quantity reverts on Swap', async () => {
        // Check basket is sound
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

        // Set the collateral to revert on refPerTok
        await revertCollateral.setRefPerTokRevert(true)

        // Attempt to swap the new collateral - Will disable basket
        await assetRegistry.connect(owner).swapRegistered(revertCollateral.address)

        // Basket is now disabled
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
      })
    })
  })

  describe('Basket Handling', () => {
    it('Should not allow to set prime Basket if not OWNER', async () => {
      await expect(
        basketHandler.connect(other).setPrimeBasket([token0.address], [fp('1')])
      ).to.be.revertedWith('governance only')
    })

    it('Should not allow to set prime Basket with invalid length', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([token0.address], [])
      ).to.be.revertedWith('must be same length')
    })

    it('Should not allow to set prime Basket with non-collateral tokens', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([compToken.address], [fp('1')])
      ).to.be.revertedWith('token is not collateral')
    })

    it('Should not allow to set prime Basket with duplicate ERC20s', async () => {
      await expect(
        basketHandler
          .connect(owner)
          .setPrimeBasket([token0.address, token0.address], [fp('1'), fp('1')])
      ).to.be.revertedWith('contains duplicates')
    })

    it('Should not allow to set prime Basket with 0 address tokens', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([ZERO_ADDRESS], [fp('1')])
      ).to.be.revertedWith('address zero is not valid collateral')
    })

    it('Should not allow to set prime Basket with stRSR', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([stRSR.address], [fp('1')])
      ).to.be.revertedWith('stRSR is not valid collateral')
    })

    it('Should not allow to set prime Basket with invalid target amounts', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([token0.address], [MAX_TARGET_AMT.add(1)])
      ).to.be.revertedWith('invalid target amount; too large')
    })

    it('Should not allow to set prime Basket with an empty basket', async () => {
      await expect(basketHandler.connect(owner).setPrimeBasket([], [])).to.be.revertedWith(
        'cannot empty basket'
      )
    })

    it('Should not allow to set prime Basket with a zero amount', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([token0.address], [0])
      ).to.be.revertedWith('invalid target amount; must be nonzero')
    })

    it('Should not allow to set prime Basket with RSR/RToken', async () => {
      await expect(
        basketHandler.connect(owner).setPrimeBasket([rsr.address], [fp('1')])
      ).to.be.revertedWith('RSR is not valid collateral')

      await expect(
        basketHandler
          .connect(owner)
          .setPrimeBasket([token0.address, rToken.address], [fp('0.5'), fp('0.5')])
      ).to.be.revertedWith('RToken is not valid collateral')
    })

    it('Should allow to set prime Basket if OWNER', async () => {
      // Set basket
      await expect(basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')]))
        .to.emit(basketHandler, 'PrimeBasketSet')
        .withArgs([token0.address], [fp('1')], [ethers.utils.formatBytes32String('USD')])
    })

    it('Should return (FIX_ZERO, FIX_MAX) for basketsHeldBy(<any account>) if the basket is empty', async () => {
      // run a fresh deployment specifically for this test
      const receipt = await (
        await deployer.deploy(
          'RTKN RToken (empty basket)',
          'RTKN (empty basket)',
          'mandate (empty basket)',
          owner.address,
          config
        )
      ).wait()
      const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main
      const newMain: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)
      const emptyBasketHandler: IBasketHandler = <IBasketHandler>(
        await ethers.getContractAt('IBasketHandler', await newMain.basketHandler())
      )
      const busHeld = await emptyBasketHandler.basketsHeldBy(addr1.address)
      expect(busHeld[0]).to.equal(0)
      expect(busHeld[1]).to.equal(MAX_UINT192)
    })

    it('Should not allow to set backup Config if not OWNER', async () => {
      await expect(
        basketHandler
          .connect(other)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [token0.address])
      ).to.be.revertedWith('governance only')
    })

    it('Should not allow to set backup Config with non-collateral tokens', async () => {
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [compToken.address])
      ).to.be.revertedWith('token is not collateral')
    })

    it('Should not allow to set backup Config with RSR/RToken', async () => {
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [rsr.address])
      ).to.be.revertedWith('RSR is not valid collateral')

      it('Should not allow to set backup Config with duplicate ERC20s', async () => {
        await expect(
          basketHandler
            .connect(owner)
            .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [
              token0.address,
              token0.address,
            ])
        ).to.be.revertedWith('contains duplicates')
      })

      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [rToken.address])
      ).to.be.revertedWith('RToken is not valid collateral')
    })

    it('Should allow to set backup Config if OWNER', async () => {
      // Set basket
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [token0.address])
      )
        .to.emit(basketHandler, 'BackupConfigSet')
        .withArgs(ethers.utils.formatBytes32String('USD'), bn(1), [token0.address])
    })

    it('Should not allow to refresh basket if not OWNER when paused', async () => {
      await main.connect(owner).pause()
      await expect(basketHandler.connect(other).refreshBasket()).to.be.revertedWith(
        'basket unrefreshable'
      )
    })

    it('Should not allow to refresh basket if not OWNER when frozen', async () => {
      await main.connect(owner).freezeForever()
      await expect(basketHandler.connect(other).refreshBasket()).to.be.revertedWith(
        'basket unrefreshable'
      )
    })

    it('Should not allow to poke when paused', async () => {
      await main.connect(owner).pause()
      await expect(main.connect(other).poke()).to.be.revertedWith('paused or frozen')
    })

    it('Should not allow to poke when frozen', async () => {
      await main.connect(owner).freezeForever()
      await expect(main.connect(other).poke()).to.be.revertedWith('paused or frozen')
    })

    it('Should not allow to refresh basket if not OWNER when unfrozen and unpaused', async () => {
      await expect(basketHandler.connect(other).refreshBasket()).to.be.revertedWith(
        'basket unrefreshable'
      )
    })

    it('Should not allow to disable basket if not AssetRegistry', async () => {
      await expect(basketHandler.connect(owner).disableBasket()).to.be.revertedWith(
        'asset registry only'
      )
    })

    it('Should allow to call refresh Basket if OWNER and paused - No changes', async () => {
      await main.connect(owner).pause()
      // Switch basket - No backup nor default
      await expect(basketHandler.connect(owner).refreshBasket()).to.emit(basketHandler, 'BasketSet')

      // Basket remains the same in this case
      expect(await basketHandler.fullyCollateralized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(token0.address)
      expect(backing[1]).to.equal(token1.address)
      expect(backing[2]).to.equal(token2.address)
      expect(backing[3]).to.equal(token3.address)

      expect(backing.length).to.equal(4)

      // Not updated so basket last changed is not set
      expect(await basketHandler.timestamp()).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await main.connect(owner).unpause()
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    })

    it('Should handle full collateral deregistration and disable the basket', async () => {
      // Check status
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.quantity(token1.address)).to.equal(basketsNeededAmts[1])

      // Set backup configuration
      await basketHandler
        .connect(owner)
        .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [token0.address])

      // Unregister the basket collaterals, skipping collateral0
      await expect(assetRegistry.connect(owner).unregister(collateral1.address)).to.emit(
        assetRegistry,
        'AssetUnregistered'
      )
      await expect(assetRegistry.connect(owner).unregister(collateral2.address)).to.emit(
        assetRegistry,
        'AssetUnregistered'
      )
      await expect(assetRegistry.connect(owner).unregister(collateral3.address)).to.emit(
        assetRegistry,
        'AssetUnregistered'
      )

      await expect(basketHandler.refreshBasket()).to.emit(basketHandler, 'BasketSet')

      // Basket should be 100% collateral0
      const toks = await facade.basketTokens(rToken.address)
      expect(toks.length).to.equal(1)
      expect(toks[0]).to.equal(token0.address)

      // Unregister collateral0
      await expect(assetRegistry.connect(owner).unregister(collateral0.address)).to.emit(
        assetRegistry,
        'AssetUnregistered'
      )

      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [], [], true)

      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
      // toks = await facade.basketTokens(rToken.address)
      // expect(await basketHandler.quantity(token1.address)).to.equal(0)
      // expect(toks.length).to.equal(0)
    })

    it('Should include value of defaulted collateral when checking basket price', async () => {
      // Check status and price
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

      // Default one of the collaterals
      // Set Token1 to default - 50% price reduction
      await setOraclePrice(collateral1.address, bn('0.5e8'))

      // Mark default as probable
      await collateral1.refresh()

      // Advance time post delayUntilDefault
      await advanceTime((await collateral1.delayUntilDefault()).toString())

      // Mark default as confirmed
      await collateral1.refresh()

      // Check status and price again
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

      // Check BU price -- 1/4 of the basket has lost half its value
      await expectPrice(basketHandler.address, fp('0.875'), ORACLE_ERROR, true)

      // Set collateral1 price to invalid value that should produce [0, FIX_MAX]
      await setOraclePrice(collateral1.address, MAX_UINT192)

      // Check BU price -- 1/4 of the basket has lost all its value
      const asset = await ethers.getContractAt('Asset', basketHandler.address)
      const [lowPrice, highPrice] = await asset.price()
      expect(lowPrice).to.be.closeTo(fp('0.75'), fp('0.75').div(100)) // within 1%
      expect(highPrice).to.equal(MAX_UINT192)

      // Set basket config
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [
            token0.address,
            token2.address,
            token3.address,
          ])
      ).to.emit(basketHandler, 'BackupConfigSet')

      // After basket refresh, price should increase
      await basketHandler.refreshBasket()

      // Check BU price
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)
    })

    it('Should handle collateral with price = 0 when checking basket price', async () => {
      // Check status and price
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

      // Set fallback to 0 for one of the collaterals (swapping the collateral)
      const ZeroPriceATokenFiatCollateralFactory: ContractFactory = await ethers.getContractFactory(
        'InvalidATokenFiatCollateralMock'
      )
      const newColl2 = <ATokenFiatCollateral>await ZeroPriceATokenFiatCollateralFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral2.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: await collateral2.erc20(),
          maxTradeVolume: await collateral2.maxTradeVolume(),
          oracleTimeout: await collateral2.oracleTimeout(),
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await collateral2.delayUntilDefault(),
        },
        REVENUE_HIDING
      )

      // Swap collateral
      await assetRegistry.connect(owner).swapRegistered(newColl2.address)

      // Set price = 0, which hits 3 of our 4 collateral in the basket
      await setOraclePrice(newColl2.address, bn('0'))

      // Check status and price again
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
      await expectPrice(basketHandler.address, fp('0.25'), ORACLE_ERROR, true)
    })

    it('Should handle a collateral (price * quantity) overflow', async () => {
      // Check status and price
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)

      // Swap in mock collateral with overflowing price
      const MockableCollateralFactory: ContractFactory = await ethers.getContractFactory(
        'MockableCollateral'
      )
      const newColl = <MockableCollateral>await MockableCollateralFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral2.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: await collateral2.erc20(),
          maxTradeVolume: await collateral2.maxTradeVolume(),
          oracleTimeout: await collateral2.oracleTimeout(),
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await collateral2.delayUntilDefault(),
        },
        REVENUE_HIDING
      )
      await assetRegistry.connect(owner).swapRegistered(newColl.address)
      await setOraclePrice(newColl.address, MAX_UINT192) // overflow
      await expectUnpriced(newColl.address)
      await newColl.setTargetPerRef(1)
      await basketHandler.setPrimeBasket([await newColl.erc20()], [fp('1000')])
      await basketHandler.refreshBasket()

      // Expect [something > 0, FIX_MAX]
      const bh = await ethers.getContractAt('Asset', basketHandler.address)
      const [lowPrice, highPrice] = await bh.price()
      expect(lowPrice).to.be.gt(0)
      expect(highPrice).to.equal(MAX_UINT192)
    })

    it('Should handle overflow in price calculation and return [FIX_MAX, FIX_MAX] - case 1', async () => {
      // Swap collateral with one that can have refPerTok modified
      const InvalidRefPerTokFiatCollFactory = await ethers.getContractFactory(
        'InvalidRefPerTokCollateralMock'
      )
      const newColl = <InvalidRefPerTokCollateralMock>await InvalidRefPerTokFiatCollFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral2.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: await collateral2.erc20(),
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: await collateral2.oracleTimeout(),
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await collateral2.delayUntilDefault(),
        },
        REVENUE_HIDING
      )

      // Register collateral
      await assetRegistry.connect(owner).swapRegistered(newColl.address)
      await newColl.refresh()

      // Set basket with single collateral
      await basketHandler.connect(owner).setPrimeBasket([token2.address], [fp('1000')])

      // Change basket - valid at this point
      await basketHandler.connect(owner).refreshBasket()

      // Set refPerTok = 1
      await newColl.setRate(bn(1))

      const newPrice: BigNumber = MAX_UINT192.div(bn('1e10'))
      await setOraclePrice(collateral2.address, newPrice.sub(newPrice.div(100))) // oracle error

      const [lowPrice, highPrice] = await basketHandler.price()
      expect(lowPrice).to.equal(MAX_UINT192)
      expect(highPrice).to.equal(MAX_UINT192)
    })

    it('Should handle overflow in price calculation and return [FIX_MAX, FIX_MAX] - case 2', async () => {
      // Set basket with single collateral
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1.1')])
      await basketHandler.refreshBasket()

      const newPrice: BigNumber = MAX_UINT192.div(bn('1e10'))
      await setOraclePrice(collateral0.address, newPrice.sub(newPrice.div(100))) // oracle error

      const [lowPrice, highPrice] = await basketHandler.price()
      expect(lowPrice).to.equal(MAX_UINT192)
      expect(highPrice).to.equal(MAX_UINT192)
    })

    it('Should disable basket on asset deregistration + return quantities correctly', async () => {
      // Check values
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(
        initialBal.mul(4)
      ) // only 0.25 of each required
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr2.address)).to.equal(
        initialBal.mul(4)
      ) // only 0.25 of each required
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, other.address)).to.equal(0)
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Swap a token for a non-collateral asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          await collateral1.chainlinkFeed(),
          ORACLE_ERROR,
          token1.address,
          config.rTokenMaxTradeVolume,
          1
        )
      )
      // Swap Asset
      await expectEvents(assetRegistry.connect(owner).swapRegistered(newAsset.address), [
        {
          contract: assetRegistry,
          name: 'AssetUnregistered',
          args: [token1.address, collateral1.address],
          emitted: true,
        },
        {
          contract: assetRegistry,
          name: 'AssetRegistered',
          args: [token1.address, newAsset.address],
          emitted: true,
        },
        { contract: basketHandler, name: 'BasketSet', args: [1, [], [], true], emitted: true },
      ])
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

      // Check values - All zero
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, other.address)).to.equal(0)

      // Check quantities for non-collateral asset
      expect(await basketHandler.quantity(token0.address)).to.equal(basketsNeededAmts[0])
      expect(await basketHandler.quantity(token1.address)).to.equal(0)
      expect(await basketHandler.quantity(token2.address)).to.equal(basketsNeededAmts[2])
      expect(await basketHandler.quantity(token3.address)).to.equal(basketsNeededAmts[3].mul(50))

      // Swap basket should not find valid basket because no backup config
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(1, [], [], true)

      // Check values - All zero
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, other.address)).to.equal(0)

      // Set basket config
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            token0.address,
            token2.address,
            token3.address,
          ])
      ).to.emit(basketHandler, 'BackupConfigSet')

      // Swap basket should now find valid basket
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [], [], false)

      // Check values - Should no longer be zero
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.not.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr2.address)).to.not.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, other.address)).to.equal(0)

      // Unregister 2 tokens from the basket
      await expect(assetRegistry.connect(owner).unregister(newAsset.address)).to.not.emit(
        basketHandler,
        'BasketSet'
      )
      await expect(assetRegistry.connect(owner).unregister(collateral3.address))
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(2, [], [], true)

      // Check values - All zero
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr2.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, other.address)).to.equal(0)

      expect(await basketHandler.quantity(token3.address)).to.equal(0)

      // Swap basket should now find valid basket
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(3, [], [], false)

      // Check values
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(
        initialBal.mul(2)
      ) // 0.5 of each
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr2.address)).to.equal(
        initialBal.mul(2)
      ) // 0.5 of each
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, other.address)).to.equal(0)

      expect(await basketHandler.quantity(token0.address)).to.equal(basketsNeededAmts[0].mul(2))
      expect(await basketHandler.quantity(token1.address)).to.equal(0)
      expect(await basketHandler.quantity(token2.address)).to.equal(basketsNeededAmts[0].mul(2))
      expect(await basketHandler.quantity(token3.address)).to.equal(0)

      // Finish emptying basket
      await expect(assetRegistry.connect(owner).unregister(collateral0.address)).to.emit(
        assetRegistry,
        'AssetUnregistered'
      )
      await expect(assetRegistry.connect(owner).unregister(collateral2.address)).to.emit(
        assetRegistry,
        'AssetUnregistered'
      )

      // Should be empty basket
      await expect(basketHandler.refreshBasket())
        .to.emit(basketHandler, 'BasketSet')
        .withArgs(3, [], [], true)

      // Check values - All zero
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr2.address)).to.equal(0)
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, other.address)).to.equal(0)

      expect(await basketHandler.quantity(token0.address)).to.equal(0)
      expect(await basketHandler.quantity(token1.address)).to.equal(0)
      expect(await basketHandler.quantity(token2.address)).to.equal(0)
      expect(await basketHandler.quantity(token3.address)).to.equal(0)
    })

    it('Should return FIX_MAX quantity for collateral when refPerTok = 0', async () => {
      expect(await basketHandler.quantity(token2.address)).to.equal(basketsNeededAmts[2])

      // Set Token2 to hard default - Zero rate
      await token2.setExchangeRate(fp('0'))
      await collateral2.refresh()
      expect(await basketHandler.quantity(token2.address)).to.equal(MAX_UINT192)
    })

    it('Should return no basketsHeld when collateral is disabled', async () => {
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(
        initialBal.mul(4)
      )

      // Set Token2 to hard default - Zero rate
      await token2.setExchangeRate(fp('0'))
      await collateral2.refresh()
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
    })

    it('Should return no basketsHeld when refPerTok = 0', async () => {
      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(
        initialBal.mul(4)
      )

      // Swap collateral with one that can have refPerTok = 0 without defaulting
      const InvalidRefPerTokFiatCollFactory = await ethers.getContractFactory(
        'InvalidRefPerTokCollateralMock'
      )
      const newColl = <InvalidRefPerTokCollateralMock>await InvalidRefPerTokFiatCollFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral2.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: await collateral2.erc20(),
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: await collateral2.oracleTimeout(),
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await collateral2.delayUntilDefault(),
        },
        REVENUE_HIDING
      )

      await assetRegistry.connect(owner).swapRegistered(newColl.address)
      await newColl.refresh()

      // Change basket - valid at this point
      await basketHandler.connect(owner).refreshBasket()

      // Set refPerTok = 0
      await newColl.setRate(bn(0))

      expect(await facadeTest.wholeBasketsHeldBy(rToken.address, addr1.address)).to.equal(0)
    })

    it('Should return FIX_MAX as basket price in case of 1st overflow (for individual collateral)', async () => {
      expect(await basketHandler.quantity(token2.address)).to.equal(basketsNeededAmts[2])

      // Set RefperTok = 0
      await token2.setExchangeRate(fp('0'))
      await collateral2.refresh()
      expect(await basketHandler.quantity(token2.address)).to.equal(MAX_UINT192)

      // Check BU price
      await expectPrice(basketHandler.address, fp('0.75'), ORACLE_ERROR, true)
    })

    it('Should return FIX_MAX as basket price in case of 2nd overflow (for individual collateral)', async () => {
      expect(await basketHandler.quantity(token2.address)).to.equal(basketsNeededAmts[2])

      // Swap out collateral plugin for one that can return a 0 price without raising FIX_MAX
      const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral')
      const coll = <ATokenFiatCollateral>await ATokenCollateralFactory.deploy(
        {
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: await collateral2.chainlinkFeed(),
          oracleError: ORACLE_ERROR,
          erc20: await collateral2.erc20(),
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: await collateral2.oracleTimeout(),
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: await collateral2.delayUntilDefault(),
        },
        REVENUE_HIDING
      )

      await assetRegistry.connect(owner).swapRegistered(coll.address)
      await basketHandler.refreshBasket()

      // Set RefperTok = 0
      await token2.setExchangeRate(fp('0'))
      await coll.refresh()
      // await assetRegistry.refresh()
      expect(await basketHandler.quantity(token2.address)).to.equal(MAX_UINT192)

      // Check BU price
      await expectPrice(basketHandler.address, fp('0.75'), ORACLE_ERROR, true)
    })

    it('Should not put backup tokens with different targetName in the basket', async () => {
      // Swap out collateral for bad target name
      const CollFactory = await ethers.getContractFactory('FiatCollateral')
      const newColl = await CollFactory.deploy({
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: await collateral0.chainlinkFeed(),
        oracleError: ORACLE_ERROR,
        erc20: token0.address,
        maxTradeVolume: config.rTokenMaxTradeVolume,
        oracleTimeout: await collateral0.oracleTimeout(),
        targetName: await ethers.utils.formatBytes32String('NEW TARGET'),
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: await collateral0.delayUntilDefault(),
      })

      await assetRegistry.connect(owner).swapRegistered(newColl.address)

      // Change basket
      await basketHandler.connect(owner).refreshBasket()

      // New basket should be disabled since no basket backup config
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

      // Set basket backup config
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            token0.address,
            token2.address,
            token3.address,
          ])
      ).to.emit(basketHandler, 'BackupConfigSet')

      // Change basket
      await basketHandler.connect(owner).refreshBasket()

      // New basket should not contain token0
      const newBasket = await facade.basketTokens(rToken.address)
      for (let i = 0; i < newBasket.length; i++) {
        expect(newBasket[i]).to.not.equal(token0.address)
      }
    })

    it('Should skip over IFFY collateral in switchBasket', async () => {
      // Set up IFFY collateral
      await setOraclePrice(collateral1.address, bn('0.5'))
      await assetRegistry.refresh()
      expect(await collateral1.status()).to.equal(CollateralStatus.IFFY)

      // Set basket backup config
      await expect(
        basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(2), [
            token0.address, // still SOUND
            token1.address,
          ])
      ).to.emit(basketHandler, 'BackupConfigSet')

      // Change basket
      expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
      await basketHandler.connect(owner).refreshBasket()
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      const [tokens] = await basketHandler.quote(fp('1'), 0)
      expect(tokens.length).to.equal(3)
      expect(tokens[0]).to.not.equal(collateral1.address)
      expect(tokens[1]).to.not.equal(collateral1.address)
      expect(tokens[2]).to.not.equal(collateral1.address)
    })
  })

  describeGas('Gas Reporting', () => {
    it('Asset Registry - Refresh', async () => {
      // Basket handler can run refresh
      await whileImpersonating(basketHandler.address, async (bhsigner) => {
        await snapshotGasCost(assetRegistry.connect(bhsigner).refresh())
      })
    })

    it('Asset Registry - Register Asset', async () => {
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )

      // Setup new Assets
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          chainlinkFeed.address,
          ORACLE_ERROR,
          erc20s[5].address,
          config.rTokenMaxTradeVolume,
          1
        )
      )
      const newAsset2: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          chainlinkFeed.address,
          ORACLE_ERROR,
          erc20s[6].address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Add new asset
      await snapshotGasCost(assetRegistry.connect(owner).register(newAsset.address))

      // Add another asset
      await snapshotGasCost(assetRegistry.connect(owner).register(newAsset2.address))
    })

    it('Asset Registry - Unregister Asset', async () => {
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )

      // Setup new Assets
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const newAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          chainlinkFeed.address,
          ORACLE_ERROR,
          erc20s[5].address,
          config.rTokenMaxTradeVolume,
          1
        )
      )
      const newAsset2: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          chainlinkFeed.address,
          ORACLE_ERROR,
          erc20s[6].address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Add new asset
      await assetRegistry.connect(owner).register(newAsset.address)

      // Add another asset
      await assetRegistry.connect(owner).register(newAsset2.address)

      // Unregister both
      await snapshotGasCost(assetRegistry.connect(owner).unregister(newAsset.address))
      await snapshotGasCost(assetRegistry.connect(owner).unregister(newAsset2.address))
    })

    it('Asset Registry - Swap Registered Asset', async () => {
      const chainlinkFeed = <MockV3Aggregator>(
        await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
      )

      // Swap in replacement asset
      const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
      const replacementAsset: Asset = <Asset>(
        await AssetFactory.deploy(
          PRICE_TIMEOUT,
          chainlinkFeed.address,
          ORACLE_ERROR,
          erc20s[0].address,
          config.rTokenMaxTradeVolume,
          1
        )
      )

      // Swap for replacementAsset
      await snapshotGasCost(assetRegistry.connect(owner).swapRegistered(replacementAsset.address))
    })
  })
})

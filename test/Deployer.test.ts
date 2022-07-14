import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IComponents, IConfig, IImplementations } from '../common/configuration'
import { ZERO_ADDRESS } from '../common/constants'
import { bn } from '../common/numbers'
import {
  Asset,
  ERC20Mock,
  Facade,
  GnosisMock,
  IAssetRegistry,
  IBasketHandler,
  RTokenAsset,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  TestIStRSR,
  TradingLibP0,
} from '../typechain'
import { defaultFixture, Implementation, IMPLEMENTATION } from './fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe(`DeployerP${IMPLEMENTATION} contract #fast`, () => {
  let owner: SignerWithAddress
  let mock: SignerWithAddress

  // Deployer contract
  let deployer: TestIDeployer

  // Config
  let config: IConfig

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // AAVE and Compound
  let compAsset: Asset
  let aaveAsset: Asset

  // Market / Facade
  let gnosis: GnosisMock
  let broker: TestIBroker
  let facade: Facade

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

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  // Implementation-agnostic interface for deploying the Deployer
  const deployNewDeployer = async (
    rsr: string,
    gnosis: string,
    facade: string,
    rsrAsset: string,
    implementations?: IImplementations
  ): Promise<TestIDeployer> => {
    if (IMPLEMENTATION == Implementation.P0) {
      const TradingLibFactory: ContractFactory = await ethers.getContractFactory('TradingLibP0')
      const tradingLib: TradingLibP0 = <TradingLibP0>await TradingLibFactory.deploy()

      const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0', {
        libraries: { TradingLibP0: tradingLib.address },
      })
      return <TestIDeployer>await DeployerFactory.deploy(rsr, gnosis, facade, rsrAsset)
    } else if (IMPLEMENTATION == Implementation.P1) {
      const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
      return <TestIDeployer>(
        await DeployerFactory.deploy(rsr, gnosis, facade, rsrAsset, implementations)
      )
    } else {
      throw new Error('PROTO_IMPL must be set to either `0` or `1`')
    }
  }

  beforeEach(async () => {
    ;[owner, mock] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      compAsset,
      aaveAsset,
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
  })

  describe('Validations', () => {
    it('Should validate addresses in constructor', async () => {
      const validateComponent = async (
        implementations: IImplementations,
        name: keyof IComponents
      ) => {
        implementations.components[name] = ZERO_ADDRESS
        await expect(
          deployNewDeployer(
            rsr.address,
            gnosis.address,
            facade.address,
            rsrAsset.address,
            implementations
          )
        ).to.be.revertedWith('invalid address')
        implementations.components[name] = mock.address
      }

      if (IMPLEMENTATION == Implementation.P0) {
        await expect(
          deployNewDeployer(rsr.address, gnosis.address, facade.address, ZERO_ADDRESS)
        ).to.be.revertedWith('invalid address')

        await expect(
          deployNewDeployer(rsr.address, gnosis.address, ZERO_ADDRESS, rsrAsset.address)
        ).to.be.revertedWith('invalid address')

        await expect(
          deployNewDeployer(rsr.address, ZERO_ADDRESS, facade.address, rsrAsset.address)
        ).to.be.revertedWith('invalid address')

        await expect(
          deployNewDeployer(ZERO_ADDRESS, gnosis.address, facade.address, rsrAsset.address)
        ).to.be.revertedWith('invalid address')

        await expect(
          deployNewDeployer(rsr.address, gnosis.address, facade.address, rsrAsset.address)
        ).to.not.be.reverted
      } else if (IMPLEMENTATION == Implementation.P1) {
        const implementations: IImplementations = {
          main: mock.address,
          components: {
            rToken: mock.address,
            stRSR: mock.address,
            assetRegistry: mock.address,
            basketHandler: mock.address,
            backingManager: mock.address,
            distributor: mock.address,
            furnace: mock.address,
            broker: mock.address,
            rsrTrader: mock.address,
            rTokenTrader: mock.address,
          },
          trade: mock.address,
        }

        await expect(
          deployNewDeployer(
            rsr.address,
            gnosis.address,
            facade.address,
            ZERO_ADDRESS,
            implementations
          )
        ).to.be.revertedWith('invalid address')

        await expect(
          deployNewDeployer(
            rsr.address,
            gnosis.address,
            ZERO_ADDRESS,
            rsrAsset.address,
            implementations
          )
        ).to.be.revertedWith('invalid address')

        await expect(
          deployNewDeployer(
            rsr.address,
            ZERO_ADDRESS,
            facade.address,
            rsrAsset.address,
            implementations
          )
        ).to.be.revertedWith('invalid address')

        await expect(
          deployNewDeployer(
            ZERO_ADDRESS,
            gnosis.address,
            facade.address,
            rsrAsset.address,
            implementations
          )
        ).to.be.revertedWith('invalid address')

        // Check implementations
        // Main
        implementations.main = ZERO_ADDRESS
        await expect(
          deployNewDeployer(
            rsr.address,
            gnosis.address,
            facade.address,
            rsrAsset.address,
            implementations
          )
        ).to.be.revertedWith('invalid address')
        implementations.main = mock.address

        // Trade
        implementations.trade = ZERO_ADDRESS
        await expect(
          deployNewDeployer(
            rsr.address,
            gnosis.address,
            facade.address,
            rsrAsset.address,
            implementations
          )
        ).to.be.revertedWith('invalid address')
        implementations.trade = mock.address

        await validateComponent(implementations, 'assetRegistry')
        await validateComponent(implementations, 'backingManager')
        await validateComponent(implementations, 'basketHandler')
        await validateComponent(implementations, 'broker')
        await validateComponent(implementations, 'distributor')
        await validateComponent(implementations, 'furnace')
        await validateComponent(implementations, 'rsrTrader')
        await validateComponent(implementations, 'rTokenTrader')
        await validateComponent(implementations, 'rToken')
        await validateComponent(implementations, 'stRSR')

        await expect(
          deployNewDeployer(
            rsr.address,
            gnosis.address,
            facade.address,
            rsrAsset.address,
            implementations
          )
        ).to.not.be.reverted
      }
    })
  })

  describe('Deployment', () => {
    it('Should setup values correctly', async () => {
      expect(await deployer.ENS()).to.equal('reserveprotocol.eth')
      expect(await deployer.rsr()).to.equal(rsr.address)
      expect(await deployer.gnosis()).to.equal(gnosis.address)
      expect(await deployer.rsrAsset()).to.equal(rsrAsset.address)
    })

    it('Should deploy required contracts', async () => {
      expect(main.address).to.not.equal(ZERO_ADDRESS)
      // Assets
      expect(rsrAsset.address).to.not.equal(ZERO_ADDRESS)
      expect(compAsset.address).to.not.equal(ZERO_ADDRESS)
      expect(aaveAsset.address).to.not.equal(ZERO_ADDRESS)
      expect(rTokenAsset.address).to.not.equal(ZERO_ADDRESS)

      // Core
      expect(rToken.address).to.not.equal(ZERO_ADDRESS)
      expect(furnace.address).to.not.equal(ZERO_ADDRESS)
      expect(stRSR.address).to.not.equal(ZERO_ADDRESS)
      expect(assetRegistry.address).to.not.equal(ZERO_ADDRESS)
      expect(basketHandler.address).to.not.equal(ZERO_ADDRESS)
      expect(backingManager.address).to.not.equal(ZERO_ADDRESS)
      expect(distributor.address).to.not.equal(ZERO_ADDRESS)
      expect(rsrTrader.address).to.not.equal(ZERO_ADDRESS)
      expect(rTokenTrader.address).to.not.equal(ZERO_ADDRESS)

      // Other contracts
      expect(facade.address).to.not.equal(ZERO_ADDRESS)
    })

    it('Should emit event', async () => {
      await expect(
        deployer.deploy('RTKN RToken', 'RTKN', 'manifesto', owner.address, config)
      ).to.emit(deployer, 'RTokenCreated')
    })

    it('Should setup Main correctly', async () => {
      // Assets
      // RSR
      expect(await assetRegistry.toAsset(rsr.address)).to.equal(rsrAsset.address)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await main.rsr()).to.equal(rsr.address)

      // RToken
      expect(await assetRegistry.toAsset(rToken.address)).to.equal(rTokenAsset.address)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rToken()).to.equal(rToken.address)

      // Check assets/collateral
      const erc20s = await assetRegistry.erc20s()
      expect(await assetRegistry.toAsset(erc20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(erc20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(erc20s[2])).to.equal(aaveAsset.address)
      expect(await assetRegistry.toAsset(erc20s[3])).to.equal(compAsset.address)
      expect(erc20s.length).to.eql((await facade.basketTokens(rToken.address)).length + 4)

      // Other components
      expect(await main.stRSR()).to.equal(stRSR.address)
      expect(await main.furnace()).to.equal(furnace.address)
      expect(await main.broker()).to.equal(broker.address)
      expect(await main.rsrTrader()).to.equal(rsrTrader.address)
      expect(await main.rTokenTrader()).to.equal(rTokenTrader.address)
    })

    it('Should setup RToken correctly', async () => {
      expect(await rToken.name()).to.equal('RTKN RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.main()).to.equal(main.address)
    })

    it('Should setup Furnace correctly', async () => {
      expect(await furnace.main()).to.equal(main.address)
    })

    it('Should setup revenue traders', async () => {
      expect(await rsrTrader.main()).to.equal(main.address)
      expect(await rTokenTrader.main()).to.equal(main.address)
    })

    it('Should setup BackingManager correctly', async () => {
      expect(await backingManager.main()).to.equal(main.address)
    })

    it('Should setup AssetRegistry correctly', async () => {
      expect(await assetRegistry.main()).to.equal(main.address)
    })

    it('Should setup BasketHandler correctly', async () => {
      expect(await basketHandler.main()).to.equal(main.address)
    })

    it('Should setup Distributor correctly', async () => {
      expect(await distributor.main()).to.equal(main.address)
    })

    it('Should setup Broker correctly', async () => {
      expect(await broker.main()).to.equal(main.address)
    })

    it('Should setup stRSR correctly', async () => {
      expect(await stRSR.name()).to.equal('stRTKNRSR Token')
      expect(await stRSR.symbol()).to.equal('stRTKNRSR')
      expect(await stRSR.decimals()).to.equal(18)
      expect(await stRSR.totalSupply()).to.equal(0)
      expect(await stRSR.main()).to.equal(main.address)
    })
  })
})

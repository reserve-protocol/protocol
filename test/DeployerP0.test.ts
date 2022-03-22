import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { ZERO_ADDRESS } from '../common/constants'
import { bn } from '../common/numbers'
import {
  AaveLendingPoolMock,
  Asset,
  AssetRegistryP0,
  BackingManagerP0,
  BasketHandlerP0,
  BrokerP0,
  ComptrollerMock,
  DeployerP0,
  DistributorP0,
  ERC20Mock,
  FacadeP0,
  FurnaceP0,
  MainP0,
  GnosisMock,
  RTokenAsset,
  RTokenP0,
  StRSRP0,
  TradingP0,
} from '../typechain'
import { defaultFixture, IConfig } from './fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('DeployerP0 contract', () => {
  let owner: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Config
  let config: IConfig

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // AAVE and Compound
  let compToken: ERC20Mock
  let compAsset: Asset
  let compoundMock: ComptrollerMock
  let aaveToken: ERC20Mock
  let aaveAsset: Asset
  let aaveMock: AaveLendingPoolMock

  // Market / Facade
  let gnosis: GnosisMock
  let broker: BrokerP0
  let facade: FacadeP0

  // Core contracts
  let rToken: RTokenP0
  let rTokenAsset: RTokenAsset
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let distributor: DistributorP0
  let rsrTrader: TradingP0
  let rTokenTrader: TradingP0

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
      compToken,
      compAsset,
      compoundMock,
      aaveToken,
      aaveAsset,
      aaveMock,
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

  describe('Deployment', () => {
    it('Should setup values correctly', async () => {
      expect(await deployer.rsr()).to.equal(rsr.address)
      expect(await deployer.comp()).to.equal(compToken.address)
      expect(await deployer.aave()).to.equal(aaveToken.address)
      expect(await deployer.gnosis()).to.equal(gnosis.address)
      expect(await deployer.comptroller()).to.equal(compoundMock.address)
      expect(await deployer.aaveLendingPool()).to.equal(aaveMock.address)
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
        deployer.deploy('RTKN RToken', 'RTKN', 'constitution', owner.address, config)
      ).to.emit(deployer, 'RTokenCreated')
    })

    it('Should register deployment', async () => {
      expect(await deployer.deployments(0)).to.equal(main.address)
    })

    it('Should setup Main correctly', async () => {
      // Owner/Pauser
      expect(await main.owner()).to.equal(owner.address)
      expect(await main.pauser()).to.equal(owner.address)

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
      expect(erc20s.length).to.eql((await facade.basketTokens()).length + 4)

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

    it('Should setup Facade correctly', async () => {
      expect(await facade.main()).to.equal(main.address)
    })
  })
})

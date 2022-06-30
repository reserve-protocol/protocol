import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig, IRTokenConfig, IRTokenSetup } from '../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../common/constants'
import { expectInIndirectReceipt } from '../common/events'
import { bn, fp } from '../common/numbers'
import { advanceTime } from './utils/time'
import {
  AaveOracleMock,
  Asset,
  CTokenMock,
  ERC20Mock,
  IBasketHandler,
  Facade,
  FacadeWrite,
  IAssetRegistry,
  RTokenAsset,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIStRSR,
  TestIRToken,
  USDCMock,
} from '../typechain'
import { Collateral, defaultFixture } from './fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('FacadeWrite contract', () => {
  let owner: SignerWithAddress

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let cToken: CTokenMock
  let basket: Collateral[]

  // Aave / Comp
  let aaveOracleInternal: AaveOracleMock
  let compToken: ERC20Mock

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let cTokenAsset: Collateral
  let compAsset: Asset
  let rTokenAsset: RTokenAsset

  // Config
  let config: IConfig

  // Deployer
  let deployer: TestIDeployer

  // Facade
  let facade: Facade

  // Core contracts
  let main: TestIMain
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let broker: TestIBroker
  let distributor: TestIDistributor
  let furnace: TestIFurnace
  let rToken: TestIRToken
  let rTokenTrader: TestIRevenueTrader
  let rsrTrader: TestIRevenueTrader
  let stRSR: TestIStRSR

  let facadeWrite: FacadeWrite
  let rTokenConfig: IRTokenConfig
  let rTokenSetup: IRTokenSetup

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    // Deploy fixture
    ;({ rsr, compToken, compAsset, aaveOracleInternal, basket, config, facade, deployer } =
      await loadFixture(defaultFixture))

    // Get assets and tokens
    ;[tokenAsset, usdcAsset, , cTokenAsset] = basket

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())

    // Deploy Facade
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeWrite')
    facadeWrite = <FacadeWrite>await FacadeFactory.deploy(deployer.address)

    // Set parameters
    rTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      manifestoURI: 'manifesto',
      params: config,
    }

    rTokenSetup = {
      rewardAssets: [compAsset.address],
      primaryBasket: [tokenAsset.address, cTokenAsset.address],
      weights: [fp('0.5'), fp('0.5')],
      backups: [
        {
          backupUnit: ethers.utils.formatBytes32String('USD'),
          diversityFactor: bn(1),
          backupCollateral: [usdcAsset.address],
        },
      ],
    }
  })

  it('Should setup values correctly', async () => {
    expect(await facadeWrite.deployer()).to.equal(deployer.address)
  })

  it('Should perform validations', async () => {
    // Set parameters
    rTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      manifestoURI: 'manifesto',
      params: config,
    }

    rTokenSetup = {
      rewardAssets: [compAsset.address],
      primaryBasket: [tokenAsset.address, cTokenAsset.address],
      weights: [fp('0.5'), fp('0.5')],
      backups: [
        {
          backupUnit: ethers.utils.formatBytes32String('USD'),
          diversityFactor: bn(1),
          backupCollateral: [usdcAsset.address],
        },
      ],
    }

    // Cannot deploy with no basket
    rTokenSetup.primaryBasket = []
    await expect(
      facadeWrite.deployRToken(rTokenConfig, rTokenSetup, owner.address)
    ).to.be.revertedWith('No collateral')

    // Cannot deploy with invalid length in weights
    rTokenSetup.primaryBasket = [tokenAsset.address, cTokenAsset.address]
    rTokenSetup.weights = [fp('1')]
    await expect(
      facadeWrite.deployRToken(rTokenConfig, rTokenSetup, owner.address)
    ).to.be.revertedWith('Invalid length')

    // Cannot deploy backup info with no collateral tokens
    rTokenSetup.primaryBasket = [tokenAsset.address, cTokenAsset.address]
    rTokenSetup.weights = [fp('0.5'), fp('0.5')]
    rTokenSetup.backups[0].backupCollateral = []
    await expect(
      facadeWrite.deployRToken(rTokenConfig, rTokenSetup, owner.address)
    ).to.be.revertedWith('No backup collateral')
  })

  context('With deployed RToken', () => {
    beforeEach(async () => {
      // Deploy RToken via FacadeWrite
      const receipt = await (
        await facadeWrite.deployRToken(rTokenConfig, rTokenSetup, owner.address)
      ).wait()

      const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
        .main
      main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

      // Get Core
      assetRegistry = <IAssetRegistry>(
        await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
      )
      backingManager = <TestIBackingManager>(
        await ethers.getContractAt('TestIBackingManager', await main.backingManager())
      )
      basketHandler = <IBasketHandler>(
        await ethers.getContractAt('IBasketHandler', await main.basketHandler())
      )

      broker = <TestIBroker>await ethers.getContractAt('TestIBroker', await main.broker())

      distributor = <TestIDistributor>(
        await ethers.getContractAt('TestIDistributor', await main.distributor())
      )

      furnace = <TestIFurnace>await ethers.getContractAt('TestIFurnace', await main.furnace())

      rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())

      rTokenTrader = <TestIRevenueTrader>(
        await ethers.getContractAt('TestIRevenueTrader', await main.rTokenTrader())
      )
      rsrTrader = <TestIRevenueTrader>(
        await ethers.getContractAt('TestIRevenueTrader', await main.rsrTrader())
      )

      stRSR = <TestIStRSR>await ethers.getContractAt('TestIStRSR', await main.stRSR())

      // Assets
      rTokenAsset = <RTokenAsset>(
        await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
      )

      rsrAsset = <Asset>(
        await ethers.getContractAt('AavePricedAsset', await assetRegistry.toAsset(rsr.address))
      )
    })

    it('Should deploy required contracts', async () => {
      expect(main.address).to.not.equal(ZERO_ADDRESS)
      // Assets
      expect(rsrAsset.address).to.not.equal(ZERO_ADDRESS)
      expect(compAsset.address).to.not.equal(ZERO_ADDRESS)
      expect(rTokenAsset.address).to.not.equal(ZERO_ADDRESS)

      // Core
      expect(assetRegistry.address).to.not.equal(ZERO_ADDRESS)
      expect(basketHandler.address).to.not.equal(ZERO_ADDRESS)
      expect(backingManager.address).to.not.equal(ZERO_ADDRESS)
      expect(broker.address).to.not.equal(ZERO_ADDRESS)
      expect(distributor.address).to.not.equal(ZERO_ADDRESS)
      expect(furnace.address).to.not.equal(ZERO_ADDRESS)
      expect(rToken.address).to.not.equal(ZERO_ADDRESS)
      expect(rTokenTrader.address).to.not.equal(ZERO_ADDRESS)
      expect(rsrTrader.address).to.not.equal(ZERO_ADDRESS)
      expect(stRSR.address).to.not.equal(ZERO_ADDRESS)
    })

    it('Should setup RToken correctly', async () => {
      // Owner/Pauser
      expect(await main.owner()).to.equal(owner.address)
      expect(await main.oneshotPauser()).to.equal(owner.address)
      expect(await main.paused()).to.equal(true)

      // RToken
      expect(await assetRegistry.toAsset(rToken.address)).to.equal(rTokenAsset.address)
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
      expect(await main.rToken()).to.equal(rToken.address)
      expect(await rToken.name()).to.equal('RTKN RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.main()).to.equal(main.address)

      // Components
      expect(await assetRegistry.main()).to.equal(main.address)
      expect(await backingManager.main()).to.equal(main.address)
      expect(await basketHandler.main()).to.equal(main.address)
      expect(await broker.main()).to.equal(main.address)
      expect(await distributor.main()).to.equal(main.address)
      expect(await furnace.main()).to.equal(main.address)
      expect(await rTokenTrader.main()).to.equal(main.address)
      expect(await rsrTrader.main()).to.equal(main.address)

      // StRSR
      expect(await stRSR.name()).to.equal('stRTKNRSR Token')
      expect(await stRSR.symbol()).to.equal('stRTKNRSR')
      expect(await stRSR.decimals()).to.equal(18)
      expect(await stRSR.totalSupply()).to.equal(0)
      expect(await stRSR.main()).to.equal(main.address)
    })

    it('Should register Assets/Collateral correctly', async () => {
      // RSR
      expect(await assetRegistry.toAsset(rsr.address)).to.equal(rsrAsset.address)
      expect(await rsrAsset.erc20()).to.equal(rsr.address)
      expect(await main.rsr()).to.equal(rsr.address)

      // Check assets/collateral
      const ERC20s = await assetRegistry.erc20s()
      expect(ERC20s[0]).to.equal(rToken.address)
      expect(ERC20s[1]).to.equal(rsr.address)
      expect(ERC20s[2]).to.equal(compToken.address)

      // Assets
      const erc20s = await assetRegistry.erc20s()
      expect(await assetRegistry.toAsset(erc20s[0])).to.equal(rTokenAsset.address)
      expect(await assetRegistry.toAsset(erc20s[1])).to.equal(rsrAsset.address)
      expect(await assetRegistry.toAsset(erc20s[2])).to.equal(compAsset.address)
      expect(await assetRegistry.toAsset(erc20s[3])).to.equal(tokenAsset.address)
      expect(await assetRegistry.toAsset(erc20s[4])).to.equal(cTokenAsset.address)
      expect(await assetRegistry.toAsset(erc20s[5])).to.equal(usdcAsset.address) // Backup token
      expect(erc20s.length).to.eql((await facade.basketTokens(rToken.address)).length + 4)

      // Collaterals
      expect(await assetRegistry.toColl(ERC20s[3])).to.equal(tokenAsset.address)
      expect(await assetRegistry.toColl(ERC20s[4])).to.equal(cTokenAsset.address)
      expect(await assetRegistry.toColl(ERC20s[5])).to.equal(usdcAsset.address)
    })

    it('Should register Basket correctly', async () => {
      // Unpause
      await main.connect(owner).unpause()

      // Basket
      expect(await basketHandler.fullyCapitalized()).to.equal(true)
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(token.address)
      expect(backing[1]).to.equal(cToken.address)

      expect(backing.length).to.equal(2)

      // Check other values
      expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      expect(await basketHandler.price()).to.equal(fp('1'))
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // Check RToken price
      expect(await rToken.price()).to.equal(fp('1'))
    })

    it('Should grant allowances to RToken correctly', async () => {
      // Basket
      const backing = await facade.basketTokens(rToken.address)
      expect(backing[0]).to.equal(token.address)
      expect(backing[1]).to.equal(cToken.address)

      expect(await token.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)
      expect(await cToken.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)
    })

    it('Should setup backup basket correctly', async () => {
      // Check initial state
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

      // Check backing
      let tokens = await facade.basketTokens(rToken.address)
      expect(tokens).to.eql([token.address, cToken.address])

      // Set Token to default - 50% price reduction
      await aaveOracleInternal.setPrice(token.address, bn('1.25e14'))

      // Mark default as probable
      await tokenAsset.refresh()

      // Check state - No changes
      expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

      // Basket should not switch yet
      await expect(basketHandler.refreshBasket())

      // Advance time post delayUntilDefault
      await advanceTime((await tokenAsset.delayUntilDefault()).toString())

      // Confirm default
      await tokenAsset.refresh()

      // Check state
      expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

      // Backing did not change
      tokens = await facade.basketTokens(rToken.address)
      expect(tokens).to.eql([token.address, cToken.address])

      // Basket switch
      await expect(basketHandler.refreshBasket()).to.emit(basketHandler, 'BasketSet')

      // Check new state - backing updated
      expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
      tokens = await facade.basketTokens(rToken.address)
      expect(tokens).to.eql([cToken.address, usdc.address])
    })
  })
})

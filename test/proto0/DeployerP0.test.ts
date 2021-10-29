import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber, ContractFactory } from 'ethers'
import { bn, divCeil, ZERO } from '../../common/numbers'
import { MAX_UINT256, ZERO_ADDRESS, BN_SCALE_FACTOR } from '../../common/constants'
import { getLatestBlockTimestamp } from '../utils/time'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { AssetP0 } from '../../typechain/AssetP0'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveLendingAddrProviderMockP0 } from '../../typechain/AaveLendingAddrProviderMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { MainP0 } from '../../typechain/MainP0'
import { VaultP0 } from '../../typechain/VaultP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { RTokenAssetP0 } from '../../typechain/RTokenAssetP0'
import { FurnaceP0 } from '../../typechain/FurnaceP0'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { AssetManagerP0 } from '../../typechain/AssetManagerP0'
import { DefaultMonitorP0 } from '../../typechain/DefaultMonitorP0'

interface IManagerConfig {
  rewardStart: BigNumber
  rewardPeriod: BigNumber
  auctionPeriod: BigNumber
  stRSRWithdrawalDelay: BigNumber
  defaultDelay: BigNumber
  maxTradeSlippage: BigNumber
  auctionClearingTolerance: BigNumber
  maxAuctionSize: BigNumber
  minRecapitalizationAuctionSize: BigNumber
  minRevenueAuctionSize: BigNumber
  migrationChunk: BigNumber
  issuanceRate: BigNumber
  defaultThreshold: BigNumber
  f: BigNumber
}

interface IParamsAssets {
  rsrAsset: string
  compAsset: string
  aaveAsset: string
}

describe('DeployerP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  // Deployer contract
  let DeployerFactory: ContractFactory
  let deployer: DeployerP0

  // Vault and Assets
  let ERC20: ContractFactory
  let tkn0: ERC20Mock
  let tkn1: ERC20Mock
  let tkn2: ERC20Mock
  let tkn3: ERC20Mock
  let VaultFactory: ContractFactory
  let vault: VaultP0
  let AssetFactory: ContractFactory
  let asset0: AssetP0
  let asset1: AssetP0
  let asset2: AssetP0
  let asset3: AssetP0
  let quantity0: BigNumber
  let quantity1: BigNumber
  let quantity2: BigNumber
  let quantity3: BigNumber
  let quantities: BigNumber[]
  let initialBal: BigNumber
  let qtyHalf: BigNumber
  let qtyThird: BigNumber
  let qtyDouble: BigNumber
  let assets: string[]

  // RSR
  let RSRAssetFactory: ContractFactory
  let rsr: ERC20Mock
  let rsrAsset: RSRAssetP0

  // AAVE and Compound
  let COMPAssetFactory: ContractFactory
  let ComptrollerMockFactory: ContractFactory
  let CompoundOracleMockFactory: ContractFactory
  let compToken: ERC20Mock
  let compAsset: COMPAssetP0
  let compoundMock: ComptrollerMockP0
  let compoundOracle: CompoundOracleMockP0
  let AAVEAssetFactory: ContractFactory
  let AaveLendingPoolMockFactory: ContractFactory
  let AaveAddrProviderFactory: ContractFactory
  let AaveOracleMockFactory: ContractFactory
  let weth: ERC20Mock
  let aaveToken: ERC20Mock
  let aaveAsset: AAVEAssetP0
  let aaveMock: AaveLendingPoolMockP0
  let aaveAddrProvider: AaveLendingAddrProviderMockP0
  let aaveOracle: AaveOracleMockP0

  // Config values
  let config: IManagerConfig
  let paramsAssets: IParamsAssets
  let rewardStart: BigNumber
  const rewardPeriod: BigNumber = bn(604800) // 1 week
  const auctionPeriod: BigNumber = bn(1800) // 30 minutes
  const stRSRWithdrawalDelay: BigNumber = bn(1209600) // 2 weeks
  const defaultDelay: BigNumber = bn(86400) // 24 hs
  const maxTradeSlippage: BigNumber = bn(5e16) // 5%
  const auctionClearingTolerance: BigNumber = bn(5e16) // 5%
  const maxAuctionSize: BigNumber = bn(1e16) // 1%
  const minRecapitalizationAuctionSize: BigNumber = bn(1e15) // 0.1%
  const minRevenueAuctionSize: BigNumber = bn(1e14) // 0.01%
  const migrationChunk: BigNumber = bn(2e17) // 20%
  const issuanceRate: BigNumber = bn(25e13) // 0.025% per block or ~0.1% per minute
  const defaultThreshold: BigNumber = bn(5e16) // 5% deviation
  const f: BigNumber = bn(6e17) // 60% to stakers

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let assetManager: AssetManagerP0
  let defaultMonitor: DefaultMonitorP0

  before(async () => {
    ;[owner, addr1] = await ethers.getSigners()

    // Create Deployer
    DeployerFactory = await ethers.getContractFactory('DeployerP0')
    deployer = <DeployerP0>await DeployerFactory.connect(owner).deploy()

    // Deploy RSR and asset
    ERC20 = await ethers.getContractFactory('ERC20Mock')
    rsr = <ERC20Mock>await ERC20.deploy('Reserve Rights', 'RSR')
    RSRAssetFactory = await ethers.getContractFactory('RSRAssetP0')
    rsrAsset = <RSRAssetP0>await RSRAssetFactory.deploy(rsr.address)

    // Deploy COMP token and Asset
    compToken = <ERC20Mock>await ERC20.deploy('COMP Token', 'COMP')
    COMPAssetFactory = await ethers.getContractFactory('COMPAssetP0')
    compAsset = <COMPAssetP0>await COMPAssetFactory.deploy(compToken.address)

    // Deploy AAVE token and Asset
    aaveToken = <ERC20Mock>await ERC20.deploy('AAVE Token', 'AAVE')
    AAVEAssetFactory = await ethers.getContractFactory('AAVEAssetP0')
    aaveAsset = <AAVEAssetP0>await AAVEAssetFactory.deploy(aaveToken.address)

    // Deploy Comp and Aave Oracle Mocks
    CompoundOracleMockFactory = await ethers.getContractFactory('CompoundOracleMockP0')
    compoundOracle = <CompoundOracleMockP0>await CompoundOracleMockFactory.deploy()

    ComptrollerMockFactory = await ethers.getContractFactory('ComptrollerMockP0')
    compoundMock = <ComptrollerMockP0>await ComptrollerMockFactory.deploy(compoundOracle.address)

    AaveOracleMockFactory = await ethers.getContractFactory('AaveOracleMockP0')
    weth = <ERC20Mock>await ERC20.deploy('Wrapped ETH', 'WETH')
    aaveOracle = <AaveOracleMockP0>await AaveOracleMockFactory.deploy(weth.address)

    AaveAddrProviderFactory = await ethers.getContractFactory('AaveLendingAddrProviderMockP0')
    aaveAddrProvider = <AaveLendingAddrProviderMockP0>await AaveAddrProviderFactory.deploy(aaveOracle.address)

    AaveLendingPoolMockFactory = await ethers.getContractFactory('AaveLendingPoolMockP0')
    aaveMock = <AaveLendingPoolMockP0>await AaveLendingPoolMockFactory.deploy(aaveAddrProvider.address)

    // Deploy Main Vault
    tkn0 = <ERC20Mock>await ERC20.deploy('Token 0', 'TKN0')
    tkn1 = <ERC20Mock>await ERC20.deploy('Token 1', 'TKN1')
    tkn2 = <ERC20Mock>await ERC20.deploy('Token 2', 'TKN2')
    tkn3 = <ERC20Mock>await ERC20.deploy('Token 3', 'TKN2')

    // Set initial amounts and set quantities
    initialBal = bn(100000e18)
    qtyHalf = bn(1e18).div(2)
    qtyThird = bn(1e18).div(3)
    qtyDouble = bn(1e18).mul(2)

    // Mint tokens
    await tkn0.connect(owner).mint(addr1.address, initialBal)
    await tkn1.connect(owner).mint(addr1.address, initialBal)
    await tkn2.connect(owner).mint(addr1.address, initialBal)
    await tkn3.connect(owner).mint(addr1.address, initialBal)

    // Set Collateral Assets and Quantities
    AssetFactory = await ethers.getContractFactory('AssetP0')
    asset0 = <AssetP0>await AssetFactory.deploy(tkn0.address, tkn0.decimals())
    asset1 = <AssetP0>await AssetFactory.deploy(tkn1.address, tkn1.decimals())
    asset2 = <AssetP0>await AssetFactory.deploy(tkn2.address, tkn2.decimals())
    asset3 = <AssetP0>await AssetFactory.deploy(tkn3.address, tkn3.decimals())

    quantity0 = qtyHalf
    quantity1 = qtyHalf
    quantity2 = qtyThird
    quantity3 = qtyDouble

    assets = [asset0.address, asset1.address, asset2.address, asset3.address]
    quantities = [quantity0, quantity1, quantity2, quantity3]

    VaultFactory = await ethers.getContractFactory('VaultP0')
    vault = <VaultP0>await VaultFactory.deploy(assets, quantities, [])

    paramsAssets = {
      rsrAsset: rsrAsset.address,
      compAsset: compAsset.address,
      aaveAsset: aaveAsset.address,
    }

    // Setup Config
    rewardStart = bn(await getLatestBlockTimestamp())
    config = {
      rewardStart: rewardStart,
      rewardPeriod: rewardPeriod,
      auctionPeriod: auctionPeriod,
      stRSRWithdrawalDelay: stRSRWithdrawalDelay,
      defaultDelay: defaultDelay,
      auctionClearingTolerance: auctionClearingTolerance,
      maxTradeSlippage: maxTradeSlippage,
      maxAuctionSize: maxAuctionSize,
      minRecapitalizationAuctionSize: minRecapitalizationAuctionSize,
      minRevenueAuctionSize: minRevenueAuctionSize,
      migrationChunk: migrationChunk,
      issuanceRate: issuanceRate,
      defaultThreshold: defaultThreshold,
      f: f,
    }

    // Get address that will be deployed
    // TO-DO: To be replaced by emitted event
    const mainAddr: string = await deployer.callStatic.deploy(
      'RToken',
      'RTKN',
      owner.address,
      vault.address,
      rsr.address,
      config,
      compoundMock.address,
      aaveMock.address,
      paramsAssets,
      assets
    )

    // Deploy actual contracts
    await deployer.deploy(
      'RToken',
      'RTKN',
      owner.address,
      vault.address,
      rsr.address,
      config,
      compoundMock.address,
      aaveMock.address,
      paramsAssets,
      assets
    )

    // Get Components
    main = <MainP0>await ethers.getContractAt('MainP0', mainAddr)
    rToken = <RTokenP0>await ethers.getContractAt('RTokenP0', await main.rToken())
    furnace = <FurnaceP0>await ethers.getContractAt('FurnaceP0', await main.furnace())
    stRSR = <StRSRP0>await ethers.getContractAt('StRSRP0', await main.stRSR())
    assetManager = <AssetManagerP0>await ethers.getContractAt('AssetManagerP0', await main.manager())
    defaultMonitor = <DefaultMonitorP0>await ethers.getContractAt('DefaultMonitorP0', await main.monitor())
  })

  describe('Deployment', () => {
    it('Should deploy contracts', async () => {
      // Contracts deployed
      expect(main.address).not.to.equal(ZERO_ADDRESS)
      expect(rToken.address).not.to.equal(ZERO_ADDRESS)
      expect(furnace.address).not.to.equal(ZERO_ADDRESS)
      expect(stRSR.address).not.to.equal(ZERO_ADDRESS)
      expect(assetManager.address).not.to.equal(ZERO_ADDRESS)
      expect(defaultMonitor.address).not.to.equal(ZERO_ADDRESS)
    })

    it('Should setup Main correctly', async () => {
      expect(await main.rsr()).to.equal(rsr.address)
      expect(await main.comptroller()).to.equal(compoundMock.address)
      expect(await main.config()).to.eql(Object.values(config))
      const rTokenAsset = <RTokenAssetP0>await ethers.getContractAt('RTokenAssetP0', await main.rTokenAsset())
      expect(await rTokenAsset.erc20()).to.equal(rToken.address)
    })

    it('Should setup RToken correctly', async () => {
      expect(await rToken.name()).to.equal('RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.main()).to.equal(main.address)
    })

    it('Should setup DefaultMonitor correctly', async () => {
      expect(await defaultMonitor.main()).to.equal(main.address)
    })

    it('Should setup Furnace correctly', async () => {
      expect(await furnace.rToken()).to.equal(rToken.address)
    })

    it('Should setup stRSR correctly', async () => {
      expect(await stRSR.main()).to.equal(main.address)
      expect(await stRSR.name()).to.equal('Staked RSR - RToken')
      expect(await stRSR.symbol()).to.equal('stRTKNRSR')
      expect(await stRSR.decimals()).to.equal(18)
      expect(await stRSR.totalSupply()).to.equal(0)
    })

    it('Should setup AssetManager correctly', async () => {
      expect(await assetManager.main()).to.equal(main.address)
      expect(await assetManager.vault()).to.equal(vault.address)
      expect(await assetManager.owner()).to.equal(owner.address)
      expect(await rsr.allowance(assetManager.address, stRSR.address)).to.equal(MAX_UINT256)
    })

    it('Should revert if Vault has unapproved assets', async () => {
      const approvedAssets = [asset0.address]
      await expect(
        deployer.deploy(
          'RToken',
          'RTKN',
          owner.address,
          vault.address,
          rsr.address,
          config,
          compoundMock.address,
          aaveMock.address,
          paramsAssets,
          approvedAssets
        )
      ).to.be.revertedWith('UnapprovedAsset()')
    })
  })
})

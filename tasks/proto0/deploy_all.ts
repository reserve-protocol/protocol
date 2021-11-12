import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { bn, fp } from '../../common/numbers';
import { RSRAssetP0 } from '../../typechain/RSRAssetP0';
import { ERC20Mock } from '../../typechain/ERC20Mock';
import { BigNumber, ContractFactory } from 'ethers';
import { task } from 'hardhat/config'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0';
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0';
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0';
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0';
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0';
import { AaveLendingAddrProviderMockP0 } from '../../typechain/AaveLendingAddrProviderMockP0';
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0';
import { VaultP0 } from '../../typechain/VaultP0';
import { IManagerConfig, IParamsAssets } from '../../test/proto0/utils/fixtures';
import { DeployerP0 } from '../../typechain/DeployerP0';
import { expectInReceipt } from '../../common/events';
import { MainP0 } from '../../typechain/MainP0';
import { RTokenP0 } from '../../typechain/RTokenP0';
import { FurnaceP0 } from '../../typechain/FurnaceP0';
import { StRSRP0 } from '../../typechain/StRSRP0';
import { DefaultMonitorP0 } from '../../typechain/DefaultMonitorP0';
import { AssetManagerP0 } from '../../typechain/AssetManagerP0';

const qtyHalf: BigNumber = bn('1e18').div(2)
const qtyThird: BigNumber = bn('1e18').div(3)
const qtyDouble: BigNumber = bn('1e18').mul(2)

function waitDeployment(contracts: any[]) {
  return Promise.all(contracts.map(contract => contract.deployed()))
}

const deployRSR = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')
  const rsr: ERC20Mock = <ERC20Mock> await ERC20.connect(deployer).deploy('Reserve Rights', 'RSR')
  await rsr.deployed()

  const RSRAssetFactory: ContractFactory = await hre.ethers.getContractFactory('RSRAssetP0')
  const rsrAsset: RSRAssetP0 = <RSRAssetP0>await RSRAssetFactory.connect(deployer).deploy(rsr.address)

  return { rsr, rsrAsset }
}

const deployVault = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  const TOKENS = [['Token 0', 'TKN0'], ['Token 1', 'TKN1'], ['Token 2', 'TKN2'], ['Token 3', 'TKN3']]
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')

  const vaultTokens = await Promise.all(TOKENS.map((tokenParams) => ERC20.connect(deployer).deploy(...tokenParams)))
  await waitDeployment(vaultTokens)

  // Set Collateral Assets and Quantities
  const AssetFactory: ContractFactory = await hre.ethers.getContractFactory('CollateralP0')
  // Deploy vault tokens as collaterals
  const collaterals = await Promise.all(vaultTokens.map((token) => AssetFactory.connect(deployer).deploy(token.address, token.decimals())))
  await waitDeployment(collaterals)

  const collateral: string[] = collaterals.map(c => c.address)
  const quantities: BigNumber[] = [qtyHalf, qtyHalf, qtyThird, qtyDouble]

  const VaultFactory: ContractFactory = await hre.ethers.getContractFactory('VaultP0')
  const vault: VaultP0 = <VaultP0>await VaultFactory.connect(deployer).deploy(collateral, quantities, [])

  return { vaultTokens, collaterals, vault }
}

const deployDependencies = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  // Deploy COMP token and Asset
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')
  const compToken: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('COMP Token', 'COMP')
  await compToken.deployed()
  const COMPAssetFactory: ContractFactory = await hre.ethers.getContractFactory('COMPAssetP0')
  const compAsset: COMPAssetP0 = <COMPAssetP0>await COMPAssetFactory.connect(deployer).deploy(compToken.address)
  await compAsset.deployed()

  // Deploy AAVE token and Asset
  const aaveToken: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('AAVE Token', 'AAVE')
  await aaveToken.deployed()
  const AAVEAssetFactory: ContractFactory = await hre.ethers.getContractFactory('AAVEAssetP0')
  const aaveAsset: AAVEAssetP0 = <AAVEAssetP0>await AAVEAssetFactory.connect(deployer).deploy(aaveToken.address)
  await aaveAsset.deployed()

  // Deploy Comp and Aave Oracle Mocks
  const CompoundOracleMockFactory: ContractFactory = await hre.ethers.getContractFactory('CompoundOracleMockP0')
  const compoundOracle: CompoundOracleMockP0 = <CompoundOracleMockP0>await CompoundOracleMockFactory.connect(deployer).deploy()
  await compoundOracle.deployed()

  const ComptrollerMockFactory: ContractFactory = await hre.ethers.getContractFactory('ComptrollerMockP0')
  const compoundMock: ComptrollerMockP0 = <ComptrollerMockP0>await ComptrollerMockFactory.connect(deployer).deploy(compoundOracle.address)
  await compoundMock.deployed()

  const AaveOracleMockFactory: ContractFactory = await hre.ethers.getContractFactory('AaveOracleMockP0')
  const weth: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('Wrapped ETH', 'WETH')
  await weth.deployed()
  const aaveOracle: AaveOracleMockP0 = <AaveOracleMockP0>await AaveOracleMockFactory.connect(deployer).deploy(weth.address)
  await aaveOracle.deployed()

  const AaveAddrProviderFactory: ContractFactory = await hre.ethers.getContractFactory('AaveLendingAddrProviderMockP0')
  const aaveAddrProvider: AaveLendingAddrProviderMockP0 = <AaveLendingAddrProviderMockP0>(
    await AaveAddrProviderFactory.connect(deployer).deploy(aaveOracle.address)
  )
  await aaveAddrProvider.deployed()

  const AaveLendingPoolMockFactory: ContractFactory = await hre.ethers.getContractFactory('AaveLendingPoolMockP0')
  const aaveMock: AaveLendingPoolMockP0 = <AaveLendingPoolMockP0>(
    await AaveLendingPoolMockFactory.connect(deployer).deploy(aaveAddrProvider.address)
  )
  await aaveMock.deployed()

  return { weth, compToken, compAsset, compoundOracle, compoundMock, aaveToken, aaveAsset, aaveOracle, aaveMock }
}

task('Proto0-deployAll', 'Deploys all proto0 contracts and a mock RToken')
.setAction(async (params, hre) => {
  const [deployer] = await hre.ethers.getSigners()
  // RSR
  console.log('Deploying RSR...')
  const { rsr, rsrAsset } = await deployRSR(hre, deployer)
  // Vault
  console.log('Deploying token vault...')
  const { vaultTokens, collaterals, vault } = await deployVault(hre, deployer)
  // Dependencies
  console.log('Deploying Aave/Compound/Oracle dependencies')
  const { weth, compToken, compAsset, compoundOracle, compoundMock, aaveToken, aaveAsset, aaveOracle, aaveMock } =
  await deployDependencies(hre, deployer)

  console.log('Setting prices...')
  // Set Default Oracle Prices
  await compoundOracle.setPrice('TKN0', bn('1e6'))
  await compoundOracle.setPrice('TKN1', bn('1e6'))
  await compoundOracle.setPrice('TKN2', bn('1e6'))
  await compoundOracle.setPrice('TKN3', bn('1e6'))
  await compoundOracle.setPrice('ETH', bn('1e6'))
  await compoundOracle.setPrice('COMP', bn('1e6'))

  Promise.all(vaultTokens.map(tkn => aaveOracle.setPrice(tkn.address, bn('1e18'))))
  await aaveOracle.setPrice(weth.address, bn('1e18'))
  await aaveOracle.setPrice(aaveToken.address, bn('1e18'))
  await aaveOracle.setPrice(compToken.address, bn('1e18'))

  const paramsAssets: IParamsAssets = {
    rsrAsset: rsrAsset.address,
    compAsset: compAsset.address,
    aaveAsset: aaveAsset.address,
  }

  // Setup Config
  const latestBlock = await hre.ethers.provider.getBlock('latest')
  const rewardStart: BigNumber = bn(await latestBlock.timestamp)
  const config: IManagerConfig = {
    rewardStart: rewardStart,
    rewardPeriod: bn('604800'), // 1 week
    auctionPeriod: bn('1800'), // 30 minutes
    stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
    defaultDelay: bn('86400'), // 24 hs
    auctionClearingTolerance: fp('0.05'), // 5%
    maxTradeSlippage: fp('0.05'), // 5%
    maxAuctionSize: fp('0.01'), // 1%
    minRecapitalizationAuctionSize: fp('0.001'), // 0.1%
    minRevenueAuctionSize: fp('0.0001'), // 0.01%
    migrationChunk: fp('0.2'), // 20%
    issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
    defaultThreshold: fp('0.05'), // 5% deviation
    f: fp('0.60'), // 60% to stakers
  }

  console.log('Deploy RToken...')
  // Create Deployer
  const DeployerFactory: ContractFactory = await hre.ethers.getContractFactory('DeployerP0')
  const rtokenDeployer: DeployerP0 = <DeployerP0>await DeployerFactory.connect(deployer).deploy()
  await rtokenDeployer.deployed()

  // Deploy actual contracts
  const receipt = await (
    await rtokenDeployer.deploy(
      'RToken',
      'RTKN',
      deployer.address,
      vault.address,
      rsr.address,
      config,
      compoundMock.address,
      aaveMock.address,
      paramsAssets,
      collaterals.map(c => c.address)
    )
  ).wait()

  const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main

  // Get Components
  const main: MainP0 = <MainP0>await hre.ethers.getContractAt('MainP0', mainAddr)
  const rToken: RTokenP0 = <RTokenP0>await hre.ethers.getContractAt('RTokenP0', await main.rToken())
  const furnace: FurnaceP0 = <FurnaceP0>await hre.ethers.getContractAt('FurnaceP0', await main.furnace())
  const stRSR: StRSRP0 = <StRSRP0>await hre.ethers.getContractAt('StRSRP0', await main.stRSR())
  const assetManager: AssetManagerP0 = <AssetManagerP0>(
    await hre.ethers.getContractAt('AssetManagerP0', await main.manager())
  )
  const defaultMonitor: DefaultMonitorP0 = <DefaultMonitorP0>(
    await hre.ethers.getContractAt('DefaultMonitorP0', await main.monitor())
  )

  return {
    rsr,
    rsrAsset,
    weth,
    compToken,
    compAsset,
    compoundOracle,
    compoundMock,
    aaveToken,
    aaveAsset,
    aaveOracle,
    aaveMock,
    vaultTokens,
    collaterals,
    vault,
    config,
    deployer,
    main,
    rToken,
    furnace,
    stRSR,
    assetManager,
    defaultMonitor,
  }
})

module.exports = {}

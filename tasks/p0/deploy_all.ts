import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MarketMock } from '@typechain/MarketMock'
import { BigNumber, ContractFactory } from 'ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

import { expectInReceipt } from '../../common/events'
import { bn, fp } from '../../common/numbers'
import { IConfig } from '../../test/p0/utils/fixtures'
import { AAVEAssetP0 } from '../../typechain/AAVEAssetP0'
import { AaveLendingAddrProviderMockP0 } from '../../typechain/AaveLendingAddrProviderMockP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { COMPAssetP0 } from '../../typechain/COMPAssetP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { DeployerP0 } from '../../typechain/DeployerP0'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { RSRAssetP0 } from '../../typechain/RSRAssetP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StRSRP0 } from '../../typechain/StRSRP0'
import { VaultP0 } from '../../typechain/VaultP0'

const qtyThird: BigNumber = bn('1e18').div(3)
export interface IRevenueShare {
  rTokenDist: BigNumber
  rsrDist: BigNumber
}

function waitDeployment(contracts: any[]) {
  return Promise.all(contracts.map((contract) => contract.deployed()))
}

const deployRSR = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')
  const rsr: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('Reserve Rights', 'RSR')
  await rsr.deployed()

  const RSRAssetFactory: ContractFactory = await hre.ethers.getContractFactory('RSRAssetP0')
  const rsrAsset: RSRAssetP0 = <RSRAssetP0>(
    await RSRAssetFactory.connect(deployer).deploy(rsr.address)
  )

  return { rsr, rsrAsset }
}

const deployVault = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  const TOKENS = [
    ['USD Test', 'USDT'],
    ['USD Asdf', 'USDA'],
    ['USD Plus', 'USDP'],
  ]
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')

  const vaultTokens = await Promise.all(
    TOKENS.map((tokenParams) => ERC20.connect(deployer).deploy(...tokenParams))
  )
  await waitDeployment(vaultTokens)

  // Set Collateral Assets and Quantities
  const AssetFactory: ContractFactory = await hre.ethers.getContractFactory('CollateralP0')
  // Deploy vault tokens as collaterals
  const collaterals = await Promise.all(
    vaultTokens.map((token) =>
      AssetFactory.connect(deployer).deploy(token.address, token.decimals())
    )
  )
  await waitDeployment(collaterals)

  const collateral: string[] = collaterals.map((c) => c.address)
  const quantities: BigNumber[] = [qtyThird, qtyThird, qtyThird]

  const VaultFactory: ContractFactory = await hre.ethers.getContractFactory('VaultP0')
  const vault: VaultP0 = <VaultP0>(
    await VaultFactory.connect(deployer).deploy(collateral, quantities, [])
  )

  return { vaultTokens, collaterals, vault }
}

const deployDependencies = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  // Deploy COMP token and Asset
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')
  const compToken: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('COMP Token', 'COMP')
  await compToken.deployed()
  const COMPAssetFactory: ContractFactory = await hre.ethers.getContractFactory('COMPAssetP0')
  const compAsset: COMPAssetP0 = <COMPAssetP0>(
    await COMPAssetFactory.connect(deployer).deploy(compToken.address)
  )
  await compAsset.deployed()

  // Deploy AAVE token and Asset
  const aaveToken: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('AAVE Token', 'AAVE')
  await aaveToken.deployed()
  const AAVEAssetFactory: ContractFactory = await hre.ethers.getContractFactory('AAVEAssetP0')
  const aaveAsset: AAVEAssetP0 = <AAVEAssetP0>(
    await AAVEAssetFactory.connect(deployer).deploy(aaveToken.address)
  )
  await aaveAsset.deployed()

  // Deploy Comp and Aave Oracle Mocks
  const CompoundOracleMockFactory: ContractFactory = await hre.ethers.getContractFactory(
    'CompoundOracleMockP0'
  )
  const compoundOracle: CompoundOracleMockP0 = <CompoundOracleMockP0>(
    await CompoundOracleMockFactory.connect(deployer).deploy()
  )
  await compoundOracle.deployed()

  const ComptrollerMockFactory: ContractFactory = await hre.ethers.getContractFactory(
    'ComptrollerMockP0'
  )
  const compoundMock: ComptrollerMockP0 = <ComptrollerMockP0>(
    await ComptrollerMockFactory.connect(deployer).deploy(compoundOracle.address)
  )
  await compoundMock.deployed()

  const AaveOracleMockFactory: ContractFactory = await hre.ethers.getContractFactory(
    'AaveOracleMockP0'
  )
  const weth: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('Wrapped ETH', 'WETH')
  await weth.deployed()
  const aaveOracle: AaveOracleMockP0 = <AaveOracleMockP0>(
    await AaveOracleMockFactory.connect(deployer).deploy(weth.address)
  )
  await aaveOracle.deployed()

  const AaveAddrProviderFactory: ContractFactory = await hre.ethers.getContractFactory(
    'AaveLendingAddrProviderMockP0'
  )
  const aaveAddrProvider: AaveLendingAddrProviderMockP0 = <AaveLendingAddrProviderMockP0>(
    await AaveAddrProviderFactory.connect(deployer).deploy(aaveOracle.address)
  )
  await aaveAddrProvider.deployed()

  const AaveLendingPoolMockFactory: ContractFactory = await hre.ethers.getContractFactory(
    'AaveLendingPoolMockP0'
  )
  const aaveMock: AaveLendingPoolMockP0 = <AaveLendingPoolMockP0>(
    await AaveLendingPoolMockFactory.connect(deployer).deploy(aaveAddrProvider.address)
  )
  await aaveMock.deployed()

  // Market
  const MarketMockFactory: ContractFactory = await hre.ethers.getContractFactory('MarketMock')
  const marketMock: MarketMock = <MarketMock>await MarketMockFactory.deploy()

  return {
    weth,
    compToken,
    compAsset,
    compoundOracle,
    compoundMock,
    aaveToken,
    aaveAsset,
    aaveOracle,
    aaveMock,
    market: marketMock,
  }
}

task('Proto0-deployAll', 'Deploys all p0 contracts and a mock RToken').setAction(
  async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()
    // RSR
    console.log('Deploying RSR...')
    const { rsr, rsrAsset } = await deployRSR(hre, deployer)
    // Mint RSR
    await rsr.mint(deployer.address, bn('1e18').mul(100000))
    // Vault
    console.log('Deploying token vault...')
    const { vaultTokens, collaterals, vault } = await deployVault(hre, deployer)
    // Mint collaterals
    await Promise.all(
      vaultTokens.map((token) => token.mint(deployer.address, bn('1e18').mul(100000)))
    )
    // Dependencies
    console.log('Deploying Aave/Compound/Oracle dependencies')
    const {
      weth,
      compToken,
      compAsset,
      compoundOracle,
      compoundMock,
      aaveToken,
      aaveAsset,
      aaveOracle,
      aaveMock,
      market,
    } = await deployDependencies(hre, deployer)

    console.log('Setting prices...')
    // Set Default Oracle Prices
    await compoundOracle.setPrice('USDT', bn('1e6'))
    await compoundOracle.setPrice('USDA', bn('1e6'))
    await compoundOracle.setPrice('USDP', bn('1e6'))
    await compoundOracle.setPrice('ETH', bn('1e6'))
    await compoundOracle.setPrice('COMP', bn('1e6'))

    Promise.all(vaultTokens.map((tkn) => aaveOracle.setPrice(tkn.address, bn('1e18'))))
    await aaveOracle.setPrice(weth.address, bn('1e18'))
    await aaveOracle.setPrice(aaveToken.address, bn('1e18'))
    await aaveOracle.setPrice(compToken.address, bn('1e18'))

    // Deploy market
    const MarketMockFactory: ContractFactory = await hre.ethers.getContractFactory('MarketMock')
    const tradingMock: MarketMock = <MarketMock>await MarketMockFactory.connect(deployer).deploy()
    await tradingMock.deployed()

    // Setup Config
    const latestBlock = await hre.ethers.provider.getBlock('latest')
    const rewardStart: BigNumber = bn(await latestBlock.timestamp)
    const config: IConfig = {
      rewardStart,
      rewardPeriod: bn('604800'), // 1 week
      auctionPeriod: bn('1800'), // 30 minutes
      stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
      defaultDelay: bn('86400'), // 24 hs
      maxTradeSlippage: fp('0.05'), // 5%
      maxAuctionSize: fp('0.01'), // 1%
      minRecapitalizationAuctionSize: fp('0.001'), // 0.1%
      minRevenueAuctionSize: fp('0.0001'), // 0.01%
      migrationChunk: fp('0.2'), // 20%
      issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
      defaultThreshold: fp('0.05'), // 5% deviation
    }

    const dist: IRevenueShare = {
      rTokenDist: fp('0.4'), // 40% RToken
      rsrDist: fp('0.6'), // 60% RSR
    }

    // Create Deployer
    const DeployerFactory: ContractFactory = await hre.ethers.getContractFactory('DeployerP0')
    const rtokenDeployer: DeployerP0 = <DeployerP0>(
      await DeployerFactory.connect(deployer).deploy(
        rsrAsset.address,
        compAsset.address,
        aaveAsset.address,
        market.address
      )
    )
    await rtokenDeployer.deployed()

    // Deploy actual contracts
    const receipt = await (
      await rtokenDeployer.deploy(
        'Reserve Dollar Plus',
        'RSDP',
        deployer.address,
        vault.address,
        config,
        dist,
        compoundMock.address,
        aaveMock.address,
        collaterals.map((c) => c.address)
      )
    ).wait()

    const mainAddr = expectInReceipt(receipt, 'RTokenCreated').args.main

    // Get Components
    const main: MainP0 = <MainP0>await hre.ethers.getContractAt('MainP0', mainAddr)
    const rToken: RTokenP0 = <RTokenP0>(
      await hre.ethers.getContractAt('RTokenP0', await main.rToken())
    )
    const stRSR: StRSRP0 = <StRSRP0>await hre.ethers.getContractAt('StRSRP0', await main.stRSR())

    console.log(`
    -------------------------
    Reserve Proto0 - Deployed
    -------------------------
    RSR             - ${rsr.address}
    RTOKEN_DEPLOYER - ${rtokenDeployer.address}
    VAULT           - ${vault.address}
    MAIN            - ${main.address}
    RTOKEN          - ${rToken.address}
    stRSR           - ${stRSR.address}
    TRADING_MOCK    - ${tradingMock.address}
    -------------------------
  `)

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
      rtokenDeployer,
      main,
      rToken,
      market,
      stRSR,
    }
  }
)

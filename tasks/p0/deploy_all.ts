import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MarketMock } from '@typechain/MarketMock'
import { BigNumber, ContractFactory } from 'ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { expectInReceipt } from '../../common/events'
import { bn, fp } from '../../common/numbers'
import { IConfig } from '../../test/p0/utils/fixtures'
import {
  AaveLendingAddrProviderMockP0,
  AaveLendingPoolMockP0,
  AaveOracleMockP0,
  AssetP0,
  CompoundOracleMockP0,
  ComptrollerMockP0,
  DeployerP0,
  ERC20Mock,
  MainP0,
} from '../../typechain'

const qtyThird: BigNumber = bn('1e18').div(3)
export interface IRevenueShare {
  rTokenDist: BigNumber
  rsrDist: BigNumber
}

const deployRSR = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')
  const rsr: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('Reserve Rights', 'RSR')
  await rsr.deployed()

  // Mint RSR
  await rsr.mint(deployer.address, bn('1e18').mul(100000))

  return rsr
}

const deployDependencies = async (hre: HardhatRuntimeEnvironment, deployer: SignerWithAddress) => {
  // Deploy COMP token and Asset
  const ERC20: ContractFactory = await hre.ethers.getContractFactory('ERC20Mock')
  const compToken: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('COMP Token', 'COMP')
  await compToken.deployed()

  // Deploy AAVE token and Asset
  const aaveToken: ERC20Mock = <ERC20Mock>await ERC20.connect(deployer).deploy('AAVE Token', 'AAVE')
  await aaveToken.deployed()

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
    compoundOracle,
    compoundMock,
    aaveToken,
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
    const rsr = await deployRSR(hre, deployer)

    // Dependencies
    console.log('Deploying Aave/Compound/Oracle dependencies')
    const {
      weth,
      compToken,
      compoundOracle,
      compoundMock,
      aaveToken,
      aaveOracle,
      aaveMock,
      market,
    } = await deployDependencies(hre, deployer)

    // Setup Config
    const latestBlock = await hre.ethers.provider.getBlock('latest')
    const config: IConfig = {
      rewardPeriod: bn('604800'), // 1 week
      auctionPeriod: bn('1800'), // 30 minutes
      stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
      defaultDelay: bn('86400'), // 24 hs
      maxTradeSlippage: fp('0.01'), // 1%
      maxAuctionSize: fp('0.01'), // 1%
      minAuctionSize: fp('0.001'), // 0.1%
      issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
      defaultThreshold: fp('0.05'), // 5% deviation
    }

    const dist: IRevenueShare = {
      rTokenDist: bn(40), // 2/5 RToken
      rsrDist: bn(60), // 3/5 RSR
    }

    const setPrice = async (addressOrSymbol: string, value: BigNumber) => {
      await compoundOracle.setPrice(addressOrSymbol, value)
      await aaveOracle.setPrice(addressOrSymbol, value)
    }

    // Set Default Oracle Prices
    await setPrice('ETH', bn('4000e6'))
    await setPrice('COMP', bn('1e6'))
    await setPrice(weth.address, bn('1e18'))
    await setPrice(aaveToken.address, bn('2.5e14'))
    await setPrice(compToken.address, bn('2.5e14'))
    await setPrice(rsr.address, bn('2.5e14'))

    // Create Deployer
    const DeployerFactory: ContractFactory = await hre.ethers.getContractFactory('DeployerP0')
    const rtokenDeployer: DeployerP0 = <DeployerP0>(
      await DeployerFactory.connect(deployer).deploy(
        rsr.address,
        compToken.address,
        aaveToken.address,
        market.address,
        compoundMock.address,
        aaveMock.address
      )
    )
    await rtokenDeployer.deployed()

    // Deploy actual contracts
    const receipt = await (
      await rtokenDeployer.deploy('Reserve Dollar Plus', 'RSDP', deployer.address, config, dist)
    ).wait()

    // Get main and facade addresses
    const { main: mainAddr, facade: facadeAddr } = expectInReceipt(receipt, 'RTokenCreated').args

    // Get Components
    const main: MainP0 = <MainP0>await hre.ethers.getContractAt('MainP0', mainAddr)
    const rTokenAddr = await main.rToken()
    const stRSRAddr = await main.stRSR()

    // TODO: Set basket and unpause main
    // // Vault
    // console.log('Deploying token vault...')
    // const { vaultTokens, collaterals, vault } = await deployBasket(hre, deployer)
    // // Mint collaterals
    // await Promise.all(
    //   vaultTokens.map((token) => token.mint(deployer.address, bn('1e18').mul(100000)))
    // )

    console.log(`
    -------------------------
    Reserve Proto0 - Deployed
    -------------------------
    RSR             - ${rsr.address}
    RTOKEN_DEPLOYER - ${rtokenDeployer.address}
    FACADE          - ${facadeAddr}
    MAIN            - ${main.address}
    RTOKEN          - ${rTokenAddr}
    stRSR           - ${stRSRAddr}
    -------------------------
  `)

    return main
  }
)

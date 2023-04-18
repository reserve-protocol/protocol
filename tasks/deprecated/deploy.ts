import {
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  DeployerP1,
  FacadeP1,
  MainP1,
  TradingLibP1,
} from '../typechain'
import { ContractFactory } from 'ethers'
import { task } from 'hardhat/config'
import { ONE_ETH } from '../common/constants'
import { expectInReceipt } from '../common/events'
import {
  AAVE_ADDRESS,
  AAVE_LENDING_ADDRESS,
  basketsNeededAmts,
  COMPTROLLER_ADDRESS,
  COMP_ADDRESS,
  config,
  deployCollaterals,
  deployImplementations,
  deployMarket,
  RSR_ADDRESS,
} from './helper'

task('deploy', 'Deploy protocol smart contracts').setAction(async (params, hre) => {
  const [deployer] = await hre.ethers.getSigners()

  const gnosisAddress = await deployMarket(hre)
  const implementations = await deployImplementations(hre)

  // Deploy TradingLib external library
  const TradingLibFactory = await hre.ethers.getContractFactory('TradingLibP1')
  const tradingLib = <TradingLibP1>await TradingLibFactory.deploy()
  await tradingLib.deployed()

  console.log('Deploying RToken deployer...')
  const DeployerFactory = <ContractFactory>await hre.ethers.getContractFactory('DeployerP1')

  const FacadeFactory: ContractFactory = await hre.ethers.getContractFactory('FacadeP1')
  const facadeImpl = <FacadeP1>await FacadeFactory.deploy()
  await facadeImpl.deployed()

  const rtokenDeployer = <DeployerP1>await DeployerFactory.connect(deployer).deploy(
    RSR_ADDRESS, // RSR
    COMP_ADDRESS, // COMP TOKEN
    AAVE_ADDRESS, // AAVE TOKEN
    gnosisAddress, // Mock Market (Auctions)
    COMPTROLLER_ADDRESS, // COMPTROLLER
    AAVE_LENDING_ADDRESS, // AAVE LENDING POOL
    facadeImpl.address,
    implementations
  )
  await rtokenDeployer.deployed()

  console.log('Deploying RToken...')
  const receipt = await (
    await rtokenDeployer.deploy('Reserve Dollar Plus', 'RSDP', 'mandate', deployer.address, config)
  ).wait()

  // Get main and facade addresses
  const { main: mainAddr } = expectInReceipt(receipt, 'RTokenCreated').args

  // Get Core
  const main = <MainP1>await hre.ethers.getContractAt('MainP1', mainAddr)
  const rTokenAddr = await main.rToken()
  const stRSRAddr = await main.stRSR()
  const assetRegistry = <AssetRegistryP1>(
    await hre.ethers.getContractAt('AssetRegistryP1', await main.assetRegistry())
  )
  const basketHandler = <BasketHandlerP1>(
    await hre.ethers.getContractAt('BasketHandlerP1', await main.basketHandler())
  )
  const backingManager = <BackingManagerP1>(
    await hre.ethers.getContractAt('BackingManagerP1', await main.backingManager())
  )

  console.log('Deploying basket collaterals...')
  const basketCollaterals = await deployCollaterals(hre)

  console.log('Setting basket...')
  // Register prime collateral
  await Promise.all(
    basketCollaterals.map(([, collateralAddress]) =>
      assetRegistry.connect(deployer).register(collateralAddress)
    )
  )

  // Set non-empty basket
  await basketHandler.connect(deployer).setPrimeBasket(
    basketCollaterals.map(([erc20Address]) => erc20Address),
    basketsNeededAmts
  )
  await basketHandler.connect(deployer).refreshBasket()

  console.log('Unpausing...')
  await main.connect(deployer).unpauseTrading()
  await main.connect(deployer).unpauseIssuance()

  // Grant allowances
  for (let i = 0; i < basketCollaterals.length; i++) {
    await backingManager.grantRTokenAllowance(await basketCollaterals[i][0])
  }

  // TODO: Test remove
  console.log('RSR Funding')
  const holderAddr = '0x6262998ced04146fa42253a5c0af90ca02dfd2a3'
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [holderAddr],
  })
  const rsrHolder = hre.ethers.provider.getSigner(holderAddr)

  const RSR = await hre.ethers.getContractAt('ERC20', RSR_ADDRESS)
  await RSR.connect(rsrHolder).transfer(deployer.address, ONE_ETH.mul(100000))

  console.log(`
    -------------------------
    Reserve Proto0 - Deployed
    -------------------------
    RTOKEN_DEPLOYER - ${rtokenDeployer.address}
    FACADE          - ${facadeImpl.address}
    MAIN            - ${main.address}
    RTOKEN          - ${rTokenAddr}
    stRSR           - ${stRSRAddr}
    -------------------------
  `)

  return main
})

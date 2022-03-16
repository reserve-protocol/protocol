import { ContractFactory } from 'ethers'
import { task } from 'hardhat/config'
import { expectInReceipt } from '../../common/events'
import { AssetRegistryP0, BasketHandlerP0, DeployerP0, MainP0 } from '../../typechain'
import {
  AAVE_ADDRESS,
  AAVE_LENDING_ADDRESS,
  basketsNeededAmts,
  COMPTROLLER_ADDRESS,
  COMP_ADDRESS,
  config,
  deployCollaterals,
  deployMarket,
  RSR_ADDRESS,
} from './helper'

task('P0-deploy', 'Deploys all Protocol components and an RToken').setAction(
  async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()
    // TODO: Replace for real gnosis market deployment
    const mockMarketAddress = await deployMarket(hre)

    console.log('Deploying RToken deployer...')
    const DeployerFactory = <ContractFactory>await hre.ethers.getContractFactory('DeployerP0')
    const rtokenDeployer = <DeployerP0>await DeployerFactory.connect(deployer).deploy(
      RSR_ADDRESS, // RSR
      COMP_ADDRESS, // COMP TOKEN
      AAVE_ADDRESS, // AAVE TOKEN
      mockMarketAddress, // Mock Market (Auctions)
      COMPTROLLER_ADDRESS, // COMPTROLLER
      AAVE_LENDING_ADDRESS // AAVE LENDING POOL
    )
    await rtokenDeployer.deployed()

    console.log('Deploying RToken...')
    const receipt = await (
      await rtokenDeployer.deploy(
        'Reserve Dollar Plus',
        'RSDP',
        'constitution',
        deployer.address,
        config
      )
    ).wait()

    // Get main and facade addresses
    const { main: mainAddr, facade: facadeAddr } = expectInReceipt(receipt, 'RTokenCreated').args

    // Get Core
    const main = <MainP0>await hre.ethers.getContractAt('MainP0', mainAddr)
    const rTokenAddr = await main.rToken()
    const stRSRAddr = await main.stRSR()
    const assetRegistry = <AssetRegistryP0>(
      await hre.ethers.getContractAt('AssetRegistryP0', await main.assetRegistry())
    )
    const basketHandler = <BasketHandlerP0>(
      await hre.ethers.getContractAt('BasketHandlerP0', await main.basketHandler())
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
    await basketHandler.connect(deployer).switchBasket()

    console.log('Unpausing...')
    await main.connect(deployer).unpause()

    console.log(`
    -------------------------
    Reserve Proto0 - Deployed
    -------------------------
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

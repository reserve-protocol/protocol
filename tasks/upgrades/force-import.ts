import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { validateDeployments } from './utils'
import { ContractFactory } from 'ethers'
import {
  IDeployments,
  getDeploymentFilename,
  getDeploymentFile,
} from '../../scripts/deployment/common'

// Force imports the contract storage layout from the deployed versions
// Only run on Mainnet to keep track of previously deployed implementations
// Example:  npx hardhat force-import --ver "2.1.0" --network mainnet
task('force-import', 'Imports implementation layout for future upgrades')
  .addParam('ver', 'the version of the implementations being imported')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    // ********* Validate this is only run on Mainnet *******
    if (hre.network.name != 'mainnet') {
      throw new Error('Only run on Mainnet')
    }

    // Get Deployed addresses
    const deploymentFilename = getDeploymentFilename(chainId, `${hre.network.name}-${params.ver}`)
    const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

    await validateDeployments(hre, deployments, params.ver)

    console.log(
      `Importing implementations for version ${params.ver} in network ${hre.network.name} (${chainId})`
    )

    // Import implementations
    await importContract(hre, deployments.implementations.main, 'MainP1')
    await importContract(hre, deployments.implementations.components.rToken, 'RTokenP1')
    await importContract(hre, deployments.implementations.components.stRSR, 'StRSRP1Votes')
    await importContract(
      hre,
      deployments.implementations.components.assetRegistry,
      'AssetRegistryP1'
    )
    await importContract(
      hre,
      deployments.implementations.components.basketHandler,
      'BasketHandlerP1'
    )
    await importContract(
      hre,
      deployments.implementations.components.backingManager,
      'BackingManagerP1',
      deployments.tradingLib
    )
    await importContract(hre, deployments.implementations.components.distributor, 'DistributorP1')
    await importContract(hre, deployments.implementations.components.furnace, 'FurnaceP1')
    await importContract(hre, deployments.implementations.components.broker, 'BrokerP1')
    await importContract(hre, deployments.implementations.components.rsrTrader, 'RevenueTraderP1')
    await importContract(
      hre,
      deployments.implementations.components.rTokenTrader,
      'RevenueTraderP1'
    )
  })

const importContract = async (
  hre: HardhatRuntimeEnvironment,
  contractAddress: string,
  factoryName: string,
  tradingLibAddress?: string
) => {
  // Get Contract Factory
  let contractFactory: ContractFactory
  if (!tradingLibAddress) {
    contractFactory = await hre.ethers.getContractFactory(factoryName)
  } else {
    // Should be BackingManagerP1
    contractFactory = await hre.ethers.getContractFactory(factoryName, {
      libraries: {
        RecollateralizationLibP1: tradingLibAddress,
      },
    })
  }

  const ver = await (await hre.ethers.getContractAt('Versioned', contractAddress)).version()

  try {
    await hre.upgrades.forceImport(contractAddress, contractFactory)

    console.log(`* Imported ${factoryName} (${ver}): ${contractAddress}`)
  } catch (error) {
    if (
      (error as Error).message.includes('The following deployment clashes with an existing one')
    ) {
      console.log(`* Skipped ${factoryName} (${ver}): ${contractAddress} - already registered`)
    } else {
      throw error
    }
  }
}

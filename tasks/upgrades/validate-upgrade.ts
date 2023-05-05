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

task('validate-upgrade', 'Validates if upgrade to new version is safe')
  .addParam('ver', 'the version of the currently deployed implementations')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    // Get Deployed addresses
    const deploymentFilename = getDeploymentFilename(chainId, `${hre.network.name}-${params.ver}`)
    const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

    await validateDeployments(hre, deployments, params.ver)

    console.log(
      `Validating upgrades from version ${params.ver} in network ${hre.network.name} (${chainId})`
    )

    await validateUpgrade(hre, deployments.implementations.main, 'MainP1')
    await validateUpgrade(hre, deployments.implementations.components.rToken, 'RTokenP1')
    await validateUpgrade(hre, deployments.implementations.components.stRSR, 'StRSRP1Votes')
    await validateUpgrade(
      hre,
      deployments.implementations.components.assetRegistry,
      'AssetRegistryP1'
    )
    await validateUpgrade(
      hre,
      deployments.implementations.components.basketHandler,
      'BasketHandlerP1'
    )
    await validateUpgrade(
      hre,
      deployments.implementations.components.backingManager,
      'BackingManagerP1',
      deployments.tradingLib,
      ['external-library-linking', 'delegatecall']
    )
    await validateUpgrade(hre, deployments.implementations.components.distributor, 'DistributorP1')
    await validateUpgrade(hre, deployments.implementations.components.furnace, 'FurnaceP1')
    await validateUpgrade(hre, deployments.implementations.components.broker, 'BrokerP1')
    await validateUpgrade(
      hre,
      deployments.implementations.components.rsrTrader,
      'RevenueTraderP1',
      undefined,
      ['delegatecall']
    )
    await validateUpgrade(
      hre,
      deployments.implementations.components.rTokenTrader,
      'RevenueTraderP1',
      undefined,
      ['delegatecall']
    )
  })

const validateUpgrade = async (
  hre: HardhatRuntimeEnvironment,
  prevImplAddress: string,
  factoryName: string,
  tradingLibAddress?: string,
  unsafeAllow?: any[]
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

  const ver = await (await hre.ethers.getContractAt('Versioned', prevImplAddress)).version()

  await hre.upgrades.validateUpgrade(prevImplAddress, contractFactory, {
    kind: 'uups',
    unsafeAllow,
  })

  console.log(
    `* Validated ${factoryName} upgrade (from version: ${ver}): address ${prevImplAddress} - OK!`
  )
}

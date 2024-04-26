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
import { BasketLibP1, RecollateralizationLibP1 } from '../../typechain'

task('validate-upgrade', 'Validates if upgrade to new version is safe')
  .addParam('ver', 'the version of the currently deployed implementations')
  .setAction(async (params, hre) => {
    const chainId = await getChainId(hre)

    // ********** Read config **********
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    if (hre.network.name != 'localhost' && hre.network.name != 'hardhat') {
      throw new Error('Only run this on a local fork')
    }

    // Get Deployed addresses, use Mainnet deployments (we are in a Mainnet fork)
    const deploymentFilename = getDeploymentFilename(1, `mainnet-${params.ver}`)
    const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

    await validateDeployments(hre, deployments, params.ver)

    console.log(
      `Validating upgrades from version ${params.ver} in network ${hre.network.name} (${chainId})`
    )

    // Deploy required libraries
    // TradingLib
    const TradingLibFactory: ContractFactory = await hre.ethers.getContractFactory(
      'RecollateralizationLibP1'
    )
    const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
      await TradingLibFactory.deploy()
    )
    await tradingLib.deployed()

    // BasketLib
    const BasketLibFactory: ContractFactory = await hre.ethers.getContractFactory('BasketLibP1')
    const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()
    await basketLib.deployed()

    await validateUpgrade(hre, deployments.implementations.main, 'MainP1')
    await validateUpgrade(hre, deployments.implementations.components.rToken, 'RTokenP1')
    await validateUpgrade(
      hre,
      deployments.implementations.components.stRSR,
      'StRSRP1Votes',
      undefined,
      undefined,
      undefined,
      true
    )
    await validateUpgrade(
      hre,
      deployments.implementations.components.assetRegistry,
      'AssetRegistryP1'
    )
    await validateUpgrade(
      hre,
      deployments.implementations.components.basketHandler,
      'BasketHandlerP1',
      undefined,
      basketLib.address,
      ['external-library-linking']
    )

    await validateUpgrade(
      hre,
      deployments.implementations.components.backingManager,
      'BackingManagerP1',
      tradingLib.address,
      undefined,
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
      undefined,
      ['delegatecall']
    )
    await validateUpgrade(
      hre,
      deployments.implementations.components.rTokenTrader,
      'RevenueTraderP1',
      undefined,
      undefined,
      ['delegatecall']
    )
  })

const validateUpgrade = async (
  hre: HardhatRuntimeEnvironment,
  prevImplAddress: string,
  factoryName: string,
  tradingLibAddress?: string,
  basketLibAddress?: string,
  unsafeAllow?: any[],
  unsafeAllowRenames?: boolean
) => {
  // Get Contract Factory
  let contractFactory: ContractFactory
  if (tradingLibAddress) {
    // BackingManagerP1
    contractFactory = await hre.ethers.getContractFactory(factoryName, {
      libraries: {
        RecollateralizationLibP1: tradingLibAddress,
      },
    })
  } else if (basketLibAddress) {
    // BasketHandlerP1
    contractFactory = await hre.ethers.getContractFactory(factoryName, {
      libraries: {
        BasketLibP1: basketLibAddress,
      },
    })
  } else {
    contractFactory = await hre.ethers.getContractFactory(factoryName)
  }

  const ver = await (await hre.ethers.getContractAt('Versioned', prevImplAddress)).version()

  await hre.upgrades.validateUpgrade(prevImplAddress, contractFactory, {
    kind: 'uups',
    unsafeAllow,
    unsafeAllowRenames,
  })

  console.log(
    `* Validated ${factoryName} upgrade (from version: ${ver}): address ${prevImplAddress} - OK!`
  )
}

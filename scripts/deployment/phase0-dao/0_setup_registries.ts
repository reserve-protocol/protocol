import hre, { ethers } from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { registryConfig } from '#/common/registries'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(
    `Deploying Registries to network ${hre.network.name} (${chainId}) with burner account: ${burner.address}`
  )

  const rConfig = registryConfig[chainId]

  if (!rConfig) {
    throw new Error(`Missing registry configuration for ${hre.network.name}`)
  }

  if (rConfig.registryControl.owner == '') {
    throw new Error(`Missing registry owner configuration for ${hre.network.name}`)
  }

  console.log('!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!')
  console.log('This will only deploy registries that are not already deployed.')
  console.log('!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!')

  /**
   * Deploy Registries
   */
  if (rConfig.registries.roleRegistry == '') {
    console.log('Deploying Role Registry...')

    const RoleRegistryFactory = await ethers.getContractFactory('RoleRegistry')
    const roleRegistry = await RoleRegistryFactory.connect(burner).deploy()

    await roleRegistry.deployed()

    await roleRegistry
      .grantRole(await roleRegistry.DEFAULT_ADMIN_ROLE(), rConfig.registryControl.owner)
      .then((e) => e.wait())

    rConfig.registries.roleRegistry = roleRegistry.address
  }

  if (rConfig.registries.versionRegistry == '') {
    console.log('Deploying Version Registry...')

    const VersionRegistryFactory = await ethers.getContractFactory('VersionRegistry')
    const versionRegistry = await VersionRegistryFactory.connect(burner).deploy(
      rConfig.registries.roleRegistry
    )

    await versionRegistry.deployed()

    rConfig.registries.versionRegistry = versionRegistry.address
    console.log('Version Registry deployed to:', versionRegistry.address)
  }

  if (rConfig.registries.assetPluginRegistry == '') {
    console.log('Deploying Asset Plugin Registry...')

    const AssetPluginRegistryFactory = await ethers.getContractFactory('AssetPluginRegistry')
    const assetPluginRegistry = await AssetPluginRegistryFactory.connect(burner).deploy(
      rConfig.registries.versionRegistry
    )

    await assetPluginRegistry.deployed()

    rConfig.registries.assetPluginRegistry = assetPluginRegistry.address
    console.log('Asset Plugin Registry deployed to:', assetPluginRegistry.address)
  }

  if (rConfig.registries.daoFeeRegistry == '') {
    console.log('Deploying DAO Fee Registry...')

    const DaoFeeRegistryFactory = await ethers.getContractFactory('DAOFeeRegistry')
    const daoFeeRegistry = await DaoFeeRegistryFactory.connect(burner).deploy(
      rConfig.registries.roleRegistry,
      rConfig.registryControl.feeRecipient
    )

    await daoFeeRegistry.deployed()

    rConfig.registries.daoFeeRegistry = daoFeeRegistry.address
    console.log('DAO Fee Registry deployed to:', daoFeeRegistry.address)
  }

  console.log('!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!')
  console.log('Update the registry configuration in *common/registries.ts*')
  console.log('You must do this before continuing to the next phase')
  console.log('This script does not setup any allowlists, the owner must do this')
  console.log('You must also either renounce ownership or revoke role from the deployer') // TODO: Can automate this?
  console.log('Chain ID:', chainId)
  console.dir(rConfig, { depth: Infinity })
  console.log('!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

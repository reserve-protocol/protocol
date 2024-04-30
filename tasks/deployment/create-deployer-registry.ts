import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { DeployerRegistry } from '../../typechain'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

task('create-deployer-registry', 'Deploys a DeployerRegistry')
  .addParam('owner', 'The address that should own the DeployerRegistr')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying DeployerRegistry to ${hre.network.name} (${chainId}) with burner account ${wallet.address}`
      )
    }

    const DeployerRegistryFactory = await hre.ethers.getContractFactory('DeployerRegistry')
    const deployerRegistry = <DeployerRegistry>(
      await DeployerRegistryFactory.connect(wallet).deploy(params.owner)
    )
    await deployerRegistry.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed DeployerRegistry to ${hre.network.name} (${chainId}): ${deployerRegistry.address}`
      )
    }

    // Uncomment to verify
    if (!params.noOutput) {
      console.log('sleeping 30s')
    }

    // Sleep to ensure API is in sync with chain
    await new Promise((r) => setTimeout(r, 30000)) // 30s

    if (!params.noOutput) {
      console.log('verifying')
    }

    /** ******************** Verify DeployerRegistry ****************************************/
    console.time('Verifying DeployerRegistry')
    await hre.run('verify:verify', {
      address: deployerRegistry.address,
      constructorArguments: [params.owner],
      contract: 'contracts/facade/DeployerRegistry.sol:DeployerRegistry',
    })
    console.timeEnd('Verifying DeployerRegistry')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { deployerRegistry: deployerRegistry.address }
  })

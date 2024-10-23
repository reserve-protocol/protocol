import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { DemurrageCollateralFactory } from '../../typechain'

task('create-demurrage-collateral-factory', 'Deploys a DemurrageCollateralFactory')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying DemurrageCollateralFactory to ${hre.network.name} (${chainId}) with burner account ${wallet.address}`
      )
    }

    const FactoryFactory = await hre.ethers.getContractFactory('DemurrageCollateralFactory')
    const demurrageCollateralFactory = <DemurrageCollateralFactory>(
      await FactoryFactory.connect(wallet).deploy()
    )
    await demurrageCollateralFactory.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed DemurrageCollateralFactory to ${hre.network.name} (${chainId}): ${demurrageCollateralFactory.address}`
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

    /** ******************** Verify DemurrageCollateralFactory ****************************************/
    console.time('Verifying DemurrageCollateralFactory')
    await hre.run('verify:verify', {
      address: demurrageCollateralFactory.address,
      constructorArguments: [],
      contract:
        'contracts/facade/factories/DemurrageCollateralFactory.sol:DemurrageCollateralFactory',
    })
    console.timeEnd('Verifying DemurrageCollateralFactory')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { demurrageCollateralFactory: demurrageCollateralFactory.address }
  })

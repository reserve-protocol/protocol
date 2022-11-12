import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { EasyAuction } from '../../../typechain'

task('deploy-mock-gnosis', 'Deploys a mock Gnosis EasyAuction')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying EasyAuction to ${hre.network.name} (${chainId}) with burner account ${deployer.address}`
      )
    }

    const gnosis = <EasyAuction>(
      await (await hre.ethers.getContractFactory('EasyAuction')).connect(deployer).deploy()
    )
    await gnosis.deployed()

    if (!params.noOutput) {
      console.log(`Deployed EasyAuction to ${hre.network.name} (${chainId}): ${gnosis.address}`)
    }

    // // Uncomment to verify
    // if (!params.noOutput) {
    //   console.log('sleeping 30s')
    // }

    // // Sleep to ensure API is in sync with chain
    // await new Promise((r) => setTimeout(r, 30000)) // 30s

    // if (!params.noOutput) {
    //   console.log('verifying')
    // }

    // /** ******************** Verify EasyAuction ****************************************/
    // console.time('Verifying EasyAuction')
    // await hre.run('verify:verify', {
    //   address: gnosis.address,
    //   constructorArguments: [],
    //   contract: 'contracts/plugins/mocks/EasyAuction.sol:EasyAuction',
    // })
    // console.timeEnd('Verifying EasyAuction')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { gnosis: gnosis.address }
  })

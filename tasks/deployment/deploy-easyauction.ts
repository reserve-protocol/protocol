import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { EasyAuction } from '../../typechain'
import { ZERO_ADDRESS } from '../../common/constants'

task('deploy-easyauction', 'Deploys a mock Easy Auction contract')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying EasyAuction to ${hre.network.name} (${chainId}) with burner account ${deployer.address}`
      )
    }

    const easyAuction = <EasyAuction>(
      await (await hre.ethers.getContractFactory('EasyAuction')).connect(deployer).deploy()
    )
    await easyAuction.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed EasyAuction to ${hre.network.name} (${chainId}): ${easyAuction.address}`
      )
    }

    // Hand away owner
    await (await easyAuction.renounceOwnership()).wait()
    if ((await easyAuction.owner()) != ZERO_ADDRESS) {
      throw new Error('EasyAuction not renounced')
    }

    if (!params.noOutput) {
      console.log(`Renounced ownership`)
      console.log('sleeping 12s')
    }

    // Sleep to ensure API is in sync with chain
    await new Promise((r) => setTimeout(r, 12000)) // 12s

    if (!params.noOutput) {
      console.log('verifying')
    }

    // /** ******************** Verify EasyAuction ****************************************/
    console.time('Verifying EasyAuction')
    await hre.run('verify:verify', {
      address: easyAuction.address,
      constructorArguments: [],
      contract: 'contracts/plugins/mocks/EasyAuction.sol:EasyAuction',
    })
    console.timeEnd('Verifying EasyAuction')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { feed: easyAuction.address }
  })

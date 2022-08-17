import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { ERC20Mock } from '../../../typechain'

task('deploy-mock-erc20', 'Deploys a mock ERC20')
  .addParam('name', 'Token name')
  .addParam('symbol', 'Token symbol')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying ERC20Mock to ${hre.network.name} (${chainId}) with burner account ${deployer.address}`
      )
    }

    const erc20 = <ERC20Mock>(
      await (await hre.ethers.getContractFactory('ERC20Mock'))
        .connect(deployer)
        .deploy(params.name, params.symbol)
    )
    await erc20.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed ERC20Mock ${params.symbol} to ${hre.network.name} (${chainId}): ${erc20.address}`
      )
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

    // /** ******************** Verify ERC20Mock ****************************************/
    // console.time('Verifying ERC20Mock')
    // await hre.run('verify:verify', {
    //   address: erc20.address,
    //   constructorArguments: [params.name, params.symbol],
    //   contract: 'contracts/plugins/mocks/ERC20Mock.sol:ERC20Mock',
    // })
    // console.timeEnd('Verifying ERC20Mock')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { erc20: erc20.address }
  })

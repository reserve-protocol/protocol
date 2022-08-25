import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { USDCMock } from '../../../typechain'

task('deploy-mock-usdc', 'Deploys a mock ERC20')
  .addParam('name', 'Token name')
  .addParam('symbol', 'Token symbol')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying USDCMock to ${hre.network.name} (${chainId}) with burner account ${deployer.address}`
      )
    }

    const erc20 = <USDCMock>(
      await (await hre.ethers.getContractFactory('USDCMock'))
        .connect(deployer)
        .deploy(params.name, params.symbol)
    )
    await erc20.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed USDCMock ${params.symbol} to ${hre.network.name} (${chainId}): ${erc20.address}`
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

    // /** ******************** Verify USDCMock ****************************************/
    // console.time('Verifying USDCMock')
    // await hre.run('verify:verify', {
    //   address: erc20.address,
    //   constructorArguments: [params.name, params.symbol],
    //   contract: 'contracts/plugins/mocks/USDCMock.sol:USDCMock',
    // })
    // console.timeEnd('Verifying USDCMock')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { erc20: erc20.address }
  })

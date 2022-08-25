import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { WBTCMock } from '../../../typechain'

task('deploy-mock-wbtc', 'Deploys a mock WBTC')
  .addParam('name', 'Token name')
  .addParam('symbol', 'Token symbol')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying WBTCMock to ${hre.network.name} (${chainId}) with burner account ${deployer.address}`
      )
    }

    const erc20 = <WBTCMock>(
      await (await hre.ethers.getContractFactory('WBTCMock'))
        .connect(deployer)
        .deploy(params.name, params.symbol)
    )
    await erc20.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed WBTCMock ${params.symbol} to ${hre.network.name} (${chainId}): ${erc20.address}`
      )
    }

    // Uncomment to verify
    // if (!params.noOutput) {
    //   console.log('sleeping 30s')
    // }

    // // Sleep to ensure API is in sync with chain
    // await new Promise((r) => setTimeout(r, 30000)) // 30s

    // if (!params.noOutput) {
    //   console.log('verifying')
    // }

    // /** ******************** Verify WBTCMock ****************************************/
    // console.time('Verifying WBTCMock')
    // await hre.run('verify:verify', {
    //   address: erc20.address,
    //   constructorArguments: [params.name, params.symbol],
    //   contract: 'contracts/plugins/mocks/WBTCMock.sol:WBTCMock',
    // })
    // console.timeEnd('Verifying WBTCMock')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { erc20: erc20.address }
  })

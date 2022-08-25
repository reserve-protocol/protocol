import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { ATokenMock } from '../../../typechain'

task('deploy-mock-atoken', 'Deploys a mock AToken')
  .addParam('name', 'Token name')
  .addParam('symbol', 'Token symbol')
  .addParam('erc20', 'Underlying ERC20 address')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying ATokenMock to ${hre.network.name} (${chainId}) with burner account ${deployer.address}...`
      )
    }

    const erc20 = <ATokenMock>(
      await (await hre.ethers.getContractFactory('ATokenMock'))
        .connect(deployer)
        .deploy(params.name, params.symbol, params.erc20)
    )
    await erc20.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed ATokenMock ${params.symbol} to ${hre.network.name} (${chainId}): ${erc20.address}`
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

    // /** ******************** Verify ATokenMock ****************************************/
    // console.time('Verifying ATokenMock')
    // await hre.run('verify:verify', {
    //   address: erc20.address,
    //   constructorArguments: [params.name, params.symbol, params.erc20],
    //   contract: 'contracts/plugins/mocks/ATokenMock.sol:ATokenMock',
    // })
    // console.timeEnd('Verifying ATokenMock')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { erc20: erc20.address }
  })

import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { CTokenMock } from '../../../typechain'

task('deploy-mock-ctoken', 'Deploys a mock CToken')
  .addParam('name', 'Token name')
  .addParam('symbol', 'Token symbol')
  .addParam('erc20', 'Underlying ERC20 address')
  .addParam('comptroller', 'The Comptroller')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying CTokenMock to ${hre.network.name} (${chainId}) with burner account ${deployer.address}...`
      )
    }

    const erc20 = <CTokenMock>(
      await (await hre.ethers.getContractFactory('CTokenMock'))
        .connect(deployer)
        .deploy(params.name, params.symbol, params.erc20, params.comptroller)
    )
    await erc20.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CTokenMock ${params.symbol} to ${hre.network.name} (${chainId}): ${erc20.address}`
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

    // /** ******************** Verify CTokenMock ****************************************/
    // console.time('Verifying CTokenMock')
    // await hre.run('verify:verify', {
    //   address: erc20.address,
    //   constructorArguments: [params.name, params.symbol, params.erc20],
    //   contract: 'contracts/plugins/mocks/CTokenMock.sol:CTokenMock',
    // })
    // console.timeEnd('Verifying CTokenMock')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { erc20: erc20.address }
  })

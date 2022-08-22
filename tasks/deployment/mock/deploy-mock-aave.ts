import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { AaveLendingPoolMock } from '../../../typechain'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

task('deploy-mock-aave', 'Deploys a mock Aave Lending Pool')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying AaveLendingPoolMock to ${hre.network.name} (${chainId}) with burner account ${deployer.address}`
      )
    }

    const pool = <AaveLendingPoolMock>(
      await (await hre.ethers.getContractFactory('AaveLendingPoolMock'))
        .connect(deployer)
        .deploy(ZERO_ADDRESS)
    )
    await pool.deployed()

    // if (!params.noOutput) {
    //   console.log(
    //     `Deployed AaveLendingPoolMock to ${hre.network.name} (${chainId}): ${pool.address}`
    //   )
    // }

    // // Uncomment to verify
    // if (!params.noOutput) {
    //   console.log('sleeping 30s')
    // }

    // // Sleep to ensure API is in sync with chain
    // await new Promise((r) => setTimeout(r, 30000)) // 30s

    // if (!params.noOutput) {
    //   console.log('verifying')
    // }

    // /** ******************** Verify AaveLendingPoolMock ****************************************/
    // console.time('Verifying AaveLendingPoolMock')
    // await hre.run('verify:verify', {
    //   address: pool.address,
    //   constructorArguments: [ZERO_ADDRESS],
    //   contract: 'contracts/plugins/mocks/AaveLendingPoolMock.sol:AaveLendingPoolMock',
    // })
    // console.timeEnd('Verifying AaveLendingPoolMock')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { pool: pool.address }
  })

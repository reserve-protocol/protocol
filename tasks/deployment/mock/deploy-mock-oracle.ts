import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { MockV3Aggregator } from '../../../typechain'

task('deploy-mock-oracle', 'Deploys a mock chainlink oracle feed')
  .addParam('decimals', 'Price decimals')
  .addParam('answer', 'Initial answer')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying MockV3Aggregator to ${hre.network.name} (${chainId}) with burner account ${deployer.address}`
      )
    }

    const feed = <MockV3Aggregator>(
      await (await hre.ethers.getContractFactory('MockV3Aggregator'))
        .connect(deployer)
        .deploy(params.decimals, params.answer)
    )
    await feed.deployed()

    if (!params.noOutput) {
      console.log(`Deployed MockV3Aggregator to ${hre.network.name} (${chainId}): ${feed.address}`)
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

    // /** ******************** Verify MockV3Aggregator ****************************************/
    // console.time('Verifying MockV3Aggregator')
    // await hre.run('verify:verify', {
    //   address: feed.address,
    //   constructorArguments: [params.decimals, params.answer],
    //   contract: 'contracts/plugins/mocks/ChainlinkMock.sol:MockV3Aggregator',
    // })
    // console.timeEnd('Verifying MockV3Aggregator')

    // if (!params.noOutput) {
    //   console.log('verified')
    // }

    return { feed: feed.address }
  })

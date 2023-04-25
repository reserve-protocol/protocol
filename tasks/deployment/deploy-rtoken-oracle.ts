import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { RTokenOracle } from '../../typechain'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

task('deploy-rtoken-oracle', 'Deploys an RTokenOracle')
  .addParam('cacheTimeout', 'The length of the cache timeout in seconds')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying RTokenOracle to ${hre.network.name} (${chainId}) with burner account ${wallet.address}`
      )
    }

    const RTokenOracleFactory = await hre.ethers.getContractFactory('RTokenOracle')
    const rTokenOracle = <RTokenOracle>(
      await RTokenOracleFactory.connect(wallet).deploy(params.cacheTimeout)
    )
    await rTokenOracle.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed RTokenOracle to ${hre.network.name} (${chainId}): ${rTokenOracle.address}`
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

    /** ******************** Verify RTokenOracle ****************************************/
    console.time('Verifying RTokenOracle')
    await hre.run('verify:verify', {
      address: rTokenOracle.address,
      constructorArguments: [params.cacheTimeout],
      contract: 'contracts/p1/RTokenOracle.sol:RTokenOracle',
    })
    console.timeEnd('Verifying RTokenOracle')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { rTokenOracle: rTokenOracle.address }
  })

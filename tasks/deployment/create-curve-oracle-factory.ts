import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { CurveOracleFactory } from '../../typechain'

task('create-curve-oracle-factory', 'Deploys a CurveOracleFactory')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying CurveOracleFactory to ${hre.network.name} (${chainId}) with burner account ${wallet.address}`
      )
    }

    const CurveOracleFactoryFactory = await hre.ethers.getContractFactory('CurveOracleFactory')
    const curveOracleFactory = <CurveOracleFactory>(
      await CurveOracleFactoryFactory.connect(wallet).deploy()
    )
    await curveOracleFactory.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CurveOracleFactory to ${hre.network.name} (${chainId}): ${curveOracleFactory.address}`
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

    /** ******************** Verify CurveOracleFactory ****************************************/
    console.time('Verifying CurveOracleFactory')
    await hre.run('verify:verify', {
      address: curveOracleFactory.address,
      constructorArguments: [],
      contract: 'contracts/facade/factories/CurveOracleFactory.sol:CurveOracleFactory',
    })
    console.timeEnd('Verifying CurveOracleFactory')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { curveOracleFactory: curveOracleFactory.address }
  })

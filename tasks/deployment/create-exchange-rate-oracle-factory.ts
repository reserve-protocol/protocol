import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { ExchangeRateOracleFactory } from '../../typechain'

task('create-exchange-rate-oracle-factory', 'Deploys an ExchangeRateOracleFactory')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying ExchangeRateOracleFactory to ${hre.network.name} (${chainId}) with burner account ${wallet.address}`
      )
    }

    const CurveOracleFactoryFactory = await hre.ethers.getContractFactory(
      'ExchangeRateOracleFactory'
    )
    const oracleFactory = <ExchangeRateOracleFactory>(
      await CurveOracleFactoryFactory.connect(wallet).deploy()
    )
    await oracleFactory.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed ExchangeRateOracleFactory to ${hre.network.name} (${chainId}): ${oracleFactory.address}`
      )
      console.log(
        `Deploying dummy ExchangeRateOracle to ${hre.network.name} (${chainId}): ${oracleFactory.address}`
      )
    }

    // Deploy dummy zero address oracle
    const addr = await oracleFactory.callStatic.deployOracle(hre.ethers.constants.AddressZero)
    await (await oracleFactory.deployOracle(hre.ethers.constants.AddressZero)).wait()

    if (!params.noOutput) {
      console.log(`Deployed dummy ExchangeRateOracle to ${hre.network.name} (${chainId}): ${addr}`)
    }

    // Uncomment to verify
    if (!params.noOutput) {
      console.log('sleeping 10s')
    }

    // Sleep to ensure API is in sync with chain
    await new Promise((r) => setTimeout(r, 10000)) // 10s

    if (!params.noOutput) {
      console.log('verifying')
    }

    /** ******************** Verify ExchangeRateOracleFactory ****************************************/
    console.time('Verifying ExchangeRateOracleFactory')
    await hre.run('verify:verify', {
      address: oracleFactory.address,
      constructorArguments: [],
      contract:
        'contracts/facade/factories/ExchangeRateOracleFactory.sol:ExchangeRateOracleFactory',
    })
    console.timeEnd('Verifying ExchangeRateOracleFactory')

    console.time('Verifying ExchangeRateOracle')
    await hre.run('verify:verify', {
      address: addr,
      constructorArguments: [hre.ethers.constants.AddressZero],
      contract: 'contracts/facade/factories/ExchangeRateOracleFactory.sol:ExchangeRateOracle',
    })
    console.timeEnd('Verifying ExchangeRateOracle')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { oracleFactory: oracleFactory.address }
  })

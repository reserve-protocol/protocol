import { getChainId } from '../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { OracleFactory } from '../../typechain'
import { networkConfig } from '../../common/configuration'

export const getRTokenAddr = (chainId: string): string => {
  if (chainId == '1' || chainId == '31337') {
    return networkConfig[chainId].tokens.eUSD!
  }
  if (chainId == '8453') {
    return networkConfig[chainId].tokens.bsdETH!
  }
  if (chainId == '42161') {
    return networkConfig[chainId].tokens.KNOX!
  }
  throw new Error(`invalid chainId: ${chainId}`)
}

task('create-oracle-factory', 'Deploys an OracleFactory')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [wallet] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    if (!params.noOutput) {
      console.log(
        `Deploying OracleFactory to ${hre.network.name} (${chainId}) with burner account ${wallet.address}`
      )
    }

    const ExchangeRateFactoryFactory = await hre.ethers.getContractFactory('OracleFactory')
    const oracleFactory = <OracleFactory>await ExchangeRateFactoryFactory.connect(wallet).deploy()
    await oracleFactory.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed OracleFactory to ${hre.network.name} (${chainId}): ${oracleFactory.address}`
      )
      console.log(
        `Deploying dummy ExchangeRateOracle to ${hre.network.name} (${chainId}): ${oracleFactory.address}`
      )
    }

    const rTokenAddr = getRTokenAddr(chainId)

    const addr = await oracleFactory.callStatic.deployOracle(rTokenAddr)
    await (await oracleFactory.deployOracle(rTokenAddr)).wait()

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

    /** ******************** Verify OracleFactory ****************************************/
    console.time('Verifying OracleFactory')
    await hre.run('verify:verify', {
      address: oracleFactory.address,
      constructorArguments: [],
      contract: 'contracts/facade/oracles/OracleFactory.sol:OracleFactory',
    })
    console.timeEnd('Verifying OracleFactory')

    console.time('Verifying ExchangeRateOracle')
    await hre.run('verify:verify', {
      address: addr,
      constructorArguments: [rTokenAddr],
      contract: 'contracts/facade/oracles/ExchangeRateOracle.sol:ExchangeRateOracle',
    })
    console.timeEnd('Verifying ExchangeRateOracle')

    if (!params.noOutput) {
      console.log('verified')
    }

    return { oracleFactory: oracleFactory.address }
  })

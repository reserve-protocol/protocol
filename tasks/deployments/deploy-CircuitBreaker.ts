import { task } from 'hardhat/config'
import { getChainId } from '../../common/blockchain-utils'

task('deploy-CircuitBreaker', 'Deploys a circuit breaker contract')
  .addParam('owner', 'Address of the Owner')
  .setAction(async ({ owner }, hre) => {
    const [deployer] = await hre.ethers.getSigners()
    const chainId = await getChainId(hre)

    console.log('* Deploying Circuit Breaker')

    const CircuitBreaker = await hre.ethers.getContractFactory('CircuitBreaker')
    const cb = await CircuitBreaker.connect(deployer).deploy(owner)

    await cb.deployed()

    console.log(`Circuit Breaker deployed at address: ${cb.address} on network ${hre.network.name} (${chainId}).`)
    console.log(`Tx: ${cb.deployTransaction.hash}\n`)

    return { cbAddr: cb.address }
  })

import { task } from 'hardhat/config'
import { getChainId } from '../../common/blockchain-utils'

task('deploy-InsurancePool', 'Deploys Insurance Pool Implementation').setAction(
  async (taskArgs, hre) => {
    const [deployer] = await hre.ethers.getSigners()
    const chainId = await getChainId(hre)

    console.log('* Deploying Insurance Pool implementation contract')

    // Deploy InsurancePool implementations
    const InsurancePool = await hre.ethers.getContractFactory('InsurancePool')
    const iPoolImpl = await InsurancePool.connect(deployer).deploy()

    await iPoolImpl.deployed()

    console.log(
      `Insurance Pool Implementation deployed at address: ${iPoolImpl.address} on network ${hre.network.name} (${chainId}).`
    )
    console.log(`Tx: ${iPoolImpl.deployTransaction.hash}\n`)

    return { iPoolImplAddr: iPoolImpl.address }
  }
)

import { task } from 'hardhat/config'
import { getChainId } from '../../common/blockchain-utils'

task('deploy-RTokenDeployer', 'Deploys RToken Implementation')
  .addParam('rtoken', 'Address of the RToken implementation')
  .addParam('insurancepool', 'Address of the Insurance Pool implementation')
  .setAction(async ({ rtoken, insurancepool }, hre) => {
    const [deployer] = await hre.ethers.getSigners()
    const chainId = await getChainId(hre)

    console.log('* Deploying RToken Deployer contract')

    const RTokenDeployer = await hre.ethers.getContractFactory('RTokenDeployer')
    const tokenDeployer = await RTokenDeployer.connect(deployer).deploy(rtoken, insurancepool)

    await tokenDeployer.deployed()

    console.log(
      `RToken Deployer deployed at address: ${tokenDeployer.address} on network ${hre.network.name} (${chainId}).`
    )
    console.log(`Tx: ${tokenDeployer.deployTransaction.hash}\n`)

    return { rTokenDeployerAddr: tokenDeployer.address }
  })

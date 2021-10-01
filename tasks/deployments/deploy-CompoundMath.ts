import { task } from 'hardhat/config'
import { getChainId } from '../../common/blockchain-utils'

task('deploy-CompoundMath', 'Deploys compound math external library').setAction(async (taskArgs, hre) => {
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log('* Deploying Compound Math external library')

  // External math lib deployment
  const CompoundMath = await hre.ethers.getContractFactory('CompoundMath')
  const mathLib = await CompoundMath.connect(deployer).deploy()

  await mathLib.deployed()

  console.log(
    `CompoundMath library deployed at address: ${mathLib.address} on network ${hre.network.name} (${chainId}).`
  )
  console.log(`Tx: ${mathLib.deployTransaction.hash}\n`)

  return { mathLibraryAddr: mathLib.address }
})

import { task } from 'hardhat/config'
import { getChainId } from '../../common/blockchain-utils'

task('deploy-RToken', 'Deploys RToken Implementation')
  .addParam('mathlib', 'Address of the external Compound Math Library')
  .setAction(async ({ mathlib }, hre) => {
    const [deployer] = await hre.ethers.getSigners()
    const chainId = await getChainId(hre)

    console.log('* Deploying RToken implementation contract')

    // Deploy RToken and InsurancePool implementations
    const RToken = await hre.ethers.getContractFactory('RToken', {
      libraries: {
        CompoundMath: mathlib,
      },
    })

    const rTokenImpl = await RToken.connect(deployer).deploy()

    await rTokenImpl.deployed()

    console.log(
      `RToken Implementation deployed at address: ${rTokenImpl.address} on network ${hre.network.name} (${chainId}).`
    )
    console.log(`Tx: ${rTokenImpl.deployTransaction.hash}\n`)

    return { rTokenImplAddr: rTokenImpl.address }
  })

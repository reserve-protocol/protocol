import { types, task } from 'hardhat/config'
import { getChainId } from '../../common/blockchain-utils'
import { expectInReceipt } from '../../common/events'

task('create-RToken', 'Creates a new RToken from the RToken Deployer')
  .addParam('tokendeployer', 'The address of the RToken Deployer')
  .addParam('owner', 'The address of the owner of the RToken')
  .addParam('name', 'The name of the RToken')
  .addParam('symbol', 'The symbol of the RToken')
  .addParam('tokenconfig', 'Token Configuration object', undefined, types.json)
  .addParam('basketinfo', 'Basket information object', undefined, types.json)
  .addParam('rsrinfo', 'RSR information object', undefined, types.json)
  .setAction(
    async ({ tokendeployer, owner, name, symbol, tokenconfig, basketinfo, rsrinfo }, hre) => {
      const [deployer] = await hre.ethers.getSigners()
      const chainId = await getChainId(hre)
      const tokenDesc = symbol + '-' + name

      console.log(`* Creating new RToken ${tokenDesc} from factory...`)

      // Create a new RToken
      const deployerInstance = await hre.ethers.getContractAt('RTokenDeployer', tokendeployer)
      const receipt = await (
        await deployerInstance
          .connect(deployer)
          .deploy(owner, name, symbol, tokenconfig, basketinfo.tokens, rsrinfo)
      ).wait()
      const rTokenAddr = expectInReceipt(receipt, 'RTokenDeployed')?.args?.rToken

      const rTokenInstance = await hre.ethers.getContractAt('RToken', rTokenAddr)
      const iPoolAddr = await rTokenInstance.insurancePool()

      console.log(
        `RToken ${tokenDesc} created at address: ${rTokenAddr} on network ${hre.network.name} (${chainId}).`
      )
      console.log(
        `Insurance Pool created at address: ${iPoolAddr} on network ${hre.network.name} (${chainId}).`
      )
      console.log(`Tx: ${receipt.transactionHash}\n`)

      return { rTokenAddr, iPoolAddr }
    }
  )

module.exports = {}

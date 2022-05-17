/* eslint-disable no-process-exit */
import hre from 'hardhat'
import { getChainId } from '../../common/blockchain-utils'
import { networkConfig } from '../../common/configuration'

async function main() {
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  // Check if chain is supported
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  console.log(`Starting full deployment on network ${hre.network.name} (${chainId})`)
  console.log(`Deployer account: ${deployer.address}\n`)

  await hre.run('P0-deploy')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

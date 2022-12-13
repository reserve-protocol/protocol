import hre from 'hardhat'
import axios from 'axios'
import { bn } from '../common/numbers'
import { getChainId } from '../common/blockchain-utils'
import { getEtherscanBaseURL } from './deployment/utils'

import { useEnv } from '#/utils/env'

async function main() {
  console.log(`Checking environment setup...\n`)

  const [deployer] = await hre.ethers.getSigners()

  // Check MNEMONIC
  if (deployer.address == '0x959FD7Ef9089B7142B6B908Dc3A8af7Aa8ff0FA1') {
    throw new Error('Using default hardhat mnemonic')
  }

  // Check Web3 RPC URL
  const { chainId } = await hre.ethers.provider.getNetwork()
  if (chainId != (await getChainId(hre))) {
    throw new Error('Invalid JSON RPC for network')
  }

  // Check Etherscan API key
  const etherscanURL = getEtherscanBaseURL(chainId, true)
  const ETHERSCAN_API_KEY = useEnv('ETHERSCAN_API_KEY')
  const { data, status } = await axios.get(
    `${etherscanURL}/api?module=stats&action=ethsupply&apikey=${ETHERSCAN_API_KEY}`,
    { headers: { Accept: 'application/json' } }
  )
  if (status != 200 || data['status'] != '1') {
    throw new Error("Can't communicate with Etherscan API")
  }

  console.log('=================================')
  console.log(`Environment checks complete! Ready to deploy to chain ${chainId}!`)

  const decaEthBal = (await hre.ethers.provider.getBalance(deployer.address)).div(bn('1e16'))
  const ethBal = (decaEthBal.toNumber() / 100).toFixed(2)
  console.log(`The deployment address is ${deployer.address} and it holds >=${ethBal} ETH`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import { HardhatUserConfig } from 'hardhat/types'

import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-ethers'
// import '@openzeppelin/hardhat-upgrades'
import '@typechain/hardhat'
import 'solidity-coverage'
import 'hardhat-gas-reporter'
import './tasks'
import dotenv from 'dotenv'
dotenv.config()

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || process.env.ALCHEMY_MAINNET_RPC_URL || ''
const ROPSTEN_RPC_URL = process.env.ROPSTEN_RPC_URL || ''
const MNEMONIC = process.env.MNEMONIC || ''

export default <HardhatUserConfig>{
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      // // To do Mainnet Forking, uncomment this section
      // forking: {
      //   url: MAINNET_RPC_URL
      // }
      allowUnlimitedContractSize: true,
    },
    localhost: {
      allowUnlimitedContractSize: true,
    },
    ropsten: {
      chainId: 3,
      url: ROPSTEN_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
  },
  solidity: {
    version: '0.8.9',
    settings: {
      optimizer: {
        enabled: true,
        runs: 2000,
      },
    },
  },
  mocha: {
    timeout: 50000,
  },
}

// TODO: import ./tasks selectively based on env var
import './tasks'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'
import 'hardhat-gas-reporter'
import 'solidity-coverage'

import dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/types'

// import '@openzeppelin/hardhat-upgrades'
dotenv.config()

const PATHS: { [x: string]: string } = {
  p0: './contracts/p0',
  default: './contracts',
}

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
      gas: 999999999999,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      gas: 999999999999,
      blockGasLimit: 0x1fffffffffffff,
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
  paths: {
    sources: process.env.NODE_ENV_PROTO ? PATHS[process.env.NODE_ENV_PROTO] : PATHS.default,
  },
  mocha: {
    timeout: 50000,
  },
}

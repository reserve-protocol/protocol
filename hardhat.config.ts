import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'
import 'hardhat-contract-sizer'
//import 'hardhat-gas-reporter'
import 'solidity-coverage'

import dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/types'

dotenv.config()

if (process.env.TASKS === 'true') {
  require('./tasks')
}

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || process.env.ALCHEMY_MAINNET_RPC_URL || ''
const ROPSTEN_RPC_URL = process.env.ROPSTEN_RPC_URL || ''
const MNEMONIC = process.env.MNEMONIC || ''

const src_dir = process.env.PROTO ? './contracts/' + process.env.PROTO : './contracts'
const settings = process.env.NO_OPT ? {} : { optimizer: { enabled: true, runs: 2000 } }
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
    settings,
    debug: {
      // How to treat revert (and require) reason strings. Settings are
      // "default", "strip", "debug" and "verboseDebug".
      // "default" does not inject compiler-generated revert strings and keeps user-supplied ones.
      // "strip" removes all revert strings (if possible, i.e. if literals are used) keeping side-effects
      // "debug" injects strings for compiler-generated internal reverts, implemented for ABI encoders V1 and V2 for now.
      // "verboseDebug" even appends further information to user-supplied revert strings (not yet implemented)
      revertStrings: 'default',
      // revertStrings: 'debug',
    },
  },
  paths: {
    sources: src_dir,
  },
  mocha: {
    timeout: 200000,
  },
  contractSizer: {
    alphaSort: false,
    disambiguatePaths: false,
    runOnCompile: false,
    strict: false,
    only: [],
    except: ['Adapter', 'Extension'],
  },
}

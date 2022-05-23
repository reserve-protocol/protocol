import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@openzeppelin/hardhat-upgrades'
import '@typechain/hardhat'
import 'hardhat-contract-sizer'
import 'hardhat-gas-reporter'
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
const TIMEOUT = !!process.env.SLOW ? 3_000_000 : 300_000

const src_dir = process.env.PROTO ? './contracts/' + process.env.PROTO : './contracts'
const settings = process.env.NO_OPT ? {} : { optimizer: { enabled: true, runs: 2000 } }

let config: any = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      forking: {
        url: MAINNET_RPC_URL,
        blockNumber: 14393847,
        enabled: !!process.env.FORK,
      },
      gas: 0x1ffffffff,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      gas: 0x1ffffffff,
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
    compilers: [
      {
        version: '0.8.9',
        settings,
        debug: {
          // How to treat revert (and require) reason strings.
          // "default" does not inject compiler-generated revert strings and keeps user-supplied ones
          // "strip" removes all revert strings (if literals are used) keeping side-effects
          // "debug" injects strings for compiler-generated internal reverts
          revertStrings: 'default',
        },
      },
    ],
    overrides: {
      'contracts/p1/aux/Deployer.sol': {
        version: '0.8.9',
        settings: process.env.NO_OPT ? {} : { optimizer: { enabled: true, runs: 10 } },
      },
      'contracts/p1/RToken.sol': {
        version: '0.8.9',
        settings: process.env.NO_OPT ? {} : { optimizer: { enabled: true, runs: 400 } },
      },
      'contracts/p1/StRSRVotes.sol': {
        version: '0.8.9',
        settings: process.env.NO_OPT ? {} : { optimizer: { enabled: true, runs: 1000 } },
      },
    },
  },
  paths: {
    sources: src_dir,
  },
  mocha: {
    timeout: TIMEOUT,
    slow: 1000,
  },
  contractSizer: {
    alphaSort: false,
    disambiguatePaths: false,
    runOnCompile: false,
    strict: false,
    only: [],
    except: ['Extension'],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
  },
}

if (process.env.ONLY_FAST) {
  config.mocha.grep = '/#fast/'
  config.mocha.slow = 200
  config.gasReporter.enabled = false
}

if (process.env.JOBS) {
  config.mocha.parallel = true
  config.mocha.jobs = process.env.JOBS
}

export default <HardhatUserConfig>config

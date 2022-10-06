import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@openzeppelin/hardhat-upgrades'
import '@typechain/hardhat'
import 'hardhat-contract-sizer'
import 'hardhat-gas-reporter'
import 'solidity-coverage'
import '@withtally/tally-publish-dao'

import dotenv from 'dotenv'
import { HardhatUserConfig } from 'hardhat/types'
import forkBlockNumber from './test/integration/fork-block-numbers'

dotenv.config()

// eslint-disable-next-line node/no-missing-require
require('./tasks')

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || process.env.ALCHEMY_MAINNET_RPC_URL || ''
const ROPSTEN_RPC_URL = process.env.ROPSTEN_RPC_URL || ''
const GOERLI_RPC_URL = process.env.GOERLI_RPC_URL || ''
const MNEMONIC = process.env.MNEMONIC || ''
const TIMEOUT = process.env.SLOW ? 3_000_000 : 300_000

const src_dir = process.env.PROTO ? './contracts/' + process.env.PROTO : './contracts'
const settings = process.env.NO_OPT ? {} : { optimizer: { enabled: true, runs: 200 } }

const config: any = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      forking: {
        url: MAINNET_RPC_URL,
        blockNumber: process.env.MAINNET_BLOCK
          ? Number(process.env.MAINNET_BLOCK)
          : forkBlockNumber['default'],
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
    goerli: {
      chainId: 5,
      url: GOERLI_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    mainnet: {
      chainId: 1,
      url: MAINNET_RPC_URL,
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
      {
        version: '0.6.12',
        settings: { optimizer: { enabled: false } },
      },
      {
        version: '0.4.24',
        settings: { optimizer: { enabled: false } },
      },
    ],
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
    enabled: !!process.env.REPORT_GAS,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
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

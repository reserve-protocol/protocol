import 'tsconfig-paths/register'
import '@nomicfoundation/hardhat-toolbox'
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'
import '@openzeppelin/hardhat-upgrades'
import '@typechain/hardhat'
import 'hardhat-contract-sizer'
import 'hardhat-gas-reporter'
import 'solidity-coverage'

import { useEnv } from '#/utils/env'
import { HardhatUserConfig } from 'hardhat/types'
import forkBlockNumber from '#/test/integration/fork-block-numbers'

// eslint-disable-next-line node/no-missing-require
require('#/tasks')

const MAINNET_RPC_URL = useEnv(['MAINNET_RPC_URL', 'ALCHEMY_MAINNET_RPC_URL'])
const GOERLI_RPC_URL = useEnv('GOERLI_RPC_URL')
const MNEMONIC = useEnv('MNEMONIC') ?? 'test test test test test test test test test test test junk'
const TIMEOUT = useEnv('SLOW') ? 6_000_000 : 600_000

const src_dir = `./contracts/${useEnv('PROTO')}`
const settings = useEnv('NO_OPT') ? {} : { optimizer: { enabled: true, runs: 200 } }

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      // network for tests/in-process stuff
      forking: useEnv('FORK')
        ? {
            url: MAINNET_RPC_URL,
            blockNumber: Number(useEnv('MAINNET_BLOCK', forkBlockNumber['default'].toString())),
          }
        : undefined,
      gas: 0x1ffffffff,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      // network for long-lived mainnet forks
      chainId: 31337,
      url: 'http://127.0.0.1:8546',
      gas: 0x1ffffffff,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
    },
    // anvil: {
    //   url: 'http://127.0.0.1:8545/',
    // },
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
      // gasPrice: 30_000_000_000,
      gasMultiplier: 1.05, // 5% buffer; seen failures on RToken deployment and asset refreshes otherwise
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.17',
        settings,
      },
      {
        version: '0.6.12',
        settings,
      },
      {
        version: '0.4.24',
        settings,
      },
    ],
    overrides: {
      'contracts/plugins/assets/convex/vendor/ConvexStakingWrapper.sol': {
        version: '0.6.12',
        settings: { optimizer: { enabled: true, runs: 1 } }, // to fit ContexStakingWrapper
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
    enabled: !!useEnv('REPORT_GAS'),
  },
  etherscan: {
    apiKey: useEnv('ETHERSCAN_API_KEY'),
  },
}

if (useEnv('ONLY_FAST')) {
  config.mocha!.grep = '/#fast/'
  config.mocha!.slow = 200
  config.gasReporter!.enabled = false
}

if (useEnv('JOBS')) {
  config.mocha!.parallel = true
  config.mocha!.jobs = Number(useEnv('JOBS'))
}

export default config

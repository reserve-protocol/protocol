import 'tsconfig-paths/register'
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomicfoundation/hardhat-verify'
import '@nomiclabs/hardhat-ethers'
import '@openzeppelin/hardhat-upgrades'
import '@typechain/hardhat'
import 'hardhat-contract-sizer'
import 'hardhat-gas-reporter'
import 'solidity-coverage'
// import * as tenderly from '@tenderly/hardhat-tenderly'

import { useEnv } from '#/utils/env'
import { forkRpcs, Network } from '#/utils/fork'
import { HardhatUserConfig } from 'hardhat/types'
import forkBlockNumber from '#/test/integration/fork-block-numbers'

// eslint-disable-next-line node/no-missing-require
require('#/tasks')

// tenderly.setup()

const MAINNET_RPC_URL = useEnv(['MAINNET_RPC_URL', 'ALCHEMY_MAINNET_RPC_URL'])
const TENDERLY_RPC_URL = useEnv('TENDERLY_RPC_URL')
const GOERLI_RPC_URL = useEnv('GOERLI_RPC_URL')
const BASE_GOERLI_RPC_URL = useEnv('BASE_GOERLI_RPC_URL')
const BASE_RPC_URL = useEnv('BASE_RPC_URL')
const ARBITRUM_SEPOLIA_RPC_URL = useEnv('ARBITRUM_SEPOLIA_RPC_URL')
const ARBITRUM_RPC_URL = useEnv('ARBITRUM_RPC_URL')
const MNEMONIC = useEnv('MNEMONIC') || 'test test test test test test test test test test test junk'
const TIMEOUT = useEnv('SLOW') ? 6_000_000 : 600_000

const src_dir = `./contracts/${useEnv('PROTO')}`
const settings = useEnv('NO_OPT') ? {} : { optimizer: { enabled: true, runs: 200 } }

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      forking: useEnv('FORK')
        ? (() => {
            const forkBlock = useEnv(`FORK_BLOCK`, forkBlockNumber['default'].toString())
            const forking: { url: string; blockNumber?: number } = {
              url: forkRpcs[useEnv('FORK_NETWORK', 'mainnet') as Network],
            }
            // Only add blockNumber if it's not "latest"
            if (forkBlock !== 'latest') {
              forking.blockNumber = Number(forkBlock)
            }
            return forking
          })()
        : undefined,
      gas: 0x1ffffffff,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
      accounts: {
        mnemonic: MNEMONIC,
        accountsBalance: '10000000000000000000000000000',
      },
      gasMultiplier: 2,
      initialBaseFeePerGas: 0, // Prevents gas fee issues
    },
    localhost: {
      // network for long-lived mainnet forks
      chainId: 31337,
      url: 'http://127.0.0.1:8546',
      gas: 0x1ffffffff,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
      timeout: 0,
    },
    goerli: {
      chainId: 5,
      url: GOERLI_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    'base-goerli': {
      chainId: 84531,
      url: BASE_GOERLI_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    base: {
      chainId: 8453,
      url: BASE_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    bsc: {
      chainId: 56,
      url: 'https://bsc-rpc.publicnode.com',
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
      gasMultiplier: 2, // 100% buffer; seen failures on RToken deployment and asset refreshes otherwise
    },
    arbitrum: {
      chainId: 42161,
      url: ARBITRUM_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
      gasMultiplier: 2, // 100% buffer; seen failures on RToken deployment and asset refreshes otherwise
    },
    'arbitrum-sepolia': {
      chainId: 421614,
      url: ARBITRUM_SEPOLIA_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    tenderly: {
      chainId: 3,
      url: TENDERLY_RPC_URL,
      accounts: {
        mnemonic: MNEMONIC,
      },
      // gasPrice: 10_000_000_000,
      gasMultiplier: 2, // 100% buffer; seen failures on RToken deployment and asset refreshes otherwise
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.19',
        settings,
      },
      {
        version: '0.6.12',
        settings,
      },
    ],
    overrides: {
      'contracts/plugins/assets/convex/vendor/ConvexStakingWrapper.sol': {
        version: '0.6.12',
        settings: { optimizer: { enabled: true, runs: 1 } }, // contract over-size
      },
    },
  },

  paths: {
    sources: src_dir,
  },
  mocha: {
    timeout: TIMEOUT,
    slow: 1000,
    retries: 3,
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
    enabled: true,
    apiKey: useEnv('ETHERSCAN_API_KEY'),
  },
  // tenderly: {
  //   // see https://github.com/Tenderly/hardhat-tenderly/tree/master/packages/tenderly-hardhat for details
  //   username: 'Reserveslug', // org name
  //   project: 'testnet', // project name
  //   privateVerification: false, // must be false to verify contracts on a testnet or devnet
  // },
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

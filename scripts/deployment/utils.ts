import hre, { tenderly } from 'hardhat'
import * as readline from 'readline'
import axios from 'axios'
import { exec } from 'child_process'
import { BigNumber } from 'ethers'
import { bn, fp } from '../../common/numbers'
import { IComponents, baseL2Chains } from '../../common/configuration'
import { isValidContract } from '../../common/blockchain-utils'
import { IDeployments } from './common'
import { useEnv } from '#/utils/env'

export const priceTimeout = bn('604800') // 1 week

export const revenueHiding = fp('1e-6') // 1 part in a million

export const combinedError = (x: BigNumber, y: BigNumber): BigNumber => {
  return fp('1').add(x).mul(fp('1').add(y)).div(fp('1')).sub(fp('1'))
}

export const validatePrerequisites = async (deployments: IDeployments) => {
  // Check prerequisites properly defined
  if (
    !deployments.prerequisites.GNOSIS_EASY_AUCTION ||
    !deployments.prerequisites.RSR ||
    !deployments.prerequisites.RSR_FEED
  ) {
    throw new Error(`Missing pre-requisite addresses in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.prerequisites.RSR))) {
    throw new Error(`RSR contract not found in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.prerequisites.RSR_FEED))) {
    throw new Error(`RSR_FEED contract not found in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.prerequisites.GNOSIS_EASY_AUCTION))) {
    throw new Error(`GNOSIS_EASY_AUCTION contract not found in network ${hre.network.name}`)
  }
}

// Validate components
const validComponents = async (components: IComponents): Promise<boolean> => {
  let c: keyof typeof components
  let allValid = true
  for (c in components) {
    if (!(await isValidContract(hre, components[c]))) {
      allValid = false
    }
  }
  return allValid
}

export const validateImplementations = async (deployments: IDeployments) => {
  // Check implementations
  if (
    !deployments.implementations.main ||
    !deployments.implementations.trading.gnosisTrade ||
    !deployments.implementations.trading.dutchTrade ||
    !deployments.implementations.components.assetRegistry ||
    !deployments.implementations.components.backingManager ||
    !deployments.implementations.components.basketHandler ||
    !deployments.implementations.components.broker ||
    !deployments.implementations.components.distributor ||
    !deployments.implementations.components.furnace ||
    !deployments.implementations.components.rTokenTrader ||
    !deployments.implementations.components.rsrTrader ||
    !deployments.implementations.components.rToken ||
    !deployments.implementations.components.stRSR
  ) {
    throw new Error(`Missing deployed implementations in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.implementations.main))) {
    throw new Error(`Main implementation not found in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.implementations.trading.gnosisTrade))) {
    throw new Error(`GnosisTrade implementation not found in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.implementations.trading.dutchTrade))) {
    throw new Error(`DutchTrade implementation not found in network ${hre.network.name}`)
  } else if (!(await validComponents(deployments.implementations.components))) {
    throw new Error(`Component implementation(s) not found in network ${hre.network.name}`)
  }
}

export async function sh(cmd: string) {
  return new Promise(function (resolve, reject) {
    const execProcess = exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve({ stdout, stderr })
      }
    })

    execProcess.stdout?.pipe(process.stdout)
  })
}

export async function verifyContract(
  chainId: number,
  address: string | undefined,
  constructorArguments: unknown[],
  contract: string,
  libraries?: { [key: string]: string }
) {
  console.time(`Verifying ${contract}`)
  console.log(`Verifying ${contract}`)

  if (hre.network.name == 'tenderly') {
    await tenderly.verify({
      name: contract,
      address: address!,
      libraries,
    })
  } else {
    // Sleep 0.5s to not overwhelm API
    await new Promise((r) => setTimeout(r, 500))

    const ETHERSCAN_API_KEY = useEnv('ETHERSCAN_API_KEY')

    let url: string
    if (baseL2Chains.includes(hre.network.name)) {
      // Base L2
      url = `${getBasescanURL(
        chainId
      )}/?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_API_KEY}`
    } else {
      // Ethereum
      url = `${getEtherscanBaseURL(
        chainId,
        true
      )}/api/?module=contract&action=getsourcecode&address=${address}&apikey=${ETHERSCAN_API_KEY}`
    }

    // Check to see if already verified
    const { data, status } = await axios.get(url, { headers: { Accept: 'application/json' } })
    if (status != 200 || data['status'] != '1') {
      throw new Error("Can't communicate with Etherscan API")
    }

    // Only run verification script if not verified
    if (data['result'][0]['SourceCode']?.length > 0) {
      console.log('Already verified. Continuing')
    } else {
      console.log('Running new verification')
      try {
        await hre.run('verify:verify', {
          address,
          constructorArguments,
          contract,
          libraries,
        })
      } catch (e) {
        console.log(
          `IMPORTANT: failed to verify ${contract}. 
        ${getEtherscanBaseURL(chainId)}/address/${address}#code`,
          e
        )
      }
    }
    console.timeEnd(`Verifying ${contract}`)
  }
}

export const getEtherscanBaseURL = (chainId: number, api = false) => {
  let prefix: string
  if (api) prefix = chainId == 1 ? 'api.' : `api-${hre.network.name}.`
  else prefix = chainId == 1 ? '' : `${hre.network.name}.`
  return `https://${prefix}etherscan.io`
}

export const getBasescanURL = (chainId: number) => {
  // For Base, get URL from HH config
  const chainConfig = hre.config.etherscan.customChains.find((chain) => chain.chainId == chainId)
  if (!chainConfig || !chainConfig.urls) {
    throw new Error(`Missing custom chain configuration for ${hre.network.name}`)
  }
  return `${chainConfig.urls.apiURL}`
}

export const getEmptyDeployment = (): IDeployments => {
  return {
    prerequisites: {
      RSR: '',
      RSR_FEED: '',
      GNOSIS_EASY_AUCTION: '',
    },
    tradingLib: '',
    basketLib: '',
    actFacet: '',
    readFacet: '',
    facade: '',
    facadeWriteLib: '',
    cvxMiningLib: '',
    facadeWrite: '',
    deployer: '',
    rsrAsset: '',
    implementations: {
      main: '',
      trading: { gnosisTrade: '', dutchTrade: '' },
      components: {
        assetRegistry: '',
        backingManager: '',
        basketHandler: '',
        broker: '',
        distributor: '',
        furnace: '',
        rsrTrader: '',
        rTokenTrader: '',
        rToken: '',
        stRSR: '',
      },
    },
  }
}

export const prompt = async (query: string): Promise<string> => {
  if (!useEnv('SKIP_PROMPT')) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise<string>((resolve) =>
      rl.question(query, (ans) => {
        rl.close()
        resolve(ans)
        return ans
      })
    )
  } else {
    return ''
  }
}

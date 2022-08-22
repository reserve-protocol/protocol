import fs from 'fs'
import hre from 'hardhat'
import { BigNumber } from 'ethers'
import { bn } from '../../common/numbers'
import { ITokens, IComponents, IImplementations } from '../../common/configuration'
import { isValidContract } from '../../common/blockchain-utils'

export interface IPrerequisites {
  RSR: string
  RSR_FEED: string
  GNOSIS_EASY_AUCTION: string
}

export interface IDeployments {
  prerequisites: IPrerequisites
  rewardableLib: string
  oracleLib: string
  tradingLib: string
  rTokenPricingLib: string
  facade: string
  facadeWriteLib: string
  facadeWrite: string
  deployer: string
  rsrAsset: string
  implementations: IImplementations
}

export interface IAssetCollDeployments {
  assets: ITokens
  collateral: ITokens
}

export interface IRTokenDeployments {
  facadeWrite: string
  main: string
  components: IComponents
  rTokenAsset: string
  governance: string
  timelock: string
}

const tempFileSuffix = '-tmp-deployments.json'
const tempAssetCollFileSuffix = '-tmp-assets-collateral.json'

export const getOracleTimeout = (chainId: number): BigNumber => {
  return bn(chainId == 1 ? '86400' : '4294967296') // long timeout on testnets
}

export const getDeploymentFilename = (chainId: number): string => {
  return `./${chainId}${tempFileSuffix}`
}

export const getAssetCollDeploymentFilename = (chainId: number): string => {
  return `./${chainId}${tempAssetCollFileSuffix}`
}

export const getRTokenDeploymentFilename = (chainId: number, name: string): string => {
  return `./${chainId}-${name}${tempFileSuffix}`
}

export const fileExists = (file: string): boolean => {
  try {
    fs.accessSync(file, fs.constants.F_OK)
    return true
  } catch (e) {
    return false
  }
}

export const getDeploymentFile = (
  path: string
): IDeployments | IAssetCollDeployments | IRTokenDeployments => {
  if (!fileExists(path)) {
    throw new Error(`Deployment file ${path} does not exist. Maybe contracts weren't deployed?`)
  }
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (e) {
    throw new Error(`Failed to read ${path}. Maybe the file is badly generated?`)
  }
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
    !deployments.implementations.trade ||
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
  } else if (!(await isValidContract(hre, deployments.implementations.trade))) {
    throw new Error(`Trade implementation not found in network ${hre.network.name}`)
  } else if (!(await validComponents(deployments.implementations.components))) {
    throw new Error(`Component implementation(s) not found in network ${hre.network.name}`)
  }
}

import fs from 'fs'
import { ITokens, IComponents, IImplementations } from '../../common/configuration'

// This file is intended to have minimal imports, so that it can be used from tasks if necessary

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

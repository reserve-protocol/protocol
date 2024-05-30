import fs from 'fs'
import { ITokens, IComponents, IImplementations, IPools } from '../../common/configuration'

// This file is intended to have minimal imports, so that it can be used from tasks if necessary

export interface IPrerequisites {
  RSR: string
  RSR_FEED: string
  GNOSIS_EASY_AUCTION: string
}

export interface IFacets {
  actFacet: string
  readFacet: string
  // individiual function facets
  maxIssuableFacet: string
}

export interface IDeployments {
  prerequisites: IPrerequisites
  tradingLib: string
  basketLib: string
  facade: string
  facets: IFacets
  facadeWriteLib: string
  facadeWrite: string
  deployer: string
  rsrAsset: string
  implementations: IImplementations
}

export interface IAssetCollDeployments {
  assets: ITokens
  collateral: ITokens & IPools
  erc20s: ITokens & IPools
}

export interface IRTokenDeployments {
  facadeWrite: string
  main: string
  components: IComponents
  rTokenAsset: string
  governance: string
  timelock: string
}

const pathToFolder = './scripts/addresses/'
const tempFileSuffix = '-tmp-deployments.json'
const tempAssetCollFileSuffix = '-tmp-assets-collateral.json'

export const getDeploymentFilename = (chainId: number, version?: string): string => {
  return `${pathToFolder}${version ? `/${version}/` : ''}${chainId}${tempFileSuffix}`
}

export const getAssetCollDeploymentFilename = (chainId: number, version?: string): string => {
  return `${pathToFolder}${version ? `/${version}/` : ''}${chainId}${tempAssetCollFileSuffix}`
}

export const getRTokenDeploymentFilename = (chainId: number, name: string): string => {
  return `${pathToFolder}${chainId}-${name}${tempFileSuffix}`
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

export const writeComponentDeployment = (
  deployments: IDeployments,
  deploymentFilename: string,
  name: string,
  implAddr: string,
  logDesc: string,
  prevAddr?: string
) => {
  const field = name as keyof typeof deployments.implementations.components

  // Write temporary deployments file for component
  deployments.implementations.components[field] = implAddr
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`  ${logDesc} Implementation: ${implAddr} ${prevAddr == implAddr ? '- SKIPPED' : ''}`)
}

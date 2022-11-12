import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  IDeployments,
  fileExists,
} from '../../deployment/common'
import { getCurrentPrice, getOracleTimeout } from '../../deployment/utils'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Assets to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  const phase1Deployment = <IDeployments>getDeploymentFile(phase1File)

  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const deployedAssets: string[] = []

  /********  Deploy StkAAVE Asset **************************/
  const { asset: stkAAVEAsset } = await hre.run('deploy-asset', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.AAVE)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.AAVE,
    tokenAddress: networkConfig[chainId].tokens.stkAAVE,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.assets.stkAAVE = stkAAVEAsset
  deployedAssets.push(stkAAVEAsset.toString())

  /********  Deploy Comp Asset **************************/
  const { asset: compAsset } = await hre.run('deploy-asset', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.COMP)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.COMP,
    tokenAddress: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.assets.COMP = compAsset
  deployedAssets.push(compAsset.toString())

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed assets to ${hre.network.name} (${chainId}):
    New deployments: ${deployedAssets}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

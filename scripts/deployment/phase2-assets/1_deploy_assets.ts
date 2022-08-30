import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  IDeployments,
  fileExists,
} from '../../deployment/common'
import { getOracleTimeout } from '../../deployment/utils'

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
    priceFeed: networkConfig[chainId].chainlinkFeeds.AAVE,
    tokenAddress: networkConfig[chainId].tokens.stkAAVE,
    rewardToken: ZERO_ADDRESS,
    tradingValMin: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingValMax: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingAmtMin: fp(chainId == 1 ? '10' : '1').toString(), // 10 StkAAVE
    tradingAmtMax: fp(chainId == 1 ? '1e4' : '1e9').toString(), // 10,000 StkAAVE
    oracleTimeout: getOracleTimeout(chainId).toString(),
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.assets.stkAAVE = stkAAVEAsset
  deployedAssets.push(stkAAVEAsset.toString())

  /********  Deploy Comp Asset **************************/
  const { asset: compAsset } = await hre.run('deploy-asset', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.COMP,
    tokenAddress: networkConfig[chainId].tokens.COMP,
    rewardToken: ZERO_ADDRESS,
    tradingValMin: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingValMax: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingAmtMin: fp(chainId == 1 ? '20' : '1').toString(), // // 20 COMP
    tradingAmtMax: fp(chainId == 1 ? '2e4' : '1e9').toString(), // 20,000 COMP
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

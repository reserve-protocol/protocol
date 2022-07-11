import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { bn, fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../deployment_utils'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Assets to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  let deployedAssets: string[] = []

  /********  Deploy StkAAVE Asset **************************/
  const { asset: stkAAVEAsset } = await hre.run('deploy-asset', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.AAVE,
    tokenAddress: networkConfig[chainId].tokens.stkAAVE,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    maxOracleTimeout: bn('86400').toString(), // 1 day
  })

  assetCollDeployments.assets.stkAAVE = stkAAVEAsset
  deployedAssets.push(stkAAVEAsset.toString())

  /********  Deploy Comp Asset **************************/
  const { asset: compAsset } = await hre.run('deploy-asset', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.COMP,
    tokenAddress: networkConfig[chainId].tokens.COMP,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    maxOracleTimeout: bn('86400').toString(), // 1 day
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

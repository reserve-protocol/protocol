import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { fp } from '../../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  fileExists,
} from '../../../deployment/common'
import { KingAsset } from '../../../../typechain'
import { priceTimeout } from '../../../deployment/utils'
import { ETH_ORACLE_TIMEOUT } from '../../../../test/plugins/individual-collateral/etherfi/constants'

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying KING asset to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const deployedAssets: string[] = []

  /********  Deploy KING asset **************************/

  const KingAssetFactory = await hre.ethers.getContractFactory('KingAsset')
  const kingAsset = <KingAsset>await KingAssetFactory.connect(deployer).deploy(
    priceTimeout,
    networkConfig[chainId].chainlinkFeeds.ETH!,
    fp('0.04').toString(), // 4% Oracle error - TODO: review
    networkConfig[chainId].tokens.KING!,
    fp('1e6').toString(), // $1m
    ETH_ORACLE_TIMEOUT
  )
  await kingAsset.deployed()
  await (await kingAsset.refresh({ gasLimit: 3_000_000 })).wait()

  assetCollDeployments.assets.KING = kingAsset.address
  assetCollDeployments.erc20s.KING = networkConfig[chainId].tokens.KING
  deployedAssets.push(kingAsset.address)

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed KING asset to ${hre.network.name} (${chainId}):
    New deployments: ${deployedAssets}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

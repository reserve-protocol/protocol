import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { priceTimeout, oracleTimeout, verifyContract, combinedError } from '../../deployment/utils'

let deployments: IAssetCollDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********  Verify Rocket-Pool ETH - rETH  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.rETH,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: combinedError(fp('0.005'), fp('0.02')).toString(), // 0.5% & 2%,
        erc20: networkConfig[chainId].tokens.rETH,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.15').toString(), // 15%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4'), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.rETH, // refPerTokChainlinkFeed
      oracleTimeout(chainId, '86400').toString(), // refPerTokChainlinkTimeout
    ],
    'contracts/plugins/assets/rocket-eth/RethCollateral.sol:RethCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

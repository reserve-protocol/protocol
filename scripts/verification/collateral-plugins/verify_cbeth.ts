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

  /********  Verify Coinbase staked ETH - CBETH  **************************/
  const oracleError = combinedError(fp('0.005'), fp('0.02')) // 0.5% & 2%
  await verifyContract(
    chainId,
    deployments.collateral.cbETH,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: oracleError.toString(), // 0.5% & 2%,
        erc20: networkConfig[chainId].tokens.cbETH!,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(oracleError).toString(), // 15%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4'), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.cbETH!, // refPerTokChainlinkFeed
      oracleTimeout(chainId, '86400').toString(), // refPerTokChainlinkTimeout
    ],
    'contracts/plugins/assets/cbeth/CBETHCollateral.sol:CBEthCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

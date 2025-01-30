import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { priceTimeout, verifyContract } from '../../deployment/utils'
import {
  BASE_PRICE_FEEDS,
  BASE_ORACLE_ERROR,
  BASE_FEEDS_TIMEOUT,
} from '../../../test/plugins/individual-collateral/origin/constants'

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

  /********  Verify Origin ETH - wsuperOETHb  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.wsuperOETHb,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: BASE_PRICE_FEEDS.wsuperOETHb_ETH, // ignored
        oracleError: BASE_ORACLE_ERROR.toString(), // 0.15%
        erc20: networkConfig[chainId].tokens.wsuperOETHb,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: 1, // ignored in practice
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(BASE_ORACLE_ERROR).toString(),
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4').toString(), // revenueHiding = 0.01%
      BASE_PRICE_FEEDS.wsuperOETHb_ETH, // targetPerTokChainlinkFeed
      BASE_PRICE_FEEDS.ETH_USD, // uoaPerTargetChainlinkFeed
      BASE_FEEDS_TIMEOUT.ETH_USD, // uoaPerTarget timeout
    ],
    'contracts/plugins/assets/origin/OETHCollateralL2Base.sol:OETHCollateralL2Base'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

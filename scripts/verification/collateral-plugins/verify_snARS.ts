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

  /********  Verify snARS  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.snARS,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.snARS,
        oracleError: fp('0.01').toString(), // 1%
        erc20: networkConfig[chainId].tokens.snARS,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '3600', // 1 hr
        targetName: hre.ethers.utils.formatBytes32String('ARS'),
        defaultThreshold: fp('0.02').toString(), // 2%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      '0', // revenueHiding = 0
    ],
    'contracts/plugins/assets/num/SnARSFiatCollateral.sol:SnARSFiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

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
import { POT } from '../../../test/plugins/individual-collateral/dsr/constants'

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

  /********  Verify sDAI  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.sDAI,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI,
        oracleError: fp('0.0025').toString(), // 0.25%
        erc20: networkConfig[chainId].tokens.sDAI,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '3600', // 1 hr
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.0125').toString(), // 1.25%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      bn(0),
      POT,
    ],
    'contracts/plugins/assets/dsr/SDaiCollateral.sol:SDaiCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

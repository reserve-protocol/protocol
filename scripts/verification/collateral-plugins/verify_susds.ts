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
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
} from '../../../test/plugins/individual-collateral/sky/constants'

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

  /********  Verify sUSDS  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.sUSDS,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDS,
        oracleError: ORACLE_ERROR.toString(), // 0.3%
        erc20: networkConfig[chainId].tokens.sUSDS,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: ORACLE_ERROR.add(fp('0.01')).toString(), // 1.3%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      bn(0),
    ],
    'contracts/plugins/assets/sky/SUSDSCollateral.sol:SUSDSCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

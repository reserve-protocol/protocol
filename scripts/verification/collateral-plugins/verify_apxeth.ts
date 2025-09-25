import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import {
  ETH_ORACLE_TIMEOUT,
  ETH_ORACLE_ERROR,
  DELAY_UNTIL_DEFAULT,
  APXETH_ORACLE_ERROR,
  APXETH_ORACLE_TIMEOUT,
} from '../../../test/plugins/individual-collateral/pirex-eth/constants'
import { priceTimeout, verifyContract, combinedError } from '../../deployment/utils'

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

  /********  Verify ApxETH - apxETH  **************************/
  const oracleError = combinedError(ETH_ORACLE_ERROR, APXETH_ORACLE_ERROR) // 0.5% & 1%
  await verifyContract(
    chainId,
    deployments.collateral.apxETH,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: oracleError.toString(), // 0.5% & 1%,
        erc20: networkConfig[chainId].tokens.apxETH,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: ETH_ORACLE_TIMEOUT.toString(), // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(APXETH_ORACLE_ERROR).toString(), // 3%
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(), // 72h
      },
      fp('1e-4'), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.apxETH, // targetPerTokChainlinkFeed
      APXETH_ORACLE_TIMEOUT.toString(), // targetPerTokChainlinkTimeout
    ],
    'contracts/plugins/assets/pirex-eth/ApxEthCollateral.sol:ApxEthCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

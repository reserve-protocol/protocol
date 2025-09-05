import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { priceTimeout, verifyContract, combinedError } from '../../deployment/utils'
import {
  PRICE_FEEDS,
  ORACLE_TIMEOUT,
  ORACLE_ERROR,
  DELAY_UNTIL_DEFAULT,
  OETH_ORACLE_ERROR,
  OETH_ORACLE_TIMEOUT,
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

  /********  Verify Origin ETH - OETH  **************************/
  const oracleError = combinedError(ORACLE_ERROR, OETH_ORACLE_ERROR)
  await verifyContract(
    Number(chainId),
    deployments.collateral.wOETH,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: PRICE_FEEDS.OETH_ETH, // ETH/OETH
        oracleError: oracleError.toString(),
        erc20: networkConfig[chainId].tokens.wOETH,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: OETH_ORACLE_TIMEOUT.toString(), // 24 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(OETH_ORACLE_ERROR).toString(),
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(), // 24h
      },
      fp('1e-4'), // revenueHiding = 0.01%
      PRICE_FEEDS.ETH_USD, // uoaPerTargetChainlinkFeed
      ORACLE_TIMEOUT, // uoaPerTarget timeout
    ],
    'contracts/plugins/assets/origin/OETHCollateral.sol:OETHCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

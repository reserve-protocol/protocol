import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import {
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../test/plugins/individual-collateral/tokemak/constants'

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

  /********  Verify autoETH COllateral  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.autoETH,
    [
      {
        priceTimeout: PRICE_TIMEOUT.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.WETH,
        oracleError: ORACLE_ERROR.toString(),
        erc20: networkConfig[chainId].tokens.autoETH,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: ORACLE_TIMEOUT.toString(),
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.01').add(ORACLE_ERROR).toString(),
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      },
      fp('1e-6').toString(),
    ],
    'contracts/plugins/assets/tokemak/AutopoolCollateral.sol:AutopoolCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

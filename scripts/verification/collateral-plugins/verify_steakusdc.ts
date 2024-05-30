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
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDC_USD_FEED,
  PRICE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../test/plugins/individual-collateral/meta-morpho/constants'
import { verifyContract } from '../../deployment/utils'

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

  /********  Verify steakUSDC  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.steakUSDC,
    [
      {
        priceTimeout: PRICE_TIMEOUT.toString(),
        chainlinkFeed: USDC_USD_FEED,
        oracleError: USDC_ORACLE_ERROR.toString(),
        erc20: networkConfig[chainId].tokens.steakUSDC,
        maxTradeVolume: fp('1e6').toString(),
        oracleTimeout: USDC_ORACLE_TIMEOUT.toString(),
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: USDC_ORACLE_ERROR.add(fp('0.01')).toString(), // +1% buffer rule
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      },
      fp('1e-4'), // can have small drawdowns
    ],
    'contracts/plugins/assets/meta-morpho/MetaMorphoFiatCollateral.sol:MetaMorphoFiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

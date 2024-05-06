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
  ETH_USD_FEED,
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

  /********  Verify Re7WETH  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.Re7WETH,
    [
      {
        priceTimeout: PRICE_TIMEOUT.toString(),
        chainlinkFeed: ETH_USD_FEED,
        oracleError: ETH_ORACLE_ERROR.toString(),
        erc20: networkConfig[chainId].tokens.Re7WETH,
        maxTradeVolume: fp('1e6').toString(),
        oracleTimeout: ETH_ORACLE_TIMEOUT.toString(),
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: '0', // WETH
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      },
      fp('1e-3'), // can have large drawdowns
    ],
    'contracts/plugins/assets/meta-morpho/MetaMorphoSelfReferentialCollateral.sol:MetaMorphoSelfReferentialCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

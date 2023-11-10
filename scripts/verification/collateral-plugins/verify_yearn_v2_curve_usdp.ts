import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { priceTimeout, oracleTimeout, verifyContract } from '../../deployment/utils'
import { YVUSDP_LP_TOKEN } from '../../../test/plugins/individual-collateral/yearnv2/constants'

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

  /********  Verify yvCurveUSDPcrvUSD  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.yvCurveUSDPcrvUSD,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDP, // not used but can't be empty
        oracleError: fp('0.0025').toString(), // not used but can't be empty
        erc20: networkConfig[chainId].tokens.yvCurveUSDPcrvUSD,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: oracleTimeout(chainId, bn('86400')).toString(), // 24hr -- max of all oracleTimeouts
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.02').toString(), // 2% = max oracleError + 1%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-3').toString(), // revenueHiding = 0.1%, high for Yearn to tolerate small strategy losses
      {
        nTokens: '2',
        curvePool: YVUSDP_LP_TOKEN,
        poolType: '0',
        feeds: [
          networkConfig[chainId].chainlinkFeeds.USDP,
          networkConfig[chainId].chainlinkFeeds.crvUSD,
        ],
        oracleTimeouts: [
          oracleTimeout(chainId, '3600').toString(),
          oracleTimeout(chainId, '86400').toString(),
        ],
        oracleErrors: [fp('0.01').toString(), fp('0.005').toString()],
        lpToken: YVUSDP_LP_TOKEN,
      },
    ],
    'contracts/plugins/assets/yearnv2/YearnV2CurveFiatCollateral.sol:YearnV2CurveFiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

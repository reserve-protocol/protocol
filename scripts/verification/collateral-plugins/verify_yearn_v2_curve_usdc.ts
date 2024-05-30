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
  PRICE_PER_SHARE_HELPER,
  YVUSDC_LP_TOKEN,
} from '../../../test/plugins/individual-collateral/yearnv2/constants'

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

  /********  Verify yvCurveUSDCcrvUSD  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.yvCurveUSDCcrvUSD,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC, // not used but can't be empty
        oracleError: fp('0.0025').toString(), // not used but can't be empty
        erc20: networkConfig[chainId].tokens.yvCurveUSDCcrvUSD,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '86400', // 24hr -- max of all oracleTimeouts
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.015').toString(), // 1.5% = max oracleError + 1%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-6').toString(), // revenueHiding = 0.0001%, low since underlying curve pool should be up-only
      {
        nTokens: '2',
        curvePool: YVUSDC_LP_TOKEN,
        poolType: '0',
        feeds: [
          [networkConfig[chainId].chainlinkFeeds.USDC],
          [networkConfig[chainId].chainlinkFeeds.crvUSD],
        ],
        oracleTimeouts: [['86400'], ['86400']],
        oracleErrors: [[fp('0.0025').toString()], [fp('0.005').toString()]],
        lpToken: YVUSDC_LP_TOKEN,
      },
      PRICE_PER_SHARE_HELPER,
    ],
    'contracts/plugins/assets/yearnv2/YearnV2CurveFiatCollateral.sol:YearnV2CurveFiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

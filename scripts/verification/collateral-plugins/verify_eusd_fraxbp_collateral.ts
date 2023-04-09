import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { bn } from '../../../common/numbers'
import { ONE_ADDRESS } from '../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import { revenueHiding, oracleTimeout } from '../../deployment/utils'
import {
  CurvePoolType,
  DEFAULT_THRESHOLD,
  eUSD_FRAX_BP,
  FRAX_BP,
  FRAX_BP_TOKEN,
  FRAX_ORACLE_ERROR,
  FRAX_ORACLE_TIMEOUT,
  FRAX_USD_FEED,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  RTOKEN_DELAY_UNTIL_DEFAULT,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
} from '../../../test/plugins/individual-collateral/convex/constants'

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

  const eUSDPlugin = await ethers.getContractAt(
    'CvxStableRTokenMetapoolCollateral',
    deployments.collateral.cvxeUSDFRAXBP as string
  )

  /********  Verify eUSD/fraxBP plugin  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.cvxeUSDFRAXBP,
    [
      {
        erc20: await eUSDPlugin.erc20(),
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
        oracleError: bn('1'), // unused but cannot be zero
        oracleTimeout: bn('1'), // unused but cannot be zero
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: DEFAULT_THRESHOLD, // 2%: 1% error on FRAX oracle + 1% base defaultThreshold
        delayUntilDefault: RTOKEN_DELAY_UNTIL_DEFAULT,
      },
      revenueHiding.toString(),
      {
        nTokens: 2,
        curvePool: FRAX_BP,
        poolType: CurvePoolType.Plain,
        feeds: [[FRAX_USD_FEED], [USDC_USD_FEED]],
        oracleTimeouts: [
          [oracleTimeout(chainId, FRAX_ORACLE_TIMEOUT)],
          [oracleTimeout(chainId, USDC_ORACLE_TIMEOUT)],
        ],
        oracleErrors: [[FRAX_ORACLE_ERROR], [USDC_ORACLE_ERROR]],
        lpToken: FRAX_BP_TOKEN,
      },
      eUSD_FRAX_BP,
      DEFAULT_THRESHOLD, // 2%
    ],
    'contracts/plugins/assets/convex/CvxStableRTokenMetapoolCollateral.sol:CvxStableRTokenMetapoolCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

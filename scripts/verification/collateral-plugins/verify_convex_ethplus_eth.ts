import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { ONE_ADDRESS } from '../../../common/constants'
import { bn, fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import {
  CurvePoolType,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ETHPLUS_BP_POOL,
  ETHPLUS_BP_TOKEN,
  WETH_USD_FEED,
  WETH_ORACLE_TIMEOUT,
  WETH_ORACLE_ERROR,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
} from '../../../test/plugins/individual-collateral/curve/constants'

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

  const ethPlusETHPlugin = await ethers.getContractAt(
    'CurveAppreciatingRTokenSelfReferentialCollateral',
    deployments.collateral.cvxETHPlusETH as string
  )

  /********  Verify ConvexStakingWrapper  **************************/

  await verifyContract(
    chainId,
    await ethPlusETHPlugin.erc20(),
    [],
    'contracts/plugins/assets/curve/cvx/vendor/ConvexStakingWrapper.sol:ConvexStakingWrapper'
  )

  /********  Verify eUSD/fraxBP plugin  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.cvxETHPlusETH,
    [
      {
        erc20: await ethPlusETHPlugin.erc20(),
        targetName: ethers.utils.formatBytes32String('ETH'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS,
        oracleError: bn('1'),
        oracleTimeout: bn('1'),
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: DEFAULT_THRESHOLD.add(WETH_ORACLE_ERROR), // 2% +
        delayUntilDefault: DELAY_UNTIL_DEFAULT, // 72h
      },
      fp('1e-3').toString(),
      {
        nTokens: 2,
        curvePool: ETHPLUS_BP_POOL,
        poolType: CurvePoolType.Plain,
        feeds: [[ONE_ADDRESS], [WETH_USD_FEED]],
        oracleTimeouts: [[bn('1')], [WETH_ORACLE_TIMEOUT]],
        oracleErrors: [[bn('1')], [WETH_ORACLE_ERROR]],
        lpToken: ETHPLUS_BP_TOKEN,
      },
    ],
    'contracts/plugins/assets/curve/CurveAppreciatingRTokenSelfReferentialCollateral.sol:CurveAppreciatingRTokenSelfReferentialCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

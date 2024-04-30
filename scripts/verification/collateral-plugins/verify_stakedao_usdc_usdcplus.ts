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
  USDC_USDCPLUS_POOL,
  USDC_USDCPLUS_LP_TOKEN,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
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

  const collateral = await ethers.getContractAt(
    'StakeDAORecursiveCollateral',
    deployments.collateral.sdUSDCUSDCPlus!
  )

  /********  Verify USDC/USDC+ plugin  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.sdUSDCUSDCPlus,
    [
      {
        erc20: await collateral.erc20(),
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS,
        oracleError: bn('1'),
        oracleTimeout: bn('1'),
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: DEFAULT_THRESHOLD.add(USDC_ORACLE_ERROR), // 2% +
        delayUntilDefault: DELAY_UNTIL_DEFAULT, // 72h
      },
      fp('1e-4'), // backtest to confirm: 0.01% since pool virtual price will probably decrease
      {
        nTokens: 2,
        curvePool: USDC_USDCPLUS_POOL,
        poolType: CurvePoolType.Plain,
        feeds: [[USDC_USD_FEED], [ONE_ADDRESS]],
        oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [bn('1')]],
        oracleErrors: [[USDC_ORACLE_ERROR], [bn('1')]],
        lpToken: USDC_USDCPLUS_LP_TOKEN,
      },
    ],
    'contracts/plugins/assets/curve/stakedao/StakeDAORecursiveCollateral.sol:StakeDAORecursiveCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { baseL2Chains, developmentChains, networkConfig } from '../../../common/configuration'
import { ONE_ADDRESS } from '../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import { combinedError } from '../../deployment/utils'
import { IAeroPool } from '@typechain/IAeroPool'
import {
  AerodromePoolType,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  AERO_USDC_eUSD_POOL,
  AERO_USDC_eUSD_GAUGE,
  AERO,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
  eUSD_ORACLE_ERROR,
  eUSD_ORACLE_TIMEOUT,
  eUSD_USD_FEED,
} from '../../../test/plugins/individual-collateral/aerodrome/constants'

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

  // Only on base, aways use wrapper
  if (baseL2Chains.includes(hre.network.name)) {
    const aeroUSDCeUSDPoolCollateral = await ethers.getContractAt(
      'AerodromeStableCollateral',
      deployments.collateral.aeroUSDCeUSD as string
    )

    /********  Verify Gauge Wrapper  **************************/

    const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', AERO_USDC_eUSD_POOL)
    await verifyContract(
      chainId,
      await aeroUSDCeUSDPoolCollateral.erc20(),
      [
        pool.address,
        'w' + (await pool.name()),
        'w' + (await pool.symbol()),
        AERO,
        AERO_USDC_eUSD_GAUGE,
      ],
      'contracts/plugins/assets/aerodrome/AerodromeGaugeWrapper.sol:AerodromeGaugeWrapper'
    )

    /********  Verify USDC-eUSD plugin  **************************/
    const oracleError = combinedError(USDC_ORACLE_ERROR, eUSD_ORACLE_ERROR) // 0.3% & 0.5%
    await verifyContract(
      chainId,
      deployments.collateral.aeroUSDCeUSD,
      [
        {
          erc20: await aeroUSDCeUSDPoolCollateral.erc20(),
          targetName: ethers.utils.formatBytes32String('USD'),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: oracleError.toString(),
          oracleTimeout: USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        {
          pool: AERO_USDC_eUSD_POOL,
          poolType: AerodromePoolType.Stable,
          feeds: [[USDC_USD_FEED], [eUSD_USD_FEED]],
          oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [eUSD_ORACLE_TIMEOUT]],
          oracleErrors: [[USDC_ORACLE_ERROR], [eUSD_ORACLE_ERROR]],
        },
      ],
      'contracts/plugins/assets/aerodrome/AerodromeStableCollateral.sol:AerodromeStableCollateral'
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

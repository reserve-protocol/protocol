import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig, ITokens } from '../../../common/configuration'
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
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  USDT_USD_FEED,
  PYUSD_ORACLE_TIMEOUT,
  PYUSD_ORACLE_ERROR,
  PYUSD_USD_FEED,
  PRICE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../test/plugins/individual-collateral/meta-morpho/constants'
import { verifyContract } from '../../deployment/utils'
import { BigNumber } from 'ethers'

let deployments: IAssetCollDeployments

// Morpho Vault V2 collaterals — must match the args used in deploy_morpho_v2_vaults.ts
interface V2VaultVerification {
  tokenKey: keyof ITokens
  feed: string
  oracleTimeout: BigNumber
  oracleError: BigNumber
}

const VAULTS: V2VaultVerification[] = [
  {
    tokenKey: 'steakUSDCPrime',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'sentoraPYUSD',
    feed: PYUSD_USD_FEED,
    oracleTimeout: PYUSD_ORACLE_TIMEOUT,
    oracleError: PYUSD_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'gauntletUSDCFrontier',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'steakUSDTPrime',
    feed: USDT_USD_FEED,
    oracleTimeout: USDT_ORACLE_TIMEOUT,
    oracleError: USDT_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'galaxyUSDTQuality',
    feed: USDT_USD_FEED,
    oracleTimeout: USDT_ORACLE_TIMEOUT,
    oracleError: USDT_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'gauntletUSDCPrime',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'galaxyUSDCQuality',
    feed: USDC_USD_FEED,
    oracleTimeout: USDC_ORACLE_TIMEOUT,
    oracleError: USDC_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
  {
    tokenKey: 'skyUSDTSavings',
    feed: USDT_USD_FEED,
    oracleTimeout: USDT_ORACLE_TIMEOUT,
    oracleError: USDT_ORACLE_ERROR,
  }, // eslint-disable-line prettier/prettier
]

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

  for (const v of VAULTS) {
    /********  Verify Morpho Vault V2 collateral  **************************/
    const collateralAddr = deployments.collateral[v.tokenKey]
    if (!collateralAddr) {
      throw new Error(`Missing deployed collateral for ${v.tokenKey} on chain ${chainId}`)
    }
    const erc20 = networkConfig[chainId].tokens[v.tokenKey]
    if (!erc20) {
      throw new Error(`Missing token address for ${v.tokenKey} on chain ${chainId}`)
    }

    await verifyContract(
      chainId,
      collateralAddr,
      [
        {
          priceTimeout: PRICE_TIMEOUT.toString(),
          chainlinkFeed: v.feed,
          oracleError: v.oracleError.toString(),
          erc20: erc20,
          maxTradeVolume: fp('1e6').toString(),
          oracleTimeout: v.oracleTimeout.toString(),
          targetName: hre.ethers.utils.formatBytes32String('USD'),
          defaultThreshold: v.oracleError.add(fp('0.01')).toString(), // +1% buffer rule
          delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
        },
        fp('1e-4'), // can have small drawdowns
      ],
      'contracts/plugins/assets/meta-morpho/MorphoV2FiatCollateral.sol:MorphoV2FiatCollateral'
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

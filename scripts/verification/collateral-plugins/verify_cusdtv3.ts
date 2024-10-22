import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { baseL2Chains, developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import {
  getUsdtOracleError,
  priceTimeout,
  verifyContract,
  revenueHiding,
} from '../../deployment/utils'

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

  // Does not exist on Base L2
  if (baseL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - Not available on Base`)
  }

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const collateral = await ethers.getContractAt(
    'CTokenV3Collateral',
    deployments.collateral.cUSDTv3 as string
  )

  /********  Verify Wrapper token - wcUSDTv3 **************************/

  await verifyContract(
    chainId,
    await collateral.erc20(),
    [
      networkConfig[chainId].tokens.cUSDTv3,
      networkConfig[chainId].COMET_REWARDS,
      networkConfig[chainId].tokens.COMP,
      'Wrapped cUSDTv3',
      'wcUSDTv3',
      fp(1).toString(),
    ],
    'contracts/plugins/assets/compoundv3/CFiatV3Wrapper.sol:CFiatV3Wrapper'
  )

  /********  Verify Collateral - wcUSDTv3  **************************/

  const usdtOracleTimeout = '86400' // 24 hr
  const usdtOracleError = getUsdtOracleError(hre.network.name)

  await verifyContract(
    chainId,
    deployments.collateral.cUSDTv3,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDT,
        oracleError: usdtOracleError.toString(),
        erc20: await collateral.erc20(),
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: usdtOracleTimeout, // 24h hr,
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01').add(usdtOracleError).toString(),
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-5').toString(),
    ],
    'contracts/plugins/assets/compoundv3/CTokenV3Collateral.sol:CTokenV3Collateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

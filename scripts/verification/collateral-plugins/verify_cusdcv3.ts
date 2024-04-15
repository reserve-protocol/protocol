import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import {
  getUsdcOracleError,
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

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const collateral = await ethers.getContractAt(
    'CTokenV3Collateral',
    deployments.collateral.cUSDCv3 as string
  )

  /********  Verify Wrapper token - wcUSDCv3 **************************/

  await verifyContract(
    chainId,
    await collateral.erc20(),
    [
      networkConfig[chainId].tokens.cUSDCv3,
      networkConfig[chainId].COMET_REWARDS,
      networkConfig[chainId].tokens.COMP,
    ],
    'contracts/plugins/assets/compoundv3/CusdcV3Wrapper.sol:CusdcV3Wrapper'
  )

  /********  Verify Collateral - wcUSDCv3  **************************/

  const usdcOracleTimeout = '86400' // 24 hr
  const usdcOracleError = getUsdcOracleError(hre.network.name)

  await verifyContract(
    chainId,
    deployments.collateral.cUSDCv3,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC,
        oracleError: usdcOracleError.toString(),
        erc20: await collateral.erc20(),
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: usdcOracleTimeout, // 24h hr,
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01').add(usdcOracleError).toString(),
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      revenueHiding,
    ],
    'contracts/plugins/assets/compoundv3/CTokenV3Collateral.sol:CTokenV3Collateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { baseL2Chains, developmentChains, networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { fp, bn } from '../../../common/numbers'
import { priceTimeout, oracleTimeout, verifyContract, revenueHiding } from '../../deployment/utils'

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

  // Only exists on Base L2
  if (!baseL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - only available on Base`)
  }

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********  Verify Wrapper  **************************/
  const erc20 = await ethers.getContractAt(
    'StaticATokenV3LM',
    deployments.erc20s.aBasUSDbC as string
  )

  await verifyContract(
    chainId,
    deployments.erc20s.aBasUSDbC,
    [await erc20.POOL(), await erc20.INCENTIVES_CONTROLLER()],
    'contracts/plugins/assets/aave-v3/vendor/StaticATokenV3LM.sol:StaticATokenV3LM'
  )

  /********  Verify Aave V3 USDbC plugin  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.aBasUSDbC,
    [
      {
        erc20: erc20.address,
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC!,
        oracleError: fp('0.003').toString(), // 3%
        oracleTimeout: oracleTimeout(chainId, bn('86400')).toString(), // 24 hr
        maxTradeVolume: fp('1e6').toString(),
        defaultThreshold: fp('0.0125').toString(),
        delayUntilDefault: bn('86400').toString(),
      },
      revenueHiding.toString(),
    ],
    'contracts/plugins/assets/aave-v3/AaveV3FiatCollateral.sol:AaveV3FiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import { revenueHiding } from '../../deployment/utils'
import { defaultCollateralOpts } from '../../../test/plugins/individual-collateral/aave-v3/AaveV3FiatCollateral.test'

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

  /********  Verify Wrapper  **************************/
  const erc20 = await ethers.getContractAt(
    'StaticATokenV3LM',
    deployments.erc20s.aEthUSDC as string
  )

  await verifyContract(
    chainId,
    deployments.erc20s.aEthUSDC,
    [await erc20.POOL(), await erc20.INCENTIVES_CONTROLLER()],
    'contracts/plugins/assets/aave-v3/vendor/StaticATokenV3LM.sol:StaticATokenV3LM'
  )

  /********  Verify Aave V3 USDC plugin  **************************/
  const collateral = await ethers.getContractAt(
    'AaveV3FiatCollateral',
    deployments.collateral.aEthUSDC as string
  )

  await verifyContract(
    chainId,
    deployments.collateral.aEthUSDC,
    [
      {
        erc20: erc20.address,
        targetName: await collateral.targetName(),
        priceTimeout: await collateral.priceTimeout(),
        chainlinkFeed: await collateral.chainlinkFeed(),
        oracleError: await collateral.oracleError(),
        oracleTimeout: await collateral.oracleTimeout(),
        maxTradeVolume: await collateral.maxTradeVolume(),
        defaultThreshold: defaultCollateralOpts.defaultThreshold.toString(),
        delayUntilDefault: await collateral.delayUntilDefault(),
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

import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { fp } from '../../../common/numbers'
import { priceTimeout, verifyContract, revenueHiding } from '../../deployment/utils'

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

  const erc20s: { [key: string]: string } = {
    '1': deployments.erc20s.saEthUSDC!,
    '8453': deployments.erc20s.saBasUSDC!,
    '42161': deployments.erc20s.saArbUSDCn!,
  }
  const erc20 = await ethers.getContractAt('ERC20Mock', erc20s[chainId])

  const collaterals: { [key: string]: string } = {
    '1': deployments.collateral.saEthUSDC!,
    '8453': deployments.collateral.saBasUSDC!,
    '42161': deployments.collateral.saArbUSDCn!,
  }
  const collateral = await ethers.getContractAt('AaveV3FiatCollateral', collaterals[chainId])

  /********  Verify Aave V3 USDC ERC20  **************************/
  await verifyContract(
    chainId,
    erc20.address,
    [networkConfig[chainId].AAVE_V3_POOL!, networkConfig[chainId].AAVE_V3_INCENTIVES_CONTROLLER!],
    'contracts/plugins/assets/aave-v3/vendor/StaticATokenV3LM.sol:StaticATokenV3LM'
  )

  /********  Verify Aave V3 USDC plugin  **************************/
  // Works for any chain

  await verifyContract(
    chainId,
    collateral.address,
    [
      {
        erc20: await collateral.erc20(),
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: await collateral.chainlinkFeed(),
        oracleError: await collateral.oracleError(),
        oracleTimeout: await collateral.oracleTimeout(),
        maxTradeVolume: await collateral.maxTradeVolume(),
        defaultThreshold: fp('0.01')
          .add(await collateral.oracleError())
          .toString(),
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

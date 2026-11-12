import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains } from '../../../common/configuration'
import { ousdCollateralConfig, ousdRevenueHiding } from '../../../common/ousd'
import {
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'

async function main() {
  const chainId = await getChainId(hre)
  if (chainId !== '1' || developmentChains.includes(hre.network.name)) {
    throw new Error(`Unsupported verification network: ${hre.network.name} (${chainId})`)
  }
  const deployments = getDeploymentFile(
    getAssetCollDeploymentFilename(chainId)
  ) as IAssetCollDeployments
  if (!deployments.collateral.wOUSD) throw new Error('Missing wOUSD collateral deployment')

  await verifyContract(
    Number(chainId),
    deployments.collateral.wOUSD,
    [ousdCollateralConfig, ousdRevenueHiding],
    'contracts/plugins/assets/origin/OUSDCollateral.sol:OUSDCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

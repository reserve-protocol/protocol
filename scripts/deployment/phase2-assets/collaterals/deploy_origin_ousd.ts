import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { CollateralStatus } from '../../../../common/constants'
import { ousdCollateralConfig, ousdRevenueHiding } from '../../../../common/ousd'
import {
  fileExists,
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  getDeploymentFilename,
  IAssetCollDeployments,
} from '../../common'

async function main() {
  const chainId = await getChainId(hre)
  if (chainId !== '1') throw new Error(`Unsupported chainId: ${chainId}`)

  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)

  const filename = getAssetCollDeploymentFilename(chainId)
  const deployments = getDeploymentFile(filename) as IAssetCollDeployments
  const [deployer] = await hre.ethers.getSigners()
  console.log(`Deploying wOUSD collateral on ${hre.network.name} with ${deployer.address}`)

  const factory = await hre.ethers.getContractFactory('OUSDCollateral', deployer)
  const collateral = await factory.deploy(ousdCollateralConfig, ousdRevenueHiding)
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  if ((await collateral.status()) !== CollateralStatus.SOUND) {
    throw new Error('wOUSD collateral is not SOUND')
  }

  deployments.collateral.wOUSD = collateral.address
  deployments.erc20s.wOUSD = ousdCollateralConfig.erc20
  fs.writeFileSync(filename, JSON.stringify(deployments, null, 2))
  console.log(`Deployed wOUSD collateral: ${collateral.address}; saved to ${filename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { ICollateral } from '@typechain/ICollateral'
import { getChainId } from '../../../../common/blockchain-utils'
import { baseL2Chains, networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { priceTimeout } from '../../../deployment/utils'

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Only exists on Base chain
  if (!baseL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - only available on Base chain`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const deployedCollateral: string[] = []

  let collateral: ICollateral

  /********  Deploy NARS Collateral - ARS  **************************/

  const { collateral: narsCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.nARS,
    oracleError: fp('0.005').toString(), // 0.5%
    tokenAddress: networkConfig[chainId].tokens.nARS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: '900',
    targetName: hre.ethers.utils.formatBytes32String('ARS'),
    defaultThreshold: fp('0.015').toString(), // 1.5%
    delayUntilDefault: bn('86400').toString(), // 24h
  })

  collateral = <ICollateral>await ethers.getContractAt('ICollateral', narsCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.nARS = narsCollateral
  assetCollDeployments.erc20s.nARS = networkConfig[chainId].tokens.nARS
  deployedCollateral.push(narsCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed nARS asset to ${hre.network.name} (${chainId}):
    New deployments: ${deployedCollateral}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

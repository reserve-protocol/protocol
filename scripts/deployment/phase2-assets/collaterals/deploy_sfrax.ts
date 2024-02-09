import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
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
import { priceTimeout } from '../../utils'
import { SFraxCollateral } from '../../../../typechain'
import { ContractFactory } from 'ethers'

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
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

  /********  Deploy SFRAX Collateral - sFRAX  **************************/

  const SFraxCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'SFraxCollateral'
  )

  const collateral = <SFraxCollateral>await SFraxCollateralFactory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.FRAX,
      oracleError: fp('0.01').toString(), // 1%
      erc20: networkConfig[chainId].tokens.sFRAX,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '3600', // 1 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.02').toString(), // 2% = 1% oracleError + 1% buffer
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    '0' // revenueHiding = 0
  )
  await collateral.deployed()

  console.log(`Deployed sFRAX to ${hre.network.name} (${chainId}): ${collateral.address}`)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.sFRAX = collateral.address
  assetCollDeployments.erc20s.sFRAX = networkConfig[chainId].tokens.sFRAX
  deployedCollateral.push(collateral.address.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
        New deployments: ${deployedCollateral}
        Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { expect } from 'chai'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { bn, fp } from '#/common/numbers'
import { AaveV3FiatCollateral } from '../../../../typechain'
import { priceTimeout, revenueHiding, oracleTimeout } from '../../utils'
import {
  AAVE_V3_USDC_POOL,
  AAVE_V3_INCENTIVES_CONTROLLER,
} from '../../../../test/plugins/individual-collateral/aave-v3/constants'

// This file specifically deploys Aave V3 USDC collateral

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

  /********  Deploy Aave V3 USDC wrapper  **************************/

  const StaticATokenFactory = await hre.ethers.getContractFactory('StaticATokenV3LM')
  const erc20 = await StaticATokenFactory.deploy(AAVE_V3_USDC_POOL, AAVE_V3_INCENTIVES_CONTROLLER)
  await erc20.deployed()
  await (
    await erc20.initialize(
      networkConfig[chainId].tokens.aEthUSDC!,
      'Static Aave Ethereum USDC',
      'saEthUSDC'
    )
  ).wait()

  console.log(
    `Deployed wrapper for Aave V3 USDC on ${hre.network.name} (${chainId}): ${erc20.address} `
  )

  /********  Deploy Aave V3 USDC collateral plugin  **************************/

  const CollateralFactory = await ethers.getContractFactory('AaveV3FiatCollateral')
  const collateral = <AaveV3FiatCollateral>await CollateralFactory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout,
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC!,
      oracleError: fp('0.0025'),
      erc20: erc20.address,
      maxTradeVolume: fp('1e6'),
      oracleTimeout: oracleTimeout(chainId, bn('86400')),
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125'),
      delayUntilDefault: bn('86400'),
    },
    revenueHiding
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Aave V3 USDC collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.aEthUSDC = collateral.address
  assetCollDeployments.erc20s.aEthUSDC = erc20.address
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

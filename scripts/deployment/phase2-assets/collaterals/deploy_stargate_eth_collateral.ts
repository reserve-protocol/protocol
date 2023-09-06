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
import { priceTimeout, oracleTimeout } from '../../utils'
import {
  StargatePoolETHCollateral,
  StargatePoolETHCollateral__factory,
} from '../../../../typechain'
import { ContractFactory } from 'ethers'

import {
  SETH,
  STAKING_CONTRACT,
} from '../../../../test/plugins/individual-collateral/stargate/constants'

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

  /********  Deploy Stargate ETH Wrapper  **************************/

  const WrapperFactory: ContractFactory = await hre.ethers.getContractFactory('StargatePoolWrapper')

  const erc20 = await WrapperFactory.deploy(
    'Wrapped Stargate ETH',
    'wSTG-ETH',
    networkConfig[chainId].tokens.STG,
    STAKING_CONTRACT,
    SETH
  )
  await erc20.deployed()

  console.log(
    `Deployed Wrapper for Stargate ETH on ${hre.network.name} (${chainId}): ${erc20.address} `
  )

  const StargateCollateralFactory: StargatePoolETHCollateral__factory =
    await hre.ethers.getContractFactory('StargatePoolETHCollateral')

  const collateral = <StargatePoolETHCollateral>await StargateCollateralFactory.connect(
    deployer
  ).deploy({
    priceTimeout: priceTimeout.toString(),
    chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH!,
    oracleError: fp('0.005').toString(), // 0.5%,
    erc20: erc20.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr,
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: 0,
    delayUntilDefault: 0,
  })
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed Stargate ETH to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.sETH = collateral.address
  assetCollDeployments.erc20s.sETH = erc20.address
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

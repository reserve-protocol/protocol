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
import { LidoStakedEthCollateral } from '../../../../typechain'
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

  /********  Deploy Lido Staked ETH Collateral - wstETH  **************************/

  const LidoStakedEthCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'LidoStakedEthCollateral'
  )

  const collateral = <LidoStakedEthCollateral>await LidoStakedEthCollateralFactory.connect(
    deployer
  ).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.stETHUSD,
      oracleError: fp('0.01').toString(), // 1%: only for stETHUSD feed
      erc20: networkConfig[chainId].tokens.wstETH,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr,
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      defaultThreshold: fp('0.15').toString(), // 15%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    fp('1e-4').toString(), // revenueHiding = 0.01%
    networkConfig[chainId].chainlinkFeeds.stETHETH, // targetPerRefChainlinkFeed
    oracleTimeout(chainId, '86400').toString() // targetPerRefChainlinkTimeout
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed Lido wStETH to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.wstETH = collateral.address
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

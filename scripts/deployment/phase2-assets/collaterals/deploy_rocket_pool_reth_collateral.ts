import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { priceTimeout, oracleTimeout } from '../../utils'
import { RethCollateral } from '../../../../typechain'
import { ContractFactory } from 'ethers'
import { getLatestBlockNumber } from '#/test/utils/time'

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

    // Get Oracle Lib address if previously deployed (can override with arbitrary address)
    const deployedCollateral: string[] = []

    /********  Deploy Rocket Pool ETH Collateral - rETH  **************************/

    const RethCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'RethCollateral'
    )

    const collateral = <RethCollateral>await RethCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: fp('0.005').toString(), // 0.5%,
        erc20: networkConfig[chainId].tokens.rETH,
        maxTradeVolume: fp('1e3').toString(), // 1k $ETH,
        oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.15').toString(), // 15%
        delayUntilDefault: bn('86400').toString() // 24h
      },
      bn('1e14'), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.rETH, // targetPerRefChainlinkFeed
      oracleTimeout(chainId, '3600').toString() // targetPerRefChainlinkTimeout
    )
    await collateral.deployed()
    await collateral.refresh()

    console.log(
        `Deployed Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
    )

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

import fs from 'fs'
import hre from 'hardhat'
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
import { priceTimeout, combinedError } from '../../utils'
import {
  CBEthCollateral,
  CBEthCollateralL2,
  CBEthCollateralL2__factory,
  CBEthCollateral__factory,
} from '../../../../typechain'

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

  /********  Deploy Coinbase ETH Collateral - CBETH  **************************/

  let collateral: CBEthCollateral | CBEthCollateralL2

  if (!baseL2Chains.includes(hre.network.name)) {
    const CBETHCollateralFactory: CBEthCollateral__factory = (await hre.ethers.getContractFactory(
      'CBEthCollateral'
    )) as CBEthCollateral__factory

    const oracleError = combinedError(fp('0.005'), fp('0.02')) // 0.5% & 2%

    collateral = await CBETHCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH!,
        oracleError: oracleError.toString(), // 0.5% & 2%,
        erc20: networkConfig[chainId].tokens.cbETH!,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '3600', // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(oracleError).toString(), // ~4.5%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4').toString(), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.cbETH!, // refPerTokChainlinkFeed
      '86400' // refPerTokChainlinkTimeout
    )
    await collateral.deployed()
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  } else if (chainId == '8453' || chainId == '84531') {
    // Base L2 chains
    const CBETHCollateralFactory: CBEthCollateralL2__factory = (await hre.ethers.getContractFactory(
      'CBEthCollateralL2'
    )) as CBEthCollateralL2__factory

    const oracleError = combinedError(fp('0.0015'), fp('0.005')) // 0.15% & 0.5%

    collateral = await CBETHCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH!,
        oracleError: oracleError.toString(), // 0.15% & 0.5%,
        erc20: networkConfig[chainId].tokens.cbETH!,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '1200', // 20 min
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(oracleError).toString(), // ~2.5%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4').toString(), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.cbETH!, // refPerTokChainlinkFeed
      '86400', // refPerTokChainlinkTimeout
      networkConfig[chainId].chainlinkFeeds.cbETHETHexr!, // exchangeRateChainlinkFeed
      '86400' // exchangeRateChainlinkTimeout
    )
    await collateral.deployed()
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  console.log(`Deployed Coinbase cbETH to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.cbETH = collateral.address
  assetCollDeployments.erc20s.cbETH = networkConfig[chainId].tokens.cbETH
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

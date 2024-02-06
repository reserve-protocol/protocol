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
import { priceTimeout, combinedError } from '../../utils'
import { RethCollateral } from '../../../../typechain'
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

  const deployedOracle: string[] = []

  /********  Deploy Mock Oracle (if needed)  **************************/
  let rethOracleAddress: string = networkConfig[chainId].chainlinkFeeds.rETH!
  if (chainId == 5) {
    const MockOracleFactory = await hre.ethers.getContractFactory('MockV3Aggregator')
    const mockOracle = await MockOracleFactory.connect(deployer).deploy(8, fp(2000))
    await mockOracle.deployed()
    console.log(
      `Deployed MockV3Aggregator on ${hre.network.name} (${chainId}): ${mockOracle.address} `
    )
    deployedOracle.push(mockOracle.address)
    rethOracleAddress = mockOracle.address
  }

  /********  Deploy Rocket Pool ETH Collateral - rETH  **************************/

  const RethCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'RethCollateral'
  )

  const oracleError = combinedError(fp('0.005'), fp('0.02')) // 0.5% & 2%

  const collateral = <RethCollateral>await RethCollateralFactory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
      oracleError: oracleError.toString(), // 0.5% & 2%
      erc20: networkConfig[chainId].tokens.rETH,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '3600', // 1 hr,
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      defaultThreshold: fp('0.02').add(oracleError).toString(), // ~4.5%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    fp('1e-4').toString(), // revenueHiding = 0.01%
    rethOracleAddress, // refPerTokChainlinkFeed
    '86400' // refPerTokChainlinkTimeout
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed Rocketpool rETH to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.rETH = collateral.address
  assetCollDeployments.erc20s.rETH = networkConfig[chainId].tokens.rETH
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

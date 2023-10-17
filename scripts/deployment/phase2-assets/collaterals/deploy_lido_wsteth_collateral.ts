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

  const deployedOracle: string[] = []

  /********  Deploy Mock Oracle (if needed)  **************************/
  let stethUsdOracleAddress: string = networkConfig[chainId].chainlinkFeeds.stETHUSD!
  let stethEthOracleAddress: string = networkConfig[chainId].chainlinkFeeds.stETHETH!
  if (chainId == 5) {
    const MockOracleFactory = await hre.ethers.getContractFactory('MockV3Aggregator')
    const mockStethUsdOracle = await MockOracleFactory.connect(deployer).deploy(8, bn(2000e8))
    await mockStethUsdOracle.deployed()
    console.log(
      `Deployed MockV3Aggregator on ${hre.network.name} (${chainId}): ${mockStethUsdOracle.address} `
    )
    deployedOracle.push(mockStethUsdOracle.address)
    stethUsdOracleAddress = mockStethUsdOracle.address

    const mockStethEthOracle = await MockOracleFactory.connect(deployer).deploy(8, bn(1e8))
    await mockStethEthOracle.deployed()
    console.log(
      `Deployed MockV3Aggregator on ${hre.network.name} (${chainId}): ${mockStethEthOracle.address} `
    )
    deployedOracle.push(mockStethEthOracle.address)
    stethEthOracleAddress = mockStethEthOracle.address
  }

  /********  Deploy Lido Staked ETH Collateral - wstETH  **************************/

  const LidoStakedEthCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'LidoStakedEthCollateral'
  )

  const collateral = <LidoStakedEthCollateral>await LidoStakedEthCollateralFactory.connect(
    deployer
  ).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: stethUsdOracleAddress,
      oracleError: fp('0.01').toString(), // 1%: only for stETHUSD feed
      erc20: networkConfig[chainId].tokens.wstETH,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '3600', // 1 hr,
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      defaultThreshold: fp('0.025').toString(), // 2.5% = 2% + 0.5% stethEth feed oracleError
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    fp('1e-4').toString(), // revenueHiding = 0.01%
    stethEthOracleAddress, // targetPerRefChainlinkFeed
    '86400' // targetPerRefChainlinkTimeout
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed Lido wStETH to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.wstETH = collateral.address
  assetCollDeployments.erc20s.wstETH = networkConfig[chainId].tokens.wstETH
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

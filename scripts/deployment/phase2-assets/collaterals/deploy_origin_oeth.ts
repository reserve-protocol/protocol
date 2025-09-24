import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { CollateralStatus } from '../../../../common/constants'
import {
  PRICE_FEEDS,
  ORACLE_ERROR,
  OETH_ORACLE_ERROR,
  ORACLE_TIMEOUT,
  OETH_ORACLE_TIMEOUT,
} from '../../../../test/plugins/individual-collateral/origin/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { priceTimeout, combinedError } from '../../utils'
import { OETHCollateral } from '../../../../typechain'
import { ContractFactory } from 'ethers'

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Origin ETH to network ${hre.network.name} (${chainId})
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

  /********  Deploy Origin ETH Collateral - wOETH  **************************/
  const OETHCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'OETHCollateral'
  )

  const oracleError = combinedError(ORACLE_ERROR, OETH_ORACLE_ERROR)
  const collateral = <OETHCollateral>await OETHCollateralFactory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: PRICE_FEEDS.OETH_ETH, // ETH/OETH
      oracleError: oracleError.toString(),
      erc20: networkConfig[chainId].tokens.wOETH,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: OETH_ORACLE_TIMEOUT.toString(), // 24 hr,
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      defaultThreshold: fp('0.02').add(OETH_ORACLE_ERROR).toString(),
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    fp('1e-4').toString(), // revenueHiding = 0.01%
    PRICE_FEEDS.ETH_USD, // uoaPerTargetChainlinkFeed
    ORACLE_TIMEOUT // uoaPerTarget timeout
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed Origin ETH to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.wOETH = collateral.address
  assetCollDeployments.erc20s.wOETH = networkConfig[chainId].tokens.wOETH
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

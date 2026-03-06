import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { fp } from '../../../../common/numbers'
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
import { ETHxCollateral } from '../../../../typechain'
import { ContractFactory } from 'ethers'
import {
  ETH_ORACLE_ERROR,
  ETH_ORACLE_TIMEOUT,
  ETHX_ORACLE_ERROR,
  ETHX_ORACLE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../../test/plugins/individual-collateral/ethx/constants'

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

  /********  Deploy Stader ETH Collateral - ETHx  **************************/
  const ETHxCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'ETHxCollateral'
  )

  const oracleError = combinedError(ETH_ORACLE_ERROR, ETHX_ORACLE_ERROR) // 0.5% + 0.5%

  const collateral = <ETHxCollateral>await ETHxCollateralFactory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
      oracleError: oracleError.toString(), // 0.5% + 0.5%
      erc20: networkConfig[chainId].tokens.ETHx,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: ETH_ORACLE_TIMEOUT.toString(), // 1 hr,
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      defaultThreshold: fp('0.02').add(ETHX_ORACLE_ERROR).toString(), // 2.5%
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(), // 24h
    },
    fp('1e-4').toString(), // revenueHiding = 0.01%
    networkConfig[chainId].chainlinkFeeds.ETHx, // targetPerTokChainlinkFeed
    ETHX_ORACLE_TIMEOUT.toString() // targetPerTokChainlinkTimeout - 24h
  )
  await collateral.deployed()
  await (await collateral.refresh({ gasLimit: 3_000_000 })).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed Stader ETHx to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.ETHx = collateral.address
  assetCollDeployments.erc20s.ETHx = networkConfig[chainId].tokens.ETHx
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

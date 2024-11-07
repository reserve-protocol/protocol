import fs from 'fs'
import hre from 'hardhat'
import { ContractFactory } from 'ethers'
import { expect } from 'chai'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { fp } from '../../../../common/numbers'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { StakedUSDAFiatCollateral } from '../../../../typechain'
import {
  DELAY_UNTIL_DEFAULT,
  PRICE_TIMEOUT,
  ORACLE_TIMEOUT,
  ORACLE_ERROR,
} from '../../../../test/plugins/individual-collateral/angle/constants'

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

  /********  Deploy Staked USDA (stUSD) Collateral **************************/
  let collateral: StakedUSDAFiatCollateral

  const StakedUSDAFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'StakedUSDAFiatCollateral'
  )

  collateral = <StakedUSDAFiatCollateral>await StakedUSDAFiatCollateralFactory.connect(deployer).deploy(
    {
      priceTimeout: PRICE_TIMEOUT.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC,
      oracleError: ORACLE_ERROR.toString(),
      erc20: networkConfig[chainId].tokens.stUSD,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: ORACLE_TIMEOUT.toString(), // 24 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(ORACLE_ERROR).toString(), // ~1.5%
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(), // 72h
    },
    fp('1e-6').toString()
  )

  await collateral.deployed()

  console.log(
    `Deployed Staked USDA (stUSD) Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.stUSD = collateral.address
  assetCollDeployments.erc20s.stUSD = networkConfig[chainId].tokens.stUSD
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

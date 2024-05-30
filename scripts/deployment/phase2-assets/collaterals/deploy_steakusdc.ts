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
import {
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDC_USD_FEED,
  PRICE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../../test/plugins/individual-collateral/meta-morpho/constants'
import { MetaMorphoFiatCollateral } from '../../../../typechain'
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

  /********  Deploy MetaMorpho Steakhouse USDC - steakUSDC  **************************/

  const MetaMorphoFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'MetaMorphoFiatCollateral'
  )

  const collateral = <MetaMorphoFiatCollateral>await MetaMorphoFiatCollateralFactory.connect(
    deployer
  ).deploy(
    {
      priceTimeout: PRICE_TIMEOUT.toString(),
      chainlinkFeed: USDC_USD_FEED,
      oracleError: USDC_ORACLE_ERROR.toString(),
      erc20: networkConfig[chainId].tokens.steakUSDC,
      maxTradeVolume: fp('1e6').toString(), // 17m vault
      oracleTimeout: USDC_ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: USDC_ORACLE_ERROR.add(fp('0.01')).toString(), // +1% buffer rule
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
    },
    fp('1e-4') // can have mild drawdowns
  )
  await collateral.deployed()

  console.log(`Deployed steakUSDC to ${hre.network.name} (${chainId}): ${collateral.address}`)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.steakUSDC = collateral.address
  assetCollDeployments.erc20s.steakUSDC = networkConfig[chainId].tokens.steakUSDC
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

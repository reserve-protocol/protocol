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
  PYUSD_ORACLE_TIMEOUT,
  PYUSD_ORACLE_ERROR,
  PYUSD_USD_FEED,
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

  /********  Deploy MetaMorpho Steakhouse PYUSD - steakPYUSD  **************************/

  const MetaMorphoFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'MetaMorphoFiatCollateral'
  )

  const collateral = <MetaMorphoFiatCollateral>await MetaMorphoFiatCollateralFactory.connect(
    deployer
  ).deploy(
    {
      priceTimeout: PRICE_TIMEOUT.toString(),
      chainlinkFeed: PYUSD_USD_FEED,
      oracleError: PYUSD_ORACLE_ERROR.toString(),
      erc20: networkConfig[chainId].tokens.steakPYUSD,
      maxTradeVolume: fp('0.25e6').toString(), // $1.7m vault
      oracleTimeout: PYUSD_ORACLE_TIMEOUT.toString(),
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: PYUSD_ORACLE_ERROR.add(fp('0.01')).toString(), // +1% buffer rule
      delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
    },
    fp('1e-4') // can have small drawdowns
  )
  await collateral.deployed()

  console.log(`Deployed steakPYUSD to ${hre.network.name} (${chainId}): ${collateral.address}`)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.steakPYUSD = collateral.address
  assetCollDeployments.erc20s.steakPYUSD = networkConfig[chainId].tokens.steakPYUSD
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

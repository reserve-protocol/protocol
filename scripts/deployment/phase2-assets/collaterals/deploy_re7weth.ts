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
  ETH_ORACLE_TIMEOUT,
  ETH_ORACLE_ERROR,
  ETH_USD_FEED,
  PRICE_TIMEOUT,
  DELAY_UNTIL_DEFAULT,
} from '../../../../test/plugins/individual-collateral/meta-morpho/constants'
import { MetaMorphoSelfReferentialCollateral } from '../../../../typechain'
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

  /********  Deploy MetaMorpho RE7 Labs ETH - Re7WETH  **************************/

  const MetaMorphoFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'MetaMorphoSelfReferentialCollateral'
  )

  const collateral = <MetaMorphoSelfReferentialCollateral>(
    await MetaMorphoFiatCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: PRICE_TIMEOUT.toString(),
        chainlinkFeed: ETH_USD_FEED,
        oracleError: ETH_ORACLE_ERROR.toString(),
        erc20: networkConfig[chainId].tokens.Re7WETH,
        maxTradeVolume: fp('1e6').toString(), // $12m vault
        oracleTimeout: ETH_ORACLE_TIMEOUT.toString(),
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: '0', // WETH
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(),
      },
      fp('1e-3') // can have large drawdowns
    )
  )
  await collateral.deployed()

  console.log(`Deployed Re7WETH to ${hre.network.name} (${chainId}): ${collateral.address}`)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.Re7WETH = collateral.address
  assetCollDeployments.erc20s.Re7WETH = networkConfig[chainId].tokens.Re7WETH
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

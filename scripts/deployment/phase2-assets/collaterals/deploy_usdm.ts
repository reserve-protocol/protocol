import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { arbitrumL2Chains, networkConfig } from '../../../../common/configuration'
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
import { USDMCollateral } from '../../../../typechain'
import { ContractFactory } from 'ethers'
import {
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  PRICE_TIMEOUT,
  ORACLE_TIMEOUT,
  ORACLE_ERROR,
} from '../../../../test/plugins/individual-collateral/mountain/constants'

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

  /********  Deploy USDM Collateral - wUSDM  **************************/
  let collateral: USDMCollateral

  // Only on Arbitrum for now
  if (arbitrumL2Chains.includes(hre.network.name)) {
    const USDMCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'USDMCollateral'
    )

    collateral = <USDMCollateral>await USDMCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: PRICE_TIMEOUT.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.wUSDM,
        oracleError: ORACLE_ERROR.toString(), // 1%
        erc20: networkConfig[chainId].tokens.wUSDM,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: ORACLE_TIMEOUT.toString(), // 24 hr
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: DEFAULT_THRESHOLD.toString(),
        delayUntilDefault: DELAY_UNTIL_DEFAULT.toString(), // 24h
      },
      fp('1e-6')
    )
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  await collateral.deployed()

  console.log(
    `Deployed USDM (wUSDM) Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )
  // await (await collateral.refresh()).wait()
  // expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    '🚨 The wUSDM collateral requires chronicle to whitelist the collateral plugin after deployment 🚨'
  )

  console.log(
    '🚨 After that, we need to return to this plugin and refresh() it and confirm it is SOUND 🚨'
  )

  assetCollDeployments.collateral.wUSDM = collateral.address
  assetCollDeployments.erc20s.wUSDM = networkConfig[chainId].tokens.wUSDM
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

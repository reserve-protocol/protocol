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
import {
  DELAY_UNTIL_DEFAULT,
  ONE_PERCENT_FEE,
} from '../../../../test/plugins/individual-collateral/dtf/constants'
import { priceTimeout } from '../../utils'
import { DemurrageCollateral } from '../../../../typechain'
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

  /********  Deploy cbBTC Demurrage Collateral - cbBTC  **************************/

  if (!baseL2Chains.includes(hre.network.name)) {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  const DemurrageCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'DemurrageCollateral'
  )

  const collateral = <DemurrageCollateral>await DemurrageCollateralFactory.connect(deployer).deploy(
    {
      erc20: networkConfig[chainId].tokens.cbBTC,
      targetName: hre.ethers.utils.formatBytes32String('BTC'),
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.cbBTC, // {UoA/tok}
      oracleError: fp('0.005').toString(), // 0.5%
      oracleTimeout: bn('86400').toString(), // 24 hr
      maxTradeVolume: fp('1e6').toString(), // $1m,
      defaultThreshold: bn('0'),
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
    },
    {
      isFiat: false,
      targetUnitFeed0: false,
      fee: ONE_PERCENT_FEE,
      feed1: networkConfig[chainId].chainlinkFeeds.BTC, // {UoA/target}
      timeout1: bn('1200'), // 20 min
      error1: fp('0.001').toString(), // 0.1%
    }
  )
  await collateral.deployed()

  console.log(`Deployed cbBTC to ${hre.network.name} (${chainId}): ${collateral.address}`)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.cbBTC = collateral.address
  assetCollDeployments.erc20s.cbBTC = networkConfig[chainId].tokens.cbBTC
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

import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { CollateralStatus, ZERO_ADDRESS } from '../../../../common/constants'
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

  /********  Deploy PAXG Demurrage Collateral - PAXG  **************************/

  if (baseL2Chains.includes(hre.network.name) || arbitrumL2Chains.includes(hre.network.name)) {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  const DemurrageCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'DemurrageCollateral'
  )

  const collateral = <DemurrageCollateral>await DemurrageCollateralFactory.connect(deployer).deploy(
    {
      erc20: networkConfig[chainId].tokens.PAXG,
      targetName: hre.ethers.utils.formatBytes32String('DMR100XAU'),
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.XAU, // {UoA/tok}
      oracleError: fp('0.003').toString(), // 0.3%
      oracleTimeout: bn('86400').toString(), // 24 hr
      maxTradeVolume: fp('1e6').toString(), // $1m,
      defaultThreshold: bn('0'),
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
    },
    {
      isFiat: false,
      targetUnitFeed0: false,
      fee: ONE_PERCENT_FEE,
      feed1: ZERO_ADDRESS,
      timeout1: bn('0'),
      error1: bn('0'),
    }
  )
  await collateral.deployed()

  console.log(`Deployed PAXG to ${hre.network.name} (${chainId}): ${collateral.address}`)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.DMR100PAXG = collateral.address
  assetCollDeployments.erc20s.DMR100PAXG = networkConfig[chainId].tokens.PAXG
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

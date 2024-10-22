import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { arbitrumL2Chains, networkConfig } from '../../../../common/configuration'
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
import { priceTimeout, getArbOracleError } from '../../utils'
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

  /********  Deploy ARB Demurrage Collateral - ARB  **************************/

  if (!arbitrumL2Chains.includes(hre.network.name)) {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  const DemurrageCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'DemurrageCollateral'
  )

  const oracleError = getArbOracleError(hre.network.name)

  const collateral = <DemurrageCollateral>await DemurrageCollateralFactory.connect(deployer).deploy(
    {
      erc20: networkConfig[chainId].tokens.ARB,
      targetName: hre.ethers.utils.formatBytes32String('DMR100ARB'),
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ARB, // {UoA/tok}
      oracleError: oracleError.toString(),
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

  console.log(`Deployed ARB to ${hre.network.name} (${chainId}): ${collateral.address}`)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.DMR100ARB = collateral.address
  assetCollDeployments.erc20s.DMR100ARB = networkConfig[chainId].tokens.ARB
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

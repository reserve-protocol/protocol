import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
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
import { priceTimeout, oracleTimeout, revenueHiding } from '../../utils'
import { CTokenV3Collateral } from '../../../../typechain'
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

  /********  Deploy CompoundV3 USDC - cUSDCv3  **************************/

  const WrapperFactory: ContractFactory = await hre.ethers.getContractFactory('CusdcV3Wrapper')

  const erc20 = await WrapperFactory.deploy(
    networkConfig[chainId].tokens.cUSDCv3,
    '0x1B0e765F6224C21223AeA2af16c1C46E38885a40',
    networkConfig[chainId].tokens.COMP
  )
  await erc20.deployed()

  const CTokenV3Factory: ContractFactory = await hre.ethers.getContractFactory('CTokenV3Collateral')

  const collateral = <CTokenV3Collateral>await CTokenV3Factory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC,
      oracleError: fp('0.0025').toString(), // 0.25%,
      erc20: erc20.address,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24h hr,
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125').toString(), // 1% + 0.25%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    revenueHiding.toString(),
    bn('10000e6').toString() // $10k
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed CompoundV3 USDC to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.cUSDCv3 = collateral.address
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

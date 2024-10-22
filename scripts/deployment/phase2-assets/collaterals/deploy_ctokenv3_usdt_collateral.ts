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
import { getUsdtOracleError, priceTimeout } from '../../utils'
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

  // Does not exist on Base L2
  if (baseL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - Not available on Base`)
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

  /********  Deploy CompoundV3 USDT - cUSDTv3 **************************/

  const WrapperFactory: ContractFactory = await hre.ethers.getContractFactory('CFiatV3Wrapper')
  const erc20 = await WrapperFactory.deploy(
    networkConfig[chainId].tokens.cUSDTv3,
    networkConfig[chainId].COMET_REWARDS,
    networkConfig[chainId].tokens.COMP,
    'Wrapped cUSDTv3',
    'wcUSDTv3',
    fp(1).toString()
  )
  await erc20.deployed()

  console.log(`Deployed wrapper for cUSDTv3 on ${hre.network.name} (${chainId}): ${erc20.address} `)

  const CTokenV3Factory: ContractFactory = await hre.ethers.getContractFactory('CTokenV3Collateral')

  const usdtOracleTimeout = '86400' // 24 hr
  const usdtOracleError = getUsdtOracleError(hre.network.name)

  const collateral = <CTokenV3Collateral>await CTokenV3Factory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDT,
      oracleError: usdtOracleError.toString(),
      erc20: erc20.address,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: usdtOracleTimeout, // 24h hr,
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(usdtOracleError).toString(),
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    fp('1e-5').toString() // results from backtester, 1e-6 defaulted
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed CompoundV3 USDT to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.cUSDTv3 = collateral.address
  assetCollDeployments.erc20s.cUSDTv3 = erc20.address
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

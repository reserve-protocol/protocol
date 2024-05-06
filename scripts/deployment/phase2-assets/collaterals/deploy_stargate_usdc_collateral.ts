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
import { revenueHiding, priceTimeout } from '../../utils'
import {
  StargatePoolFiatCollateral,
  StargatePoolFiatCollateral__factory,
} from '../../../../typechain'
import { ContractFactory } from 'ethers'
import { useEnv } from '#/utils/env'

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

  /********  Deploy Stargate USDC Wrapper  **************************/

  const WrapperFactory: ContractFactory = await hre.ethers.getContractFactory(
    'StargateRewardableWrapper'
  )
  const chainIdKey = useEnv('FORK_NETWORK', 'mainnet') == 'mainnet' ? '1' : '8453'
  let USDC_NAME = 'USDC'
  let name = 'Wrapped Stargate USDC'
  let symbol = 'wsgUSDC'
  let sUSDC = networkConfig[chainIdKey].tokens.sUSDC
  let oracleError = fp('0.0025')

  if (chainIdKey == '8453') {
    throw new Error('deprecated; no pure USDC market available')
    USDC_NAME = 'USDbC'
    name = 'Wrapped Stargate USDbC'
    symbol = 'wsgUSDbC'
    sUSDC = networkConfig[chainIdKey].tokens.sUSDbC

    oracleError = fp('0.003')
  }

  const erc20 = await WrapperFactory.deploy(
    name,
    symbol,
    networkConfig[chainIdKey].tokens.STG,
    networkConfig[chainIdKey].STARGATE_STAKING_CONTRACT,
    sUSDC
  )
  await erc20.deployed()

  console.log(
    `Deployed Wrapper for Stargate ${USDC_NAME} on ${hre.network.name} (${chainIdKey}): ${erc20.address} `
  )

  const StargateCollateralFactory: StargatePoolFiatCollateral__factory =
    await hre.ethers.getContractFactory('StargatePoolFiatCollateral')

  const collateral = <StargatePoolFiatCollateral>await StargateCollateralFactory.connect(
    deployer
  ).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainIdKey].chainlinkFeeds.USDC!,
      oracleError: oracleError.toString(),
      erc20: erc20.address,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24h hr,
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(oracleError).toString(),
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    revenueHiding.toString()
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Stargate ${USDC_NAME} to ${hre.network.name} (${chainIdKey}): ${collateral.address}`
  )

  if (chainIdKey == '8453') {
    assetCollDeployments.collateral.wsgUSDbC = collateral.address
    assetCollDeployments.erc20s.wsgUSDbC = erc20.address
  } else {
    assetCollDeployments.collateral.wsgUSDC = collateral.address
    assetCollDeployments.erc20s.wsgUSDC = erc20.address
  }
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

import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  fileExists,
} from '../../../deployment/common'
import { priceTimeout } from '../../../deployment/utils'
import { ICollateral } from '../../../../typechain'
import {
  PYUSD_MAX_TRADE_VOLUME,
  PYUSD_ORACLE_ERROR,
  PYUSD_ORACLE_TIMEOUT,
} from '#/test/plugins/individual-collateral/aave-v3/constants'
import { CollateralStatus } from '#/common/constants'
import { expect } from 'chai'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying pyUSD asset to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Only exists on Mainnet
  if (baseL2Chains.includes(hre.network.name) || arbitrumL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - only available on Mainnet`)
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

  /********  Deploy pyUSD asset **************************/
  const { collateral: pyUsdCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.pyUSD,
    oracleError: PYUSD_ORACLE_ERROR.toString(),
    tokenAddress: networkConfig[chainId].tokens.pyUSD,
    maxTradeVolume: PYUSD_MAX_TRADE_VOLUME.toString(),
    oracleTimeout: PYUSD_ORACLE_TIMEOUT.toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.01').add(PYUSD_ORACLE_ERROR).toString(),
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  const collateral = <ICollateral>await ethers.getContractAt('ICollateral', pyUsdCollateral)
  await (await collateral.refresh({ gasLimit: 3_000_000 })).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.pyUSD = pyUsdCollateral
  assetCollDeployments.erc20s.pyUSD = networkConfig[chainId].tokens.pyUSD
  deployedCollateral.push(pyUsdCollateral.toString())

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed pyUSD asset to ${hre.network.name} (${chainId}):
    New deployments: ${deployedCollateral}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

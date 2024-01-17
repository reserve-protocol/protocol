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
import { priceTimeout } from '../../utils'
import { YearnV2CurveFiatCollateral } from '../../../../typechain'
import { ContractFactory } from 'ethers'
import {
  PRICE_PER_SHARE_HELPER,
  YVUSDP_LP_TOKEN,
} from '../../../../test/plugins/individual-collateral/yearnv2/constants'

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

  /********  Deploy Yearn V2 Curve Fiat Collateral - yvCurveUSDPcrvUSD  **************************/

  const YearnV2CurveCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
    'YearnV2CurveFiatCollateral'
  )

  const collateral = <YearnV2CurveFiatCollateral>await YearnV2CurveCollateralFactory.connect(
    deployer
  ).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDP, // not used but can't be empty
      oracleError: fp('0.0025').toString(), // not used but can't be empty
      erc20: networkConfig[chainId].tokens.yvCurveUSDPcrvUSD,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24hr -- max of all oracleTimeouts
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.02').toString(), // 2% = max oracleError + 1%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    fp('1e-6').toString(), // revenueHiding = 0.0001%, low since underlying curve pool should be up-only
    {
      nTokens: '2',
      curvePool: YVUSDP_LP_TOKEN,
      poolType: '0',
      feeds: [
        [networkConfig[chainId].chainlinkFeeds.USDP],
        [networkConfig[chainId].chainlinkFeeds.crvUSD],
      ],
      oracleTimeouts: [['3600'], ['86400']],
      oracleErrors: [[fp('0.01').toString()], [fp('0.005').toString()]],
      lpToken: YVUSDP_LP_TOKEN,
    },
    PRICE_PER_SHARE_HELPER
  )
  await collateral.deployed()

  console.log(
    `Deployed Yearn Curve yvUSDPcrvUSD to ${hre.network.name} (${chainId}): ${collateral.address}`
  )
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.yvCurveUSDPcrvUSD = collateral.address
  assetCollDeployments.erc20s.yvCurveUSDPcrvUSD = networkConfig[chainId].tokens.yvCurveUSDPcrvUSD
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

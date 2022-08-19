import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  validatePrerequisites,
} from '../deployment_utils'
import { TradingLibP1, RewardableLibP1, RTokenPricingLib } from '../../../typechain'

let tradingLib: TradingLibP1
let rewardableLib: RewardableLibP1
let rTokenPricingLib: RTokenPricingLib

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying TradingLib and RewardableLib to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  await validatePrerequisites(deployments)

  // ******************** Deploy libraries ****************************************/

  // Deploy TradingLib external library
  const TradingLibFactory = await ethers.getContractFactory('TradingLibP1')
  tradingLib = <TradingLibP1>await TradingLibFactory.connect(burner).deploy()
  await tradingLib.deployed()
  deployments.tradingLib = tradingLib.address

  // Deploy RewardableLib external library
  const RewardableLibFactory = await ethers.getContractFactory('RewardableLibP1')
  rewardableLib = <RewardableLibP1>await RewardableLibFactory.deploy()
  await rewardableLib.deployed()
  deployments.rewardableLib = rewardableLib.address

  // Deploy RTokenPricing external library
  const RTokenPricingLib = await ethers.getContractFactory('RTokenPricingLib')
  rTokenPricingLib = <RTokenPricingLib>await RTokenPricingLib.deploy()
  await rTokenPricingLib.deployed()
  deployments.rTokenPricingLib = rTokenPricingLib.address

  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId}):
    TradingLib: ${tradingLib.address}
    RewardableLib: ${rewardableLib.address}
    RTokenPricing: ${rTokenPricingLib.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

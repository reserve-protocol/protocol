import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { Contract } from 'ethers'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { validatePrerequisites } from '../utils'
import { RecollateralizationLibP1, OracleLib, PermitLib } from '../../../typechain'

let tradingLib: RecollateralizationLibP1
let rewardableLib: Contract
let oracleLib: OracleLib
let permitLib: PermitLib

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying TradingLib, RewardableLib, PermitLib, and OracleLib 
    to network ${hre.network.name} (${chainId}) with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  await validatePrerequisites(deployments)

  // ******************** Deploy libraries ****************************************/

  // Deploy TradingLib external library
  const TradingLibFactory = await ethers.getContractFactory('RecollateralizationLibP1')
  tradingLib = <RecollateralizationLibP1>await TradingLibFactory.connect(burner).deploy()
  await tradingLib.deployed()
  deployments.tradingLib = tradingLib.address

  // Deploy RewardableLib external library
  const RewardableLibFactory = await ethers.getContractFactory('RewardableLibP1')
  rewardableLib = <Contract>await RewardableLibFactory.deploy()
  await rewardableLib.deployed()
  deployments.rewardableLib = rewardableLib.address

  // Deploy PermitLib external library
  const PermitLibFactory = await ethers.getContractFactory('PermitLib')
  permitLib = <PermitLib>await PermitLibFactory.deploy()
  await permitLib.deployed()
  deployments.permitLib = permitLib.address

  // Deploy OracleLib external library
  const OracleLibFactory = await ethers.getContractFactory('OracleLib')
  oracleLib = <OracleLib>await OracleLibFactory.deploy()
  await oracleLib.deployed()
  deployments.oracleLib = oracleLib.address

  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId}):
    TradingLib: ${tradingLib.address}
    RewardableLib: ${rewardableLib.address}
    PermitLib: ${permitLib.address}
    OracleLib: ${oracleLib.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

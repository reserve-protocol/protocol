import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { validatePrerequisites } from '../utils'
import { BasketLibP1, CvxMining, RecollateralizationLibP1 } from '../../../typechain'

let tradingLib: RecollateralizationLibP1
let basketLib: BasketLibP1
let cvxMiningLib: CvxMining

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(
    `Deploying TradingLib and CvxMining to network ${hre.network.name} (${chainId}) with burner account: ${burner.address}`
  )

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

  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  // Deploy BasketLib external library
  const BasketLibFactory = await ethers.getContractFactory('BasketLibP1')
  basketLib = <BasketLibP1>await BasketLibFactory.connect(burner).deploy()
  await basketLib.deployed()
  deployments.basketLib = basketLib.address

  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  // Deploy CvxMining external library
  const CvxMiningFactory = await ethers.getContractFactory('CvxMining')
  cvxMiningLib = <CvxMining>await CvxMiningFactory.connect(burner).deploy()
  await cvxMiningLib.deployed()
  deployments.cvxMiningLib = cvxMiningLib.address

  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId}):
    TradingLib: ${tradingLib.address}
    BasketLib: ${basketLib.address}
    CvxMiningLib: ${cvxMiningLib.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

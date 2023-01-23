import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import {
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  BrokerP1,
  DistributorP1,
  FurnaceP1,
  GnosisTrade,
  MainP1,
  RevenueTraderP1,
  RTokenP1,
  StRSRP1Votes,
} from '../../../typechain'

let assetRegImpl: AssetRegistryP1
let backingMgrImpl: BackingManagerP1
let bskHndlrImpl: BasketHandlerP1
let brokerImpl: BrokerP1
let distribImpl: DistributorP1
let furnaceImpl: FurnaceP1
let mainImpl: MainP1
let revTraderImpl: RevenueTraderP1
let rTokenImpl: RTokenP1
let stRSRImpl: StRSRP1Votes
let tradeImpl: GnosisTrade

const writeComponentDeployment = (
  deployments: IDeployments,
  deploymentFilename: string,
  name: string,
  implAddr: string,
  logDesc: string
) => {
  const field = name as keyof typeof deployments.implementations.components

  // Write temporary deployments file for component
  deployments.implementations.components[field] = implAddr
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`    ${logDesc} Implementation: ${implAddr}`)
}

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying implementations to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  if (!deployments.tradingLib) {
    throw new Error(`Missing pre-requisite addresses in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.tradingLib))) {
    throw new Error(`TradingLib contract not found in network ${hre.network.name}`)
  }

  // ******************** Deploy Main ********************************/

  const MainImplFactory = await ethers.getContractFactory('MainP1')
  mainImpl = <MainP1>await MainImplFactory.connect(burner).deploy()
  await mainImpl.deployed()

  // Write temporary deployments file
  deployments.implementations.main = mainImpl.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId}):
    Main Implementation:  ${mainImpl.address}`)

  // ******************** Deploy Trade ********************************/

  const TradeImplFactory = await ethers.getContractFactory('GnosisTrade')
  tradeImpl = <GnosisTrade>await TradeImplFactory.connect(burner).deploy()
  await tradeImpl.deployed()

  // Write temporary deployments file
  deployments.implementations.trade = tradeImpl.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`    Trade Implementation:  ${tradeImpl.address}`)

  // ******************** Deploy Components ********************************/

  // 1. ******* Asset Registry ********/
  const AssetRegImplFactory = await ethers.getContractFactory('AssetRegistryP1')
  assetRegImpl = <AssetRegistryP1>await AssetRegImplFactory.connect(burner).deploy()
  await assetRegImpl.deployed()

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'assetRegistry',
    assetRegImpl.address,
    'AssetRegistry'
  )

  // 2. ******* Backing Manager ***********/
  const BackingMgrImplFactory = await ethers.getContractFactory('BackingManagerP1', {
    libraries: {
      RecollateralizationLibP1: deployments.tradingLib,
    },
  })
  backingMgrImpl = <BackingManagerP1>await BackingMgrImplFactory.connect(burner).deploy()
  await backingMgrImpl.deployed()

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'backingManager',
    backingMgrImpl.address,
    'BackingManager'
  )

  // 3. ********* Basket Handler *************/
  const BskHandlerImplFactory = await ethers.getContractFactory('BasketHandlerP1')
  bskHndlrImpl = <BasketHandlerP1>await BskHandlerImplFactory.connect(burner).deploy()
  await bskHndlrImpl.deployed()

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'basketHandler',
    bskHndlrImpl.address,
    'BasketHandler'
  )

  // 4. *********** Broker *************/
  const BrokerImplFactory = await ethers.getContractFactory('BrokerP1')
  brokerImpl = <BrokerP1>await BrokerImplFactory.connect(burner).deploy()
  await brokerImpl.deployed()

  writeComponentDeployment(deployments, deploymentFilename, 'broker', brokerImpl.address, 'Broker')

  // 5. *********** Distributor *************/
  const DistribImplFactory = await ethers.getContractFactory('DistributorP1')
  distribImpl = <DistributorP1>await DistribImplFactory.connect(burner).deploy()
  await distribImpl.deployed()

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'distributor',
    distribImpl.address,
    'Distributor'
  )

  // 6. *********** Furnace *************/
  const FurnaceImplFactory = await ethers.getContractFactory('FurnaceP1')
  furnaceImpl = <FurnaceP1>await FurnaceImplFactory.connect(burner).deploy()
  await furnaceImpl.deployed()

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'furnace',
    furnaceImpl.address,
    'Furnace'
  )

  // 7. *********** RevenueTrader *************/

  const RevTraderImplFactory = await ethers.getContractFactory('RevenueTraderP1')
  revTraderImpl = <RevenueTraderP1>await RevTraderImplFactory.connect(burner).deploy()
  await revTraderImpl.deployed()

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'rsrTrader',
    revTraderImpl.address,
    'RSR Trader'
  )
  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'rTokenTrader',
    revTraderImpl.address,
    'RToken Trader'
  )

  // 8. *********** RToken *************/
  const RTokenImplFactory = await ethers.getContractFactory('RTokenP1')
  rTokenImpl = <RTokenP1>await RTokenImplFactory.connect(burner).deploy()
  await rTokenImpl.deployed()

  writeComponentDeployment(deployments, deploymentFilename, 'rToken', rTokenImpl.address, 'RToken')

  // 9. *********** StRSR *************/

  const StRSRImplFactory = await ethers.getContractFactory('StRSRP1Votes')
  stRSRImpl = <StRSRP1Votes>await StRSRImplFactory.connect(burner).deploy()
  await stRSRImpl.deployed()

  writeComponentDeployment(deployments, deploymentFilename, 'stRSR', stRSRImpl.address, 'StRSR')

  console.log(`    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

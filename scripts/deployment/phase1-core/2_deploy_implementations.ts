import fs from 'fs'
import hre, { ethers, upgrades } from 'hardhat'
import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { getEmptyDeployment, prompt, validateImplementations } from '../utils'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  writeComponentDeployment,
} from '../common'

import {
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  BrokerP1,
  DistributorP1,
  DutchTrade,
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
let rsrTraderImpl: RevenueTraderP1
let rTokenTraderImpl: RevenueTraderP1
let rTokenImpl: RTokenP1
let stRSRImpl: StRSRP1Votes
let gnosisTradeImpl: GnosisTrade
let dutchTradeImpl: DutchTrade

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  // Request last deployed version - if empty, perform new deployment
  const LAST_DEPLOYED_VERSION = await prompt(
    'Enter the last deployed version (e.g: "2.1.0"), or leave empty for new deployment: '
  )

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  if (!deployments.tradingLib || !deployments.basketLib) {
    throw new Error(`Missing pre-requisite addresses in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.tradingLib))) {
    throw new Error(`TradingLib contract not found in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, deployments.basketLib))) {
    throw new Error(`BasketLib contract not found in network ${hre.network.name}`)
  }

  // Check if this is an upgrade or a new deployment
  let upgrade = false
  let prevDeployments: IDeployments = getEmptyDeployment()
  let prevDeploymentFilename = ''
  if (LAST_DEPLOYED_VERSION.length > 0) {
    // Get Previously Deployed addresses
    // If running on Mainnet or fork, use Mainnet deployments
    if (
      hre.network.name == 'mainnet' ||
      hre.network.name == 'localhost' ||
      hre.network.name == 'hardhat'
    ) {
      prevDeploymentFilename = getDeploymentFilename(1, `mainnet-${LAST_DEPLOYED_VERSION}`)
    } else {
      prevDeploymentFilename = getDeploymentFilename(
        chainId,
        `${hre.network.name}-${LAST_DEPLOYED_VERSION}`
      )
    }

    prevDeployments = <IDeployments>getDeploymentFile(prevDeploymentFilename)
    await validateImplementations(prevDeployments)

    // Set upgrade flag
    upgrade = true
  }

  if (!upgrade) {
    console.log(`Deploying implementations to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)
  } else {
    console.log(`Deploying upgrade implementations for ${LAST_DEPLOYED_VERSION} to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)
  }

  // ******************** Deploy Main ********************************/
  const MainImplFactory = await ethers.getContractFactory('MainP1')
  let mainImplAddr = ''
  if (!upgrade) {
    mainImplAddr = (await upgrades.deployImplementation(MainImplFactory, {
      kind: 'uups',
    })) as string
  } else {
    mainImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.main,
      MainImplFactory,
      {
        kind: 'uups',
      }
    )) as string
  }
  mainImpl = <MainP1>await ethers.getContractAt('MainP1', mainImplAddr)

  // Write temporary deployments file
  deployments.implementations.main = mainImpl.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId}):
  Main Implementation:  ${mainImpl.address} ${
    mainImpl.address == prevDeployments.implementations.main ? '- SKIPPED' : ''
  }`)

  // ******************** Deploy GnosisTrade ********************************/

  const GnosisTradeImplFactory = await ethers.getContractFactory('GnosisTrade')
  gnosisTradeImpl = <GnosisTrade>await GnosisTradeImplFactory.connect(burner).deploy()
  await gnosisTradeImpl.deployed()

  // Write temporary deployments file
  deployments.implementations.trading.gnosisTrade = gnosisTradeImpl.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`  GnosisTrade Implementation:  ${gnosisTradeImpl.address}`)

  // ******************** Deploy DutchTrade ********************************/

  const DutchTradeImplFactory = await ethers.getContractFactory('DutchTrade')
  dutchTradeImpl = <DutchTrade>await DutchTradeImplFactory.connect(burner).deploy()
  await dutchTradeImpl.deployed()

  // Write temporary deployments file
  deployments.implementations.trading.dutchTrade = dutchTradeImpl.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`  DutchTrade Implementation:  ${dutchTradeImpl.address}`)

  // ******************** Deploy Components ********************************/

  // 1. ******* Asset Registry ********/
  const AssetRegImplFactory = await ethers.getContractFactory('AssetRegistryP1')
  let assetRegImplAddr = ''
  if (!upgrade) {
    assetRegImplAddr = (await upgrades.deployImplementation(AssetRegImplFactory, {
      kind: 'uups',
    })) as string
  } else {
    assetRegImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.assetRegistry,
      AssetRegImplFactory,
      {
        kind: 'uups',
      }
    )) as string
  }

  assetRegImpl = await ethers.getContractAt('AssetRegistryP1', assetRegImplAddr)

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'assetRegistry',
    assetRegImpl.address,
    'AssetRegistry',
    prevDeployments.implementations.components.assetRegistry
  )

  // 2. ******* Backing Manager ***********/
  const BackingMgrImplFactory = await ethers.getContractFactory('BackingManagerP1', {
    libraries: {
      RecollateralizationLibP1: deployments.tradingLib,
    },
  })
  let backingMgrImplAddr = ''
  if (!upgrade) {
    backingMgrImplAddr = (await upgrades.deployImplementation(BackingMgrImplFactory, {
      kind: 'uups',
      unsafeAllow: ['external-library-linking', 'delegatecall'],
    })) as string
  } else {
    backingMgrImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.backingManager,
      BackingMgrImplFactory,
      {
        kind: 'uups',
        unsafeAllow: ['external-library-linking', 'delegatecall'],
      }
    )) as string
  }

  backingMgrImpl = <BackingManagerP1>(
    await ethers.getContractAt('BackingManagerP1', backingMgrImplAddr)
  )

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'backingManager',
    backingMgrImpl.address,
    'BackingManager',
    prevDeployments.implementations.components.backingManager
  )

  // 3. ********* Basket Handler *************/
  const BskHandlerImplFactory = await ethers.getContractFactory('BasketHandlerP1', {
    libraries: { BasketLibP1: deployments.basketLib },
  })
  let bskHndlrImplAddr = ''
  if (!upgrade) {
    bskHndlrImplAddr = (await upgrades.deployImplementation(BskHandlerImplFactory, {
      kind: 'uups',
      unsafeAllow: ['external-library-linking'],
    })) as string
  } else {
    bskHndlrImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.basketHandler,
      BskHandlerImplFactory,
      {
        kind: 'uups',
        unsafeAllow: ['external-library-linking'],
      }
    )) as string
  }

  bskHndlrImpl = <BasketHandlerP1>await ethers.getContractAt('BasketHandlerP1', bskHndlrImplAddr)

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'basketHandler',
    bskHndlrImpl.address,
    'BasketHandler',
    prevDeployments.implementations.components.basketHandler
  )

  // 4. *********** Broker *************/
  const BrokerImplFactory = await ethers.getContractFactory('BrokerP1')
  let brokerImplAddr = ''
  if (!upgrade) {
    brokerImplAddr = (await upgrades.deployImplementation(BrokerImplFactory, {
      kind: 'uups',
    })) as string
  } else {
    brokerImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.broker,
      BrokerImplFactory,
      {
        kind: 'uups',
      }
    )) as string
  }

  brokerImpl = <BrokerP1>await ethers.getContractAt('BrokerP1', brokerImplAddr)

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'broker',
    brokerImpl.address,
    'Broker',
    prevDeployments.implementations.components.broker
  )

  // 5. *********** Distributor *************/
  const DistribImplFactory = await ethers.getContractFactory('DistributorP1')
  let distribImplAddr = ''
  if (!upgrade) {
    distribImplAddr = (await upgrades.deployImplementation(DistribImplFactory, {
      kind: 'uups',
    })) as string
  } else {
    distribImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.distributor,
      DistribImplFactory,
      {
        kind: 'uups',
      }
    )) as string
  }

  distribImpl = <DistributorP1>await ethers.getContractAt('DistributorP1', distribImplAddr)

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'distributor',
    distribImpl.address,
    'Distributor',
    prevDeployments.implementations.components.distributor
  )

  // 6. *********** Furnace *************/
  const FurnaceImplFactory = await ethers.getContractFactory('FurnaceP1')
  let furnaceImplAddr = ''
  if (!upgrade) {
    furnaceImplAddr = (await upgrades.deployImplementation(FurnaceImplFactory, {
      kind: 'uups',
    })) as string
  } else {
    furnaceImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.furnace,
      FurnaceImplFactory,
      {
        kind: 'uups',
      }
    )) as string
  }

  furnaceImpl = <FurnaceP1>await ethers.getContractAt('FurnaceP1', furnaceImplAddr)

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'furnace',
    furnaceImpl.address,
    'Furnace',
    prevDeployments.implementations.components.furnace
  )

  // 7. *********** RevenueTrader *************/

  const RevTraderImplFactory = await ethers.getContractFactory('RevenueTraderP1')
  let rsrTraderImplAddr = ''
  let rTokenTraderImplAddr = ''
  if (!upgrade) {
    rsrTraderImplAddr = (await upgrades.deployImplementation(RevTraderImplFactory, {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
    })) as string
    rTokenTraderImplAddr = rsrTraderImplAddr // Both equal in initial deployment
  } else {
    // RSR Trader
    rsrTraderImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.rsrTrader,
      RevTraderImplFactory,
      {
        kind: 'uups',
        unsafeAllow: ['delegatecall'],
      }
    )) as string

    // If Traders have different implementations, upgrade separately
    if (
      prevDeployments.implementations.components.rsrTrader !=
      prevDeployments.implementations.components.rTokenTrader
    ) {
      // RToken Trader
      rTokenTraderImplAddr = (await upgrades.prepareUpgrade(
        prevDeployments.implementations.components.rTokenTrader,
        RevTraderImplFactory,
        {
          kind: 'uups',
          unsafeAllow: ['delegatecall'],
        }
      )) as string
    } else {
      // Both use the same implementation
      rTokenTraderImplAddr = rsrTraderImplAddr
    }
  }

  rsrTraderImpl = <RevenueTraderP1>await ethers.getContractAt('RevenueTraderP1', rsrTraderImplAddr)
  rTokenTraderImpl = <RevenueTraderP1>(
    await ethers.getContractAt('RevenueTraderP1', rTokenTraderImplAddr)
  )

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'rsrTrader',
    rsrTraderImpl.address,
    'RSR Trader',
    prevDeployments.implementations.components.rsrTrader
  )
  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'rTokenTrader',
    rTokenTraderImpl.address,
    'RToken Trader',
    prevDeployments.implementations.components.rTokenTrader
  )

  // 8. *********** RToken *************/
  const RTokenImplFactory = await ethers.getContractFactory('RTokenP1')
  let rTokenImplAddr = ''
  if (!upgrade) {
    rTokenImplAddr = (await upgrades.deployImplementation(RTokenImplFactory, {
      kind: 'uups',
    })) as string
  } else {
    rTokenImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.rToken,
      RTokenImplFactory,
      {
        kind: 'uups',
      }
    )) as string
  }

  rTokenImpl = <RTokenP1>await ethers.getContractAt('RTokenP1', rTokenImplAddr)

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'rToken',
    rTokenImpl.address,
    'RToken',
    prevDeployments.implementations.components.rToken
  )

  // 9. *********** StRSR *************/

  const StRSRImplFactory = await ethers.getContractFactory('StRSRP1Votes')
  let stRSRImplAddr = ''
  if (!upgrade) {
    stRSRImplAddr = (await upgrades.deployImplementation(StRSRImplFactory, {
      kind: 'uups',
    })) as string
  } else {
    stRSRImplAddr = (await upgrades.prepareUpgrade(
      prevDeployments.implementations.components.stRSR,
      StRSRImplFactory,
      {
        kind: 'uups',
      }
    )) as string
  }

  stRSRImpl = <StRSRP1Votes>await ethers.getContractAt('StRSRP1Votes', stRSRImplAddr)

  writeComponentDeployment(
    deployments,
    deploymentFilename,
    'stRSR',
    stRSRImpl.address,
    'StRSR',
    prevDeployments.implementations.components.stRSR
  )

  console.log(`Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

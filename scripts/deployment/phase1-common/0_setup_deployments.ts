import fs from 'fs'
import hre from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { fileExists, getDeploymentFilename, IDeployments } from '../deployment_utils'

async function main() {
  // ==== Read Configuration ====
  const chainId = await getChainId(hre)

  console.log(`Creating Deployment file for network ${hre.network.name} (${chainId})`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check if deployment file already exists for this chainId
  const deploymentFilename = getDeploymentFilename(chainId)
  if (fileExists(deploymentFilename)) {
    throw new Error(`${deploymentFilename} exists; I won't overwrite it.`)
  }

  // Get RSR Address
  const rsrAddr = networkConfig[chainId].tokens.RSR
  if (!rsrAddr) {
    throw new Error(`Missing address for RSR in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, rsrAddr))) {
    throw new Error(`RSR contract not found in network ${hre.network.name}`)
  }

  // Get RSR Feed Address
  const rsrFeedAddr = networkConfig[chainId].chainlinkFeeds.RSR
  if (!rsrFeedAddr) {
    throw new Error(`Missing address for RSR Feed in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, rsrFeedAddr))) {
    throw new Error(`RSR Feed contract not found in network ${hre.network.name}`)
  }

  // Get AaveLendingPool Address
  const aaveLendPoolAddr = networkConfig[chainId].AAVE_LENDING_POOL
  if (!aaveLendPoolAddr) {
    throw new Error(`Missing address for AAVE_LENDING_POOL in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, aaveLendPoolAddr))) {
    throw new Error(`AAVE_LENDING_POOL contract not found in network ${hre.network.name}`)
  }

  // Get stkAAVE Token Address
  const aaveTokenAddr = networkConfig[chainId].tokens.stkAAVE
  if (!aaveTokenAddr) {
    throw new Error(`Missing address for stkAAVE token in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, aaveTokenAddr))) {
    throw new Error(`STKAAVE contract not found in network ${hre.network.name}`)
  }

  // Get Comptroller Address
  const comptrollerAddr = networkConfig[chainId].COMPTROLLER
  if (!comptrollerAddr) {
    throw new Error(`Missing address for COMPTROLLER in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, comptrollerAddr))) {
    throw new Error(`COMPTROLLER contract not found in network ${hre.network.name}`)
  }

  // Get COMP Token Address
  const compTokenAddr = networkConfig[chainId].tokens.COMP
  if (!compTokenAddr) {
    throw new Error(`Missing address for COMP tokenin network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, compTokenAddr))) {
    throw new Error(`COMP contract not found in network ${hre.network.name}`)
  }

  // Get Gnosis EasyAuction Address
  const gnosisAddr = networkConfig[chainId].GNOSIS_EASY_AUCTION
  if (!gnosisAddr) {
    throw new Error(`Missing address for GNOSIS_EASY_AUCTION in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, gnosisAddr))) {
    throw new Error(`GNOSIS_EASY_AUCTION contract not found in network ${hre.network.name}`)
  }
  // ********************* Output Configuration******************************
  const deployments: IDeployments = {
    prerequisites: {
      RSR: rsrAddr,
      RSR_FEED: rsrFeedAddr,
      AAVE_LENDING_POOL: aaveLendPoolAddr,
      stkAAVE: aaveTokenAddr,
      COMPTROLLER: comptrollerAddr,
      COMP: compTokenAddr,
      GNOSIS_EASY_AUCTION: gnosisAddr,
    },
    rewardableLib: '',
    tradingLib: '',
    facade: '',
    facadeWrite: '',
    deployer: '',
    rsrAsset: '',
    implementations: {
      main: '',
      trade: '',
      components: {
        assetRegistry: '',
        backingManager: '',
        basketHandler: '',
        broker: '',
        distributor: '',
        furnace: '',
        rsrTrader: '',
        rTokenTrader: '',
        rToken: '',
        stRSR: '',
      },
    },
  }
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployment file created for ${hre.network.name} (${chainId}):
    RSR: ${rsrAddr}
    RSR FEED: ${rsrFeedAddr}
    AAVE_LENDING_POOL: ${aaveLendPoolAddr}
    stkAAVE: ${aaveTokenAddr}
    COMPTROLLER: ${comptrollerAddr}
    COMP: ${compTokenAddr}
    GNOSIS_EASY_AUCTION: ${gnosisAddr}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

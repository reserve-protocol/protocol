import fs from 'fs'
import hre from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { fileExists, getDeploymentFilename, IDeployments } from '../common'

async function main() {
  // ==== Read Configuration ====
  const chainId = await getChainId(hre)

  console.log(`Creating Deployment file for network ${hre.network.name} (${chainId})`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check if deployment file already exists for this chainId
  const deploymentFilename = getDeploymentFilename(chainId)
  if (chainId != '31337' && chainId != '3' && fileExists(deploymentFilename)) {
    throw new Error(`${deploymentFilename} exists; I won't overwrite it.`)
  }

  console.log('!!!!', networkConfig[chainId])

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
      GNOSIS_EASY_AUCTION: gnosisAddr,
    },
    tradingLib: '',
    facade: '',
    facets: {
      actFacet: '',
      readFacet: '',
      maxIssuableFacet: '',
    },
    facadeWriteLib: '',
    basketLib: '',
    facadeWrite: '',
    deployer: '',
    rsrAsset: '',
    implementations: {
      main: '',
      trading: {
        gnosisTrade: '',
        dutchTrade: '',
      },
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
    GNOSIS_EASY_AUCTION: ${gnosisAddr}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import fs from 'fs'
import hre from 'hardhat'

import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { fileExists, getDeploymentFilename, IDeployments } from '../common'
import { bn } from '../../../common/numbers'

async function main() {
  // ==== Read Configuration ====
  const chainId = await getChainId(hre)

  console.log(`c Deployment file for network ${hre.network.name} (${chainId})`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check if deployment file already exists for this chainId
  const deploymentFilename = getDeploymentFilename(chainId)
  if (fileExists(deploymentFilename)) {
    throw new Error(`${deploymentFilename} exists; I won't overwrite it.`)
  }

  const deployments: IDeployments = {
    prerequisites: {
      RSR: '',
      RSR_FEED: '',
      GNOSIS_EASY_AUCTION: '',
    },
    rewardableLib: '',
    tradingLib: '',
    permitLib: '',
    oracleLib: '',
    facadeRead: '',
    facadeAct: '',
    facadeWriteLib: '',
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

  let rsrAddr = networkConfig[chainId].tokens.RSR || ''
  let rsrFeedAddr = networkConfig[chainId].chainlinkFeeds.RSR || ''
  let gnosisAddr = networkConfig[chainId].GNOSIS_EASY_AUCTION || ''
  console.log('name', networkConfig[chainId].name, chainId)

  if (!process.env.FORK) {
    console.log('FORK')
    // Deploy RSR prereqiusite      console.log('deploying')
    const { erc20 } = await hre.run('deploy-mock-erc20', {
      name: 'RSR token',
      symbol: 'RSR',
    })
    console.log('set to', erc20)
    rsrAddr = erc20

    // Deploy RSR Feed prereqiusite
    const { feed } = await hre.run('deploy-mock-oracle', {
      decimals: bn('8').toString(),
      answer: bn('1e8').toString(),
    })
    rsrFeedAddr = feed

    // Deploy Gnosis EasyAuction prerequisite
    const { gnosis } = await hre.run('deploy-mock-gnosis')
    gnosisAddr = gnosis
  }

  // Ensure RSR deployed
  console.log('rsrAddr', rsrAddr)
  if (!(await isValidContract(hre, rsrAddr))) {
    throw new Error(`RSR contract not found in network ${hre.network.name}`)
  }

  // Ensure RSR feed deployed
  if (!(await isValidContract(hre, rsrFeedAddr))) {
    throw new Error(`RSR Feed contract not found in network ${hre.network.name}`)
  }

  // Ensure gnosis EasyAuction deployed
  if (!(await isValidContract(hre, gnosisAddr))) {
    throw new Error(`GNOSIS_EASY_AUCTION contract not found in network ${hre.network.name}`)
  }

  deployments.prerequisites.RSR = rsrAddr
  deployments.prerequisites.RSR_FEED = rsrFeedAddr
  deployments.prerequisites.GNOSIS_EASY_AUCTION = gnosisAddr
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

import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../deployment_utils'
import { OracleLib } from '../../../typechain'

let oracleLib: OracleLib

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying OracleLib to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetColldeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  // ******************** Deploy libraries ****************************************/

  // Deploy OracleLib external library
  const OracleLibFactory = await ethers.getContractFactory('OracleLib')
  oracleLib = <OracleLib>await OracleLibFactory.connect(burner).deploy()
  await oracleLib.deployed()
  assetColldeployments.oracleLib = oracleLib.address

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetColldeployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId}):
    OracleLib: ${oracleLib.address}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import hre from 'hardhat'

import { expect } from 'chai'

import { fp } from '../../common/numbers'
import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import {
  getDeploymentFile,
  IAssetCollDeployments,
  getAssetCollDeploymentFilename,
} from '../deployment/common'

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  // Get Assets
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetsColls = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const assets = Object.values(assetsColls.assets)
  const collateral = Object.values(assetsColls.collateral)
  const union = assets.concat(collateral)

  // Confirm each asset's price is near the fallback price
  for (const u of union) {
    const asset = await hre.ethers.getContractAt('IAsset', u)
    const fallbackPrice = await asset.fallbackPrice()
    const currentPrice = await asset.price()
    expect(currentPrice.div(fallbackPrice)).to.be.closeTo(fp('1'), fp('0.1')) // within 10%
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

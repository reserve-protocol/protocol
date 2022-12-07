import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { CollateralStatus } from '../../common/constants'
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

  // Confirm each non-collateral asset's price is near the lot price
  for (const a of assets) {
    console.log(`confirming asset ${a}`)
    const asset = await hre.ethers.getContractAt('Asset', a)
    const lotPrice = await asset.lotPrice()
    const [low] = await asset.price() // {UoA/tok}
    if (low.eq(0)) throw new Error('misconfigured oracle')

    const lower = low.sub(low.div(100)) // 1%
    if (lotPrice.lt(lower) || lotPrice.gt(low)) {
      throw new Error('lot price off')
    }
  }

  // Collateral
  for (const c of collateral) {
    const coll = await hre.ethers.getContractAt('FiatCollateral', c) // they're not, but it'll work
    const erc20 = await hre.ethers.getContractAt('ERC20Mock', await coll.erc20())
    console.log(`confirming collateral for erc20 ${await erc20.symbol()}`)

    if ((await coll.status()) != CollateralStatus.SOUND) throw new Error('collateral unsound')

    const [low] = await coll.price() // {UoA/tok}
    if (low.eq(0)) throw new Error('misconfigured oracle')

    const lotPrice = await coll.lotPrice() // {UoA/tok}
    const lower = low.sub(low.div(100)) // 1%
    if (lotPrice.lt(lower) || lotPrice.gt(low)) {
      throw new Error('lot price off')
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

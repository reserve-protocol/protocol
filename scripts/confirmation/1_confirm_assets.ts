import hre from 'hardhat'

import { bn } from '../../common/numbers'
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

  // Confirm each non-collateral asset's price is near the fallback price
  for (const a of assets) {
    console.log(`confirming asset ${a}`)
    const asset = await hre.ethers.getContractAt('Asset', a)
    const fallbackPrice = await asset.fallbackPrice()
    const [isFallback, currentPrice] = await asset.price(true)
    if (isFallback) throw new Error('misconfigured oracle')

    const lower = currentPrice.sub(currentPrice.div(20))
    const upper = currentPrice.add(currentPrice.div(20))
    if (fallbackPrice.lt(lower) || fallbackPrice.gt(upper)) {
      throw new Error('fallback price >5% off')
    }
  }

  // Collateral
  for (const c of collateral) {
    const coll = await hre.ethers.getContractAt('FiatCollateral', c) // they're not, but it'll work
    const erc20 = await hre.ethers.getContractAt('ERC20Mock', await coll.erc20())
    console.log(`confirming collateral for erc20 ${await erc20.symbol()}`)

    const [isFallback, currentPrice] = await coll.price(true) // {UoA/tok}
    if (isFallback) throw new Error('misconfigured oracle')

    const refPerTok = await coll.refPerTok() // {ref/tok}
    const targetPerRef = await coll.targetPerRef() // {target/ref}
    const pricePerTarget = await coll.pricePerTarget() // {UoA/target}

    // {UoA/tok} ~= {ref/tok} * {target/ref} * {UoA/target}
    const product = refPerTok.mul(targetPerRef).mul(pricePerTarget).div(bn('1e36'))
    const lower = currentPrice.sub(currentPrice.div(100))
    const upper = currentPrice.add(currentPrice.div(100))

    if (product.lt(lower) || product.gt(upper)) {
      throw new Error('a peg is more than 1% off?')
    }

    const fallbackPrice = await coll.fallbackPrice() // {UoA/tok}
    if (fallbackPrice.lt(lower) || fallbackPrice.gt(upper)) {
      throw new Error('a fallback price is >1% off')
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

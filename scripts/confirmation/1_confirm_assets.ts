import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { CollateralStatus, MAX_UINT192 } from '../../common/constants'
import { getLatestBlockTimestamp } from '#/utils/time'
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

  for (const a of assets) {
    console.log(`confirming asset ${a}`)
    const asset = await hre.ethers.getContractAt('Asset', a)
    const [low, high] = await asset.price() // {UoA/tok}
    const timestamp = await getLatestBlockTimestamp(hre)
    if (
      low.eq(0) ||
      low.eq(MAX_UINT192) ||
      high.eq(0) ||
      high.eq(MAX_UINT192) ||
      await asset.lastSave() !== timestamp ||
      await asset.lastSave() !== timestamp
    )
      throw new Error('misconfigured oracle')
  }

  // Collateral
  for (const c of collateral) {
    const coll = await hre.ethers.getContractAt('FiatCollateral', c) // they're not, but it'll work
    const erc20 = await hre.ethers.getContractAt('ERC20Mock', await coll.erc20())
    console.log(`confirming collateral for erc20 ${await erc20.symbol()}`)

    if ((await coll.status()) != CollateralStatus.SOUND) throw new Error('collateral unsound')

    const [low, high] = await coll.price() // {UoA/tok}
    const timestamp = await getLatestBlockTimestamp(hre)
    if (
      low.eq(0) ||
      low.eq(MAX_UINT192) ||
      high.eq(0) ||
      high.eq(MAX_UINT192) ||
      await coll.lastSave() !== timestamp ||
      await coll.lastSave() !== timestamp
    )
      throw new Error('misconfigured oracle')
  }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

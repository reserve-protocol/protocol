import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { getAssetCollDeploymentFilename, getDeploymentFile, getDeploymentFilename, IAssetCollDeployments, IDeployments } from '../../deployment/common'
import { priceTimeout, verifyContract } from '../../deployment/utils'
import { bn, fp } from '../../../common/numbers'
import { PYUSD_MAX_TRADE_VOLUME, PYUSD_ORACLE_ERROR, PYUSD_ORACLE_TIMEOUT } from '#/test/plugins/individual-collateral/aave-v3/constants'

let deployments: IAssetCollDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  deployments = <IAssetCollDeployments>getDeploymentFile(getAssetCollDeploymentFilename(chainId))

  const collat = await hre.ethers.getContractAt('FiatCollateral', deployments.collateral.pyUSD!)

  /** ******************** Verify pyUSD Asset ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.pyUSD,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.pyUSD,
        oracleError: PYUSD_ORACLE_ERROR.toString(),
        erc20: networkConfig[chainId].tokens.pyUSD,
        maxTradeVolume: PYUSD_MAX_TRADE_VOLUME.toString(), // $500k,
        oracleTimeout: PYUSD_ORACLE_TIMEOUT,
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01').add(PYUSD_ORACLE_ERROR).toString(),
        delayUntilDefault: bn('86400').toString(), // 24h
      },
    ],
    'contracts/plugins/assets/FiatCollateral.sol:FiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

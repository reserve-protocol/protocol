import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { arbitrumL2Chains, networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import { ZERO_ADDRESS } from '../../../common/constants'
import { verifyContract } from '../../deployment/utils'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../deployment/common'
import {
  DELAY_UNTIL_DEFAULT,
  ONE_PERCENT_FEE,
} from '../../../test/plugins/individual-collateral/dtf/constants'
import { priceTimeout, getArbOracleError } from '../../deployment/utils'

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********  Verify ARB Demurrage Collateral - ARB  **************************/

  if (!arbitrumL2Chains.includes(hre.network.name)) {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  const oracleError = getArbOracleError(hre.network.name)

  await verifyContract(
    chainId,
    assetCollDeployments.collateral.DMR100ARB,
    [
      {
        erc20: networkConfig[chainId].tokens.ARB,
        targetName: hre.ethers.utils.formatBytes32String('DMR100ARB'),
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ARB, // {UoA/tok}
        oracleError: oracleError.toString(),
        oracleTimeout: bn('86400').toString(), // 24 hr
        maxTradeVolume: fp('1e6').toString(), // $1m,
        defaultThreshold: bn('0'),
        delayUntilDefault: DELAY_UNTIL_DEFAULT,
      },
      {
        isFiat: false,
        targetUnitFeed0: false,
        fee: ONE_PERCENT_FEE,
        feed1: ZERO_ADDRESS,
        timeout1: bn('0'),
        error1: bn('0'),
      },
    ],
    'contracts/plugins/assets/DemurrageCollateral.sol:DemurrageCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

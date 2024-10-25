import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../../../common/configuration'
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
import { priceTimeout } from '../../deployment/utils'

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

  /********  Verify PAXG Demurrage Collateral - PAXG  **************************/

  if (baseL2Chains.includes(hre.network.name) || arbitrumL2Chains.includes(hre.network.name)) {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  const collateral = await hre.ethers.getContractAt(
    'ICollateral',
    assetCollDeployments.collateral.DMR100PAXG!
  )

  await verifyContract(
    chainId,
    assetCollDeployments.collateral.DMR100PAXG,
    [
      {
        erc20: networkConfig[chainId].tokens.PAXG,
        targetName: await collateral.targetName(),
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.XAU, // {UoA/tok}
        oracleError: fp('0.003').toString(), // 0.3%
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

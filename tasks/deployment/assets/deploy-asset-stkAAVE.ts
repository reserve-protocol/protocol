import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { Asset } from '../../../typechain'

task('deploy-asset-stkaave', 'Deploys a specific asset for stkAAVE')
  .addParam('stkAAVE', 'StkAAVE token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('comptroller', 'Comptroller address')
  .addParam('aaveLendingPool', 'Aave Lending Pool address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const aaveAsset = <Asset>(
      await (await hre.ethers.getContractFactory('StakedAaveAsset'))
        .connect(deployer)
        .deploy(params.stkAAVE, params.maxTradeVolume, params.comptroller, params.aaveLendingPool)
    )
    await aaveAsset.deployed()

    console.log(`Deployed stkAAVE Asset to ${hre.network.name} (${chainId}): ${aaveAsset.address}`)

    return { stkAAVEAsset: aaveAsset.address }
  })

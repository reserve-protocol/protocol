import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { Asset } from '../../../typechain'

task('deploy-aave-asset', 'Deploys an Aave Priced Asset')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('comptroller', 'Comptroller address')
  .addParam('aaveLendingPool', 'Aave Lending Pool address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const aaveAsset = <Asset>(
      await (await hre.ethers.getContractFactory('AavePricedAsset'))
        .connect(deployer)
        .deploy(
          params.tokenAddress,
          params.maxTradeVolume,
          params.comptroller,
          params.aaveLendingPool
        )
    )
    await aaveAsset.deployed()

    console.log(`Deployed Aave Asset to ${hre.network.name} (${chainId}): ${aaveAsset.address}`)

    return { aaveAsset: aaveAsset.address }
  })

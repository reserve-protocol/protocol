import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { Asset } from '../../../typechain'

task('deploy-compound-asset', 'Deploys a Compound Priced Asset')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('comptroller', 'Comptroller address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const compoundAsset = <Asset>(
      await (await hre.ethers.getContractFactory('CompoundPricedAsset'))
        .connect(deployer)
        .deploy(params.tokenAddress, params.maxTradeVolume, params.comptroller)
    )
    await compoundAsset.deployed()

    console.log(`Deployed Compound Asset to ${hre.network.name} (${chainId}): ${compoundAsset.address}`)

    return { compoundAsset: compoundAsset.address }
  })

import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { Asset } from '../../../typechain'

task('deploy-asset', 'Deploys an Asset')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('maxOracleTimeout', 'Max Oracle Timeout')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const asset = <Asset>(
      await (await hre.ethers.getContractFactory('Asset'))
        .connect(deployer)
        .deploy(
          params.priceFeed,
          params.tokenAddress,
          params.rewardToken,
          params.maxTradeVolume,
          params.maxOracleTimeout
        )
    )
    await asset.deployed()

    console.log(`Deployed Asset to ${hre.network.name} (${chainId}): ${asset.address}`)

    return { asset: asset.address }
  })

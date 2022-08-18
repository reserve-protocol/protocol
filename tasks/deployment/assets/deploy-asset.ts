import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { Asset } from '../../../typechain'

task('deploy-asset', 'Deploys an Asset')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('tradingMin', 'Trade Range - Min')
  .addParam('tradingMax', 'Trade Range - Max')
  .addParam('oracleTimeout', 'Max Oracle Timeout')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
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
          { min: params.tradingMin, max: params.tradingMax },
          params.oracleTimeout
        )
    )
    await asset.deployed()

    if (!params.noOutput) {
      console.log(`Deployed Asset to ${hre.network.name} (${chainId}): ${asset.address}`)
    }

    return { asset: asset.address }
  })

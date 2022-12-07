import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { Asset } from '../../../typechain'

task('deploy-asset', 'Deploys an Asset')
  .addParam('priceTimeout', 'The amount of time before a price decays to 0')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('oracleError', 'The % error in the price feed as a fix')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max Oracle Timeout')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const asset = <Asset>(
      await (await hre.ethers.getContractFactory('Asset'))
        .connect(deployer)
        .deploy(
          params.priceTimeout,
          params.priceFeed,
          params.oracleError,
          params.tokenAddress,
          params.maxTradeVolume,
          params.oracleTimeout
        )
    )
    await asset.deployed()

    if (!params.noOutput) {
      console.log(`Deployed Asset to ${hre.network.name} (${chainId}): ${asset.address}`)
    }

    return { asset: asset.address }
  })

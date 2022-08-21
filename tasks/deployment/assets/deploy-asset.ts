import { getChainId } from '../../../common/blockchain-utils'
import { task, types } from 'hardhat/config'
import { Asset } from '../../../typechain'

task('deploy-asset', 'Deploys an Asset')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('tradingValMin', 'Trade Range - Min in UoA')
  .addParam('tradingValMax', 'Trade Range - Max in UoA')
  .addParam('tradingAmtMin', 'Trade Range - Min in whole toks')
  .addParam('tradingAmtMax', 'Trade Range - Max in whole toks')
  .addParam('oracleTimeout', 'Max Oracle Timeout')
  .addParam('oracleLibrary', 'Oracle library address')
  .addOptionalParam('noOutput', 'Suppress output', false, types.boolean)
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const asset = <Asset>await (
      await hre.ethers.getContractFactory('Asset', {
        libraries: { OracleLib: params.oracleLibrary },
      })
    )
      .connect(deployer)
      .deploy(
        params.priceFeed,
        params.tokenAddress,
        params.rewardToken,
        {
          minVal: params.tradingValMin,
          maxVal: params.tradingValMax,
          minAmt: params.tradingAmtMin,
          maxAmt: params.tradingAmtMax,
        },
        params.oracleTimeout
      )
    await asset.deployed()

    if (!params.noOutput) {
      console.log(`Deployed Asset to ${hre.network.name} (${chainId}): ${asset.address}`)
    }

    return { asset: asset.address }
  })

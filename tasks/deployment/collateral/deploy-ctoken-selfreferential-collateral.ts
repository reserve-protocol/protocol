import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenSelfReferentialCollateral } from '../../../typechain'

task('deploy-ctoken-selfreferential-collateral', 'Deploys a CToken Self-referential Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('cToken', 'CToken address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('delayUntilDefault', 'Seconds until a default is recognized')
  .addParam('decimals', 'Reference token decimals')
  .addParam('comptroller', 'Comptroller address')
  .addParam('oracleLib', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const CTokenSelfReferentialCollateralFactory = await hre.ethers.getContractFactory(
      'CTokenSelfReferentialCollateral',
      {
        libraries: { OracleLib: params.oracleLib },
      }
    )

    const collateral = <CTokenSelfReferentialCollateral>(
      await CTokenSelfReferentialCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.priceFeed,
        params.cToken,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.delayUntilDefault,
        params.decimals,
        params.comptroller
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CToken Self-referential Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })

import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { ethers } from 'hardhat'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { priceTimeout, oracleTimeout } from '../../utils'

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

  const deployedCollateral: string[] = []
  const revenueHiding = fp('1e-6').toString() // revenueHiding = 0.0001%

  /******** Deploy Morpho - AaveV2 **************************/

  /******** Morpho token vaults **************************/
  console.log(`Deploying morpho token vaults to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)
  const MorphoTokenisedDepositFactory = await ethers.getContractFactory("MorphoAaveV2TokenisedDeposit")
  const maUSDT = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    rewardsDistributor: networkConfig[chainId].MORPHO_REWARDS_DISTRIBUTOR!,
    underlyingERC20: networkConfig[chainId].tokens.USDT!,
    poolToken: networkConfig[chainId].tokens.aUSDT!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  const maUSDC = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    rewardsDistributor: networkConfig[chainId].MORPHO_REWARDS_DISTRIBUTOR!,
    underlyingERC20: networkConfig[chainId].tokens.USDC!,
    poolToken: networkConfig[chainId].tokens.aUSDC!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })
  const maDAI = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    rewardsDistributor: networkConfig[chainId].MORPHO_REWARDS_DISTRIBUTOR!,
    underlyingERC20: networkConfig[chainId].tokens.DAI!,
    poolToken: networkConfig[chainId].tokens.aDAI!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  await maUSDT.deployed()
  await maUSDC.deployed()
  await maDAI.deployed()

  assetCollDeployments.erc20s.maUSDT = maUSDT.address
  assetCollDeployments.erc20s.maUSDC = maUSDC.address
  assetCollDeployments.erc20s.maDAI = maDAI.address

  /******** Morpho collateral **************************/
  const FiatCollateralFactory = await hre.ethers.getContractFactory(
    "MorphoFiatCollateral"
  )
  const stablesOracleError = fp('0.0025') // 0.25%

  {
    const collateral = await FiatCollateralFactory.connect(deployer).deploy({
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDT!,
      oracleError: stablesOracleError.toString(),
      erc20: maUSDT.address,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 1 hr
      targetName: ethers.utils.formatBytes32String("USD"),
      defaultThreshold: stablesOracleError.add(fp("0.01")), // 1.25%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
      revenueHiding
    );
    assetCollDeployments.collateral.maUSDT = collateral.address
    deployedCollateral.push(collateral.address.toString())

  }
  {

    const collateral = await FiatCollateralFactory.connect(deployer).deploy({
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC!,
      oracleError: stablesOracleError.toString(),
      erc20: maUSDC.address,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 1 hr
      targetName: ethers.utils.formatBytes32String("USD"),
      defaultThreshold: stablesOracleError.add(fp("0.01")), // 1.25%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
      revenueHiding
    );
    assetCollDeployments.collateral.maUSDC = collateral.address
    deployedCollateral.push(collateral.address.toString())
  }
  {
    const collateral = await FiatCollateralFactory.connect(deployer).deploy({
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI!,
      oracleError: stablesOracleError.toString(),
      erc20: maDAI.address,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
      targetName: ethers.utils.formatBytes32String("USD"),
      defaultThreshold: stablesOracleError.add(fp("0.01")), // 1.25%
      delayUntilDefault: bn('86400').toString(), // 24h
    },
      revenueHiding
    );
    assetCollDeployments.collateral.maDAI = collateral.address
    deployedCollateral.push(collateral.address.toString())
  }

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
        New deployments: ${deployedCollateral}
        Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

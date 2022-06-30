import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { ContractFactory } from 'ethers'
import { getChainId, isValidContract } from '../../../common/blockchain-utils'
import { ITokens, networkConfig } from '../../../common/configuration'
import { getRTokenConfig } from './rTokenConfig'
import { bn, fp } from '../../../common/numbers'

import {
  getDeploymentFile,
  getDeploymentFilename,
  getRTokenDeploymentFilename,
  IDeployments,
  IRTokenDeployments,
  validatePrerequisites,
} from '../deployment_utils'
import {
  ATokenFiatCollateral,
  ATokenMock,
  Collateral,
  CTokenFiatCollateral,
  CTokenMock,
  StaticATokenLM,
} from '../../../typechain'

// Define the Token to deploy
const RTOKEN_NAME = 'RTKN'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  // Get RToken Configuration
  const rTokenConf = getRTokenConfig(chainId, RTOKEN_NAME)

  console.log(`Deploying Collateral for RToken ${rTokenConf.symbol} to network ${hre.network.name} (${chainId})
  with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check prerequisites
  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  await validatePrerequisites(deployments)

  // Check previous step completed
  const rTokenDeploymentFilename = getRTokenDeploymentFilename(chainId, RTOKEN_NAME)
  const rTokenDeployments = <IRTokenDeployments>getDeploymentFile(rTokenDeploymentFilename)

  // Check FacadeWrite available
  if (!rTokenDeployments.facadeWrite) {
    throw new Error(`Missing FacadeWrite in network ${hre.network.name}`)
  } else if (!(await isValidContract(hre, rTokenDeployments.facadeWrite))) {
    throw new Error(`FacadeWrite contract not found in network ${hre.network.name}`)
  }

  // ******************** Deploy Collaterals with burner ****************************************/

  // General configuration
  const defaultThreshold = fp('0.05') // 5%
  const delayUntilDefault = bn('86400') // 24h

  // Get all collateral
  let allCollateral: string[] = rTokenConf.primaryBasket
  for (const bkpInfo of rTokenConf.backups) {
    allCollateral = allCollateral.concat(bkpInfo.backupCollateral)
  }

  for (const collInfo of allCollateral) {
    // Get type
    const collType = collInfo.split('-')[0]
    const collName = collInfo.split('-')[1] as keyof ITokens

    // TODO: if its an Ethereum address just use it directly, and store in file - skip deploy

    // Check address correctly defined
    if (!networkConfig[chainId].tokens[collName]) {
      throw new Error(`Missing configuration for ${collName} in network: ${hre.network.name}`)
    }

    if (collType == 'aave') {
      const AaveCollateralFactory: ContractFactory = await ethers.getContractFactory(
        'AavePricedFiatCollateral'
      )
      // Get token address
      const tokenAddr = networkConfig[chainId].tokens[collName]
      if (!tokenAddr) {
        throw new Error(`Missing address for ${collName} token in network ${hre.network.name}`)
      }

      const tokenCollateral = <Collateral>(
        await AaveCollateralFactory.deploy(
          tokenAddr,
          rTokenConf.params.maxTradeVolume,
          defaultThreshold,
          delayUntilDefault,
          deployments.prerequisites.COMPTROLLER,
          deployments.prerequisites.AAVE_LENDING_POOL
        )
      )

      rTokenDeployments.collateral[collName] = tokenCollateral.address
    } else if (collType == 'aToken') {
      const StaticATokenFactory: ContractFactory = await ethers.getContractFactory('StaticATokenLM')
      const ATokenCollateralFactory = await ethers.getContractFactory('ATokenFiatCollateral')

      // Deploy ATokens - Wrap in Static AToken
      const aTokenAddr = networkConfig[chainId].tokens[collName]
      if (!aTokenAddr) {
        throw new Error(`Missing address for ${collName} token in network ${hre.network.name}`)
      }

      // Get AToken to retrieve underlying
      const aToken: ATokenMock = <ATokenMock>await ethers.getContractAt('ATokenMock', aTokenAddr)

      const staticAToken: StaticATokenLM = <StaticATokenLM>(
        await StaticATokenFactory.deploy(
          deployments.prerequisites.AAVE_LENDING_POOL,
          aToken.address,
          'Static ' + (await aToken.name()),
          'stat' + (await aToken.symbol())
        )
      )

      const aTokenCollateral = <ATokenFiatCollateral>(
        await ATokenCollateralFactory.deploy(
          staticAToken.address,
          rTokenConf.params.maxTradeVolume,
          defaultThreshold,
          delayUntilDefault,
          await aToken.UNDERLYING_ASSET_ADDRESS(),
          deployments.prerequisites.COMPTROLLER,
          deployments.prerequisites.AAVE_LENDING_POOL,
          deployments.prerequisites.stkAAVE
        )
      )

      rTokenDeployments.collateral[collName] = aTokenCollateral.address
    } else if (collType == 'cToken') {
      const CTokenCollateralFactory = await ethers.getContractFactory('CTokenFiatCollateral')

      const cTokenAddr = networkConfig[chainId].tokens[collName]
      if (!cTokenAddr) {
        throw new Error(`Missing address for ${collName} token in network ${hre.network.name}`)
      }

      // Get CToken to retrieve underlying
      const cToken: CTokenMock = <CTokenMock>await ethers.getContractAt('CTokenMock', cTokenAddr)

      const cTokenCollateral = <CTokenFiatCollateral>(
        await CTokenCollateralFactory.deploy(
          cToken.address,
          rTokenConf.params.maxTradeVolume,
          defaultThreshold,
          delayUntilDefault,
          await cToken.underlying(),
          deployments.prerequisites.COMPTROLLER,
          deployments.prerequisites.COMP
        )
      )
      rTokenDeployments.collateral[collName] = cTokenCollateral.address
    } else {
      throw new Error(`Invalid collateral type: ${collType}`)
    }
  }

  fs.writeFileSync(rTokenDeploymentFilename, JSON.stringify(rTokenDeployments, null, 2))

  console.log(`Deployed collateral for RToken ${RTOKEN_NAME} in ${hre.network.name} (${chainId})
    Collateral: ${JSON.stringify(rTokenDeployments.collateral)}
    Deployment file: ${rTokenDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

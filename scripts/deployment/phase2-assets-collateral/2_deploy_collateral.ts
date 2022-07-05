import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../deployment_utils'
import {
  ATokenMock,
  StaticATokenLM,
} from '../../../typechain'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
  with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  let deployedCollateral: string[] = []

  /********  Deploy DAI Collateral  **************************/
  const { aaveCollateral: daiCollateral } = await hre.run('deploy-aave-collateral', {
    tokenAddress: networkConfig[chainId].tokens.DAI,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    aaveLendingPool: networkConfig[chainId].AAVE_LENDING_POOL,
  })

  assetCollDeployments.collateral.DAI = daiCollateral
  deployedCollateral.push(daiCollateral.toString())

  /********  Deploy aDAI Collateral  **************************/

  // Get AToken to retrieve name and symbol
  const aToken: ATokenMock = <ATokenMock>(
    await hre.ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aDAI as string)
  )

  // Wrap in StaticAToken
  const StaticATokenFactory = await hre.ethers.getContractFactory('StaticATokenLM')
  const staticAToken: StaticATokenLM = <StaticATokenLM>(
    await StaticATokenFactory.connect(burner).deploy(
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      'stat' + (await aToken.symbol())
    )
  )
  console.log(
    `Deployed StaticAToken for aDAI on ${hre.network.name} (${chainId}): ${staticAToken.address} `
  )

  const { aTokenCollateral: aDaiCollateral } = await hre.run('deploy-atoken-collateral', {
    staticAToken: staticAToken.address,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    aaveLendingPool: networkConfig[chainId].AAVE_LENDING_POOL,
    stkAAVE: networkConfig[chainId].tokens.stkAAVE,
  })

  assetCollDeployments.collateral.aDAI = aDaiCollateral
  deployedCollateral.push(aDaiCollateral.toString())

  /********  Deploy cDAI Collateral  **************************/

    const { cTokenCollateral: cDaiCollateral } = await hre.run('deploy-ctoken-collateral', {
      cToken: networkConfig[chainId].tokens.cDAI ,
      maxTradeVolume: fp('1e6').toString(), // max trade volume
      defaultThreshold: fp('0.05').toString(), // 5%
      delayUntilDefault: bn('86400').toString(), // 24h
      comptroller: networkConfig[chainId].COMPTROLLER,
      comp: networkConfig[chainId].tokens.COMP,
    })
  
    assetCollDeployments.collateral.cDAI = cDaiCollateral
    deployedCollateral.push(cDaiCollateral.toString())
    

    /********  Deploy USDC Collateral  **************************/
  const { compoundCollateral: usdcCollateral } = await hre.run('deploy-compound-collateral', {
    tokenAddress: networkConfig[chainId].tokens.USDC,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
  })

  assetCollDeployments.collateral.USDC = usdcCollateral
  deployedCollateral.push(usdcCollateral.toString())

  /**********************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
    New deployments: ${deployedCollateral}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import {
  ATokenFiatCollateral,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FiatCollateral,
  IAToken,
  StaticATokenLM,
} from '../typechain'
import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { networkConfig } from '../common/configuration'
import { ZERO_ADDRESS } from '../common/constants'
import { toBNDecimals } from '../common/numbers'
import {
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  IAssetCollDeployments,
} from './deployment/deployment_utils'
import { bn, fp } from '../common/numbers'
import { whileImpersonating } from '../test/utils/impersonation'

async function main() {
  // ==== Read Configuration ====
  const chainId = await getChainId(hre)

  // Address to be used as external owner/user

  const OWNER_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  console.log(`Transfering Balances in network ${hre.network.name} (${chainId})
    to account: ${OWNER_ADDR}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get deployed assets/collateral
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  // Relevant addresses (Mainnet)
  // DAI, USDC,  cDAI, and aDAI Holders
  const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
  const holderUSDC = '0x55fe002aeff02f77364de339a1292923a15844b8'
  const holderCDAI = '0x01ec5e7e03e2835bb2d1ae8d2edded298780129c'
  const holderADAI = '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296'
  const holderRSR = '0x6bab6EB87Aa5a1e4A8310C73bDAAA8A5dAAd81C1'

  // Get assets and tokens for default basket
  const daiCollateral: FiatCollateral = <FiatCollateral>(
    await ethers.getContractAt('FiatCollateral', assetCollDeployments.collateral.DAI as string)
  )
  const usdcCollateral: FiatCollateral = <FiatCollateral>(
    await ethers.getContractAt('FiatCollateral', assetCollDeployments.collateral.USDC as string)
  )
  const aDaiCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
    await ethers.getContractAt(
      'ATokenFiatCollateral',
      assetCollDeployments.collateral.aDAI as string
    )
  )
  const cDaiCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>(
    await ethers.getContractAt(
      'CTokenFiatCollateral',
      assetCollDeployments.collateral.cDAI as string
    )
  )

  const rsr = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', '0x320623b8e4ff03373931769a31fc52a4e78b5d70')
  )

  const dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await daiCollateral.erc20())
  const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await usdcCollateral.erc20())

  const stataDai = <StaticATokenLM>(
    await ethers.getContractAt('StaticATokenLM', await aDaiCollateral.erc20())
  )
  const cDai = <CTokenMock>await ethers.getContractAt('CTokenMock', await cDaiCollateral.erc20())

  // Get plain aToken
  const aDai = <IAToken>(
    await ethers.getContractAt(
      'contracts/plugins/aave/IAToken.sol:IAToken',
      networkConfig[chainId].tokens.aDAI || ''
    )
  )

  console.log(await rsr.balanceOf(OWNER_ADDR))

  console.log(await dai.balanceOf(OWNER_ADDR))
  console.log(await usdc.balanceOf(OWNER_ADDR))
  console.log(await stataDai.balanceOf(OWNER_ADDR))
  console.log(await cDai.balanceOf(OWNER_ADDR))

  const initialBal = bn('250000e18')
 
  // RSR
  await whileImpersonating(holderRSR, async (rsrSigner) => {
    await rsr.connect(rsrSigner).transfer(OWNER_ADDR, initialBal)
  })

  // Setup balances for Owner - Transfer from Mainnet holders DAI, cDAI and aDAI (for default basket)
  // DAI
  await whileImpersonating(holderDAI, async (daiSigner) => {
    await dai.connect(daiSigner).transfer(OWNER_ADDR, initialBal)
  })

  // USDC
  await whileImpersonating(holderUSDC, async (usdcSigner) => {
    await usdc.connect(usdcSigner).transfer(OWNER_ADDR, toBNDecimals(initialBal, 6))
  })
  // aDAI
  await whileImpersonating(holderADAI, async (adaiSigner) => {
    // Wrap ADAI into static ADAI
    await aDai.connect(adaiSigner).approve(stataDai.address, initialBal)
    await stataDai.connect(adaiSigner).deposit(OWNER_ADDR, initialBal, 0, false)
  })
  // cDAI
  await whileImpersonating(holderCDAI, async (cdaiSigner) => {
    await cDai.connect(cdaiSigner).transfer(OWNER_ADDR, toBNDecimals(initialBal, 8).mul(100))
  })

  console.log(await dai.balanceOf(OWNER_ADDR))
  console.log(await usdc.balanceOf(OWNER_ADDR))
  console.log(await stataDai.balanceOf(OWNER_ADDR))
  console.log(await cDai.balanceOf(OWNER_ADDR))

  console.log(`Transferred balances in ${hre.network.name} (${chainId}):
  RSR- From: ${holderRSR} to ${OWNER_ADDR} - Amount: ${initialBal}
  DAI- From: ${holderDAI} to ${OWNER_ADDR} - Amount: ${initialBal}
    USDC- From: ${holderUSDC} to ${OWNER_ADDR} - Amount: ${toBNDecimals(initialBal, 6)}
    aDAI- From: ${holderCDAI} to ${OWNER_ADDR} - Amount: ${initialBal}
    cDAI- From: ${holderADAI} to ${OWNER_ADDR} - Amount: ${toBNDecimals(initialBal, 8).mul(100)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

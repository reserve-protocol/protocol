import { ethers } from 'hardhat'
import { BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { whileImpersonating } from '../../../../utils/impersonation'
import { bn, fp } from '../../../../../common/numbers'
import {
  CurvePoolMock,
  ERC20Mock,
  IStakeDAOVault,
  MockV3Aggregator,
} from '../../../../../typechain'
import {
  USDC,
  USDCPLUS,
  USDCPLUS_USDC_POOL,
  USDCPLUS_ASSET_REGISTRY,
  USDCPLUS_TIMELOCK,
  USDCPLUS_USDC_VAULT,
  USDCPLUS_USDC_TOKEN,
  USDCPLUS_USDC_TOKEN_HOLDER,
} from '../constants'
import { CurveBase } from '../pluginTestTypes'

// ===== USDC/USDC+

export interface WrappedUSDCUSDCPlusFixture {
  usdcplus: ERC20Mock
  usdc: ERC20Mock
  curvePool: CurvePoolMock
  vault: IStakeDAOVault
}

export const makeUSDCUSDCPlus = async (
  usdcplusFeed: MockV3Aggregator
): Promise<WrappedUSDCUSDCPlusFixture> => {
  // Make a fake RTokenAsset and register it with USDC+'s assetRegistry
  const AssetFactory = await ethers.getContractFactory('Asset')
  const mockRTokenAsset = await AssetFactory.deploy(
    bn('604800'),
    usdcplusFeed.address,
    fp('0.01'),
    USDCPLUS,
    fp('1e6'),
    bn('1e1')
  )
  const usdcplusAssetRegistry = await ethers.getContractAt(
    'IAssetRegistry',
    USDCPLUS_ASSET_REGISTRY
  )
  await whileImpersonating(USDCPLUS_TIMELOCK, async (signer) => {
    await usdcplusAssetRegistry.connect(signer).swapRegistered(mockRTokenAsset.address)
  })

  // Use real reference ERC20s
  const usdc = await ethers.getContractAt('ERC20Mock', USDC)
  const usdcplus = await ethers.getContractAt('ERC20Mock', USDCPLUS)

  // Get real USDC+ pool
  const realCurvePool = await ethers.getContractAt('ICurvePool', USDCPLUS_USDC_POOL)

  // Use mock curvePool seeded with initial balances
  const CurveMockFactory = await ethers.getContractFactory('CurvePoolMock')
  const curvePool = await CurveMockFactory.deploy(
    [await realCurvePool.balances(0), await realCurvePool.balances(1)],
    [await realCurvePool.coins(0), await realCurvePool.coins(1)]
  )
  await curvePool.setVirtualPrice(await realCurvePool.get_virtual_price())

  const vault = await ethers.getContractAt('IStakeDAOVault', USDCPLUS_USDC_VAULT)
  return { usdcplus, usdc, curvePool, vault }
}

export const mintUSDCUSDCPlusVault = async (
  ctx: CurveBase,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  const lpToken = await ethers.getContractAt('IStakeDAOVault', USDCPLUS_USDC_TOKEN)
  const vault = await ethers.getContractAt('IStakeDAOVault', USDCPLUS_USDC_VAULT)
  await whileImpersonating(USDCPLUS_USDC_TOKEN_HOLDER, async (signer) => {
    await lpToken.connect(signer).approve(vault.address, amount)
    await vault.connect(signer).deposit(signer.address, amount, true)
    await vault.connect(signer).transfer(recipient, amount)
  })
}

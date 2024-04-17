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
  USDCPLUS_BP_POOL,
  USDCPLUS_ASSET_REGISTRY,
  USDCPLUS_TIMELOCK,
  USDCPLUS_USDC_VAULT,
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
  const realCurvePool = await ethers.getContractAt('ICurvePool', USDCPLUS_BP_POOL)

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
  recipient: string,
  holder: string
) => {
  console.log('1')
  const vault = await ethers.getContractAt('IStakeDAOVault', USDCPLUS_USDC_VAULT)
  console.log('2')
  await whileImpersonating(holder, async (signer) => {
    console.log('3')
    await vault.connect(signer).transfer(recipient, amount)
  })
}

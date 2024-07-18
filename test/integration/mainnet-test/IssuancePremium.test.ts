import { expect } from 'chai'
import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { evmRevert, evmSnapshot } from '../utils'
import { bn, fp } from '../../../common/numbers'
import { IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import forkBlockNumber from '../fork-block-numbers'
import { whileImpersonating } from '../../utils/impersonation'
import {
  AssetRegistryP1,
  BasketHandlerP1,
  EmaPriceOracleStableSwapMock,
  LidoStakedEthCollateral,
  SFraxEthCollateral,
  RethCollateral,
} from '../../../typechain'
import { useEnv } from '#/utils/env'
import { combinedError } from '#/scripts/deployment/utils'

const describeFork = useEnv('FORK') ? describe : describe.skip

const ASSET_REGISTRY_ADDR = '0xf526f058858E4cD060cFDD775077999562b31bE0' // ETH+ asset registry
const BASKET_HANDLER_ADDR = '0x56f40A33e3a3fE2F1614bf82CBeb35987ac10194' // ETH+ basket handler
const BASKET_LIB_ADDR = '0xf383dC60D29A5B9ba461F40A0606870d80d1EA88' // BasketLibP1
const OWNER = '0x5d8A7DC9405F08F14541BA918c1Bf7eb2dACE556' // ETH+ timelock

// run on mainnet only

describeFork(`ETH+ Issuance Premium - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let assetRegistry: AssetRegistryP1
  let basketHandler: BasketHandlerP1
  let chainId: string

  let snap: string

  let oldPrice: BigNumber[] // <4.0.0
  let newPrice: BigNumber[] // >= 4.0.0
  let oldQuantities: BigNumber[] // <4.0.0
  let newQuantities: BigNumber[] // >= 4.0.0

  let sfrxETH: SFraxEthCollateral
  let sfraxEmaOracle: EmaPriceOracleStableSwapMock

  // Setup test environment
  const setup = async (blockNumber: number) => {
    // Use Mainnet fork
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
            blockNumber: blockNumber,
          },
        },
      ],
    })
  }

  before(async () => {
    await setup(forkBlockNumber['mainnet-3.4.0'])

    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    assetRegistry = <AssetRegistryP1>(
      await ethers.getContractAt('AssetRegistryP1', ASSET_REGISTRY_ADDR)
    )
    basketHandler = <BasketHandlerP1>(
      await ethers.getContractAt('BasketHandlerP1', BASKET_HANDLER_ADDR)
    )

    oldPrice = await basketHandler.price()
    oldQuantities = (await basketHandler.quote(fp('1'), 2)).quantities

    // frxETH/ETH EMA oracle
    const currentEmaOracle = await ethers.getContractAt(
      'contracts/plugins/assets/frax-eth/SFraxEthCollateral.sol:IEmaPriceOracleStableSwap',
      networkConfig[chainId].CURVE_POOL_WETH_FRXETH!
    )
    const EmaPriceOracleStableSwapMockFactory = await ethers.getContractFactory(
      'EmaPriceOracleStableSwapMock'
    )
    sfraxEmaOracle = <EmaPriceOracleStableSwapMock>(
      await EmaPriceOracleStableSwapMockFactory.deploy(await currentEmaOracle.price_oracle())
    )

    // === Upgrade to 4.0.0 (minimally)===

    // BasketHandler
    const BasketHandlerFactory = await ethers.getContractFactory('BasketHandlerP1', {
      libraries: {
        BasketLibP1: BASKET_LIB_ADDR,
      },
    })
    const newBasketHandlerImpl = await BasketHandlerFactory.deploy()

    // SFraxEthCollateral
    const SFraxEthCollateralFactory = await hre.ethers.getContractFactory('SFraxEthCollateral')
    let oracleError = combinedError(fp('0.005'), fp('0.0002')) // 0.5% & 0.02%
    const newSfrxETH = <SFraxEthCollateral>await SFraxEthCollateralFactory.deploy(
      {
        priceTimeout: '604800',
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH!,
        oracleError: oracleError.toString(),
        erc20: networkConfig[chainId].tokens.sfrxETH!,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '3600', // 1 hr
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(oracleError).toString(), // ~2.5%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4').toString(), // revenueHiding = 0.01%
      sfraxEmaOracle.address
    )
    sfrxETH = newSfrxETH
    await sfrxETH.refresh()

    // LidoStakedEthCollateral
    const WSTETHCollateralFactory = await hre.ethers.getContractFactory('LidoStakedEthCollateral')
    const newWstETH = <LidoStakedEthCollateral>await WSTETHCollateralFactory.deploy(
      {
        priceTimeout: '604800',
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.stETHUSD!,
        oracleError: fp('0.01').toString(), // 1%: only for stETHUSD feed
        erc20: networkConfig[chainId].tokens.wstETH!,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '3600', // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.025').toString(), // 2.5% = 2% + 0.5% stethEth feed oracleError
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4').toString(), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.stETHETH!, // targetPerRefChainlinkFeed
      '86400' // targetPerRefChainlinkTimeout
    )
    await newWstETH.refresh()

    // RethCollateral
    const RethCollateralFactory = await hre.ethers.getContractFactory('RethCollateral')
    oracleError = combinedError(fp('0.005'), fp('0.02')) // 0.5% & 2%
    const newRETH = <RethCollateral>await RethCollateralFactory.deploy(
      {
        priceTimeout: '604800',
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH!,
        oracleError: oracleError.toString(), // 1%: only for rETH feed
        erc20: networkConfig[chainId].tokens.rETH!,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '3600', // 1 hr,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.02').add(oracleError).toString(), // ~4.5%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      fp('1e-4').toString(), // revenueHiding = 0.01%
      networkConfig[chainId].chainlinkFeeds.rETH!,
      '86400' // refPerTokChainlinkTimeout
    )
    await newRETH.refresh()

    // Putting it all together...
    await whileImpersonating(OWNER, async (timelockSigner) => {
      await basketHandler.connect(timelockSigner).upgradeTo(newBasketHandlerImpl.address)
      await assetRegistry.connect(timelockSigner).swapRegistered(newSfrxETH.address)
      await assetRegistry.connect(timelockSigner).swapRegistered(newWstETH.address)
      await assetRegistry.connect(timelockSigner).swapRegistered(newRETH.address)
    })
    await basketHandler.refreshBasket()
    expect(await basketHandler.status()).to.equal(0)
    expect(await basketHandler.fullyCollateralized()).to.equal(true)

    newPrice = await basketHandler.price()
    newQuantities = (await basketHandler.quote(fp('1'), 2)).quantities

    snap = await evmSnapshot() // what are testing frameworks for if not this in all its glory
  })

  beforeEach(async () => {
    await evmRevert(snap)
    snap = await evmSnapshot()
  })

  after(async () => {
    await evmRevert(snap)
  })

  it('from 3.4.0 to 4.0.0', async () => {
    // this test case compares the state before the 4.0.0 upgrade to the state after the 4.0.0 upgrade
    // Issuance costs rise ~0.04% due to sfrxETH's ~0.12% premium

    const lowPriceChange = newPrice[0].sub(oldPrice[0]).mul(fp('1')).div(oldPrice[0])
    const highPriceChange = newPrice[1].sub(oldPrice[1]).mul(fp('1')).div(oldPrice[1])
    expect(lowPriceChange).to.be.closeTo(fp('-0.000008'), fp('1e-6')) // low price -0.0008%
    expect(highPriceChange).to.be.closeTo(fp('0.000437'), fp('1e-6')) // high price +0.04%

    const sfrxETHChange = newQuantities[0].sub(oldQuantities[0]).mul(fp('1')).div(oldQuantities[0])
    const wstETHChange = newQuantities[1].sub(oldQuantities[1]).mul(fp('1')).div(oldQuantities[1])
    const rETHChange = newQuantities[2].sub(oldQuantities[2]).mul(fp('1')).div(oldQuantities[2])
    expect(sfrxETHChange).to.be.closeTo(fp('0.001201'), fp('1e-6')) // sFraxETH +0.12%
    expect(wstETHChange).to.be.closeTo(fp('0.000126'), fp('1e-6')) // wstETH +0.012%
    expect(rETHChange).to.be.equal(0) // rETH no change
  })

  it('from 4.0.0 to 4.0.0 at-peg', async () => {
    // this test case compares the state after the 4.0.0 upgrade to the state when frxETH is at peg
    // issuance costs fall by 0.042 bps, which is not noticeable

    await sfraxEmaOracle.setPrice(fp('1'))

    const parPrice = await basketHandler.price()
    const parQs = (await basketHandler.quote(fp('1'), 2)).quantities

    const lowPriceChange = parPrice[0].sub(newPrice[0]).mul(fp('1')).div(newPrice[0])
    const highPriceChange = parPrice[1].sub(newPrice[1]).mul(fp('1')).div(newPrice[1])
    expect(lowPriceChange).to.be.closeTo(fp('0.000411'), fp('1e-6')) // low price +0.04%
    expect(highPriceChange).to.be.closeTo(fp('-0.000042'), fp('1e-6')) // high price -0.0004%

    const sfrxETHChange = parQs[0].sub(newQuantities[0]).mul(fp('1')).div(newQuantities[0])
    const wstETHChange = parQs[1].sub(newQuantities[1]).mul(fp('1')).div(newQuantities[1])
    const rETHChange = parQs[2].sub(newQuantities[2]).mul(fp('1')).div(newQuantities[2])
    expect(sfrxETHChange).to.be.closeTo(fp('-0.00122654'), fp('1e-6')) // sFraxETH -0.12%%
    expect(wstETHChange).to.be.closeTo(fp('-0.0001267'), fp('1e-6')) // wstETH -0.01%
    expect(rETHChange).to.be.equal(0) // rETH no change
  })

  it('from 4.0.0 at-peg to 2% below peg', async () => {
    // this test case compares the state from at-peg to the state after a 2% de-peg of frxETH, within the default threshold
    // issuance costs do not change since the premium compensates

    await sfraxEmaOracle.setPrice(fp('1'))

    const parPrice = await basketHandler.price()
    const parQs = (await basketHandler.quote(fp('1'), 2)).quantities

    // de-peg by 2%

    await sfraxEmaOracle.setPrice(fp('0.98'))
    await sfrxETH.refresh()
    expect(await sfrxETH.savedPegPrice()).to.equal(fp('0.98'))

    const depeggedPrice = await basketHandler.price()
    const depeggedQs = (await basketHandler.quote(fp('1'), 2)).quantities

    const lowPriceChange = depeggedPrice[0].sub(parPrice[0]).mul(fp('1')).div(parPrice[0])
    const highPriceChange = depeggedPrice[1].sub(parPrice[1]).mul(fp('1')).div(parPrice[1])
    expect(lowPriceChange).to.be.closeTo(fp('-0.006706'), fp('1e-6')) // low price -0.67%
    expect(highPriceChange).be.closeTo(0, fp('1e-6')) // high price no change

    const sfrxETHChange = depeggedQs[0].sub(parQs[0]).mul(fp('1')).div(parQs[0])
    const wstETHChange = depeggedQs[1].sub(parQs[1]).mul(fp('1')).div(parQs[1])
    const rETHChange = depeggedQs[2].sub(parQs[2]).mul(fp('1')).div(parQs[2])
    expect(sfrxETHChange).to.be.closeTo(fp('0.020408'), fp('1e-6')) // sFraxETH +2%
    expect(wstETHChange).to.be.closeTo(0, fp('1e-6')) // wstETH no change
    expect(rETHChange).to.be.equal(0) // rETH no change
  })

  it('from 4.0.0 at-peg to 50% below peg', async () => {
    // this test case compares the state from at-peg to the state after a 50% de-peg of frxETH
    // issuance costs do not change in USD terms, but sfrxETH increases quantities 100% to compensate

    await sfraxEmaOracle.setPrice(fp('1'))

    const parPrice = await basketHandler.price()
    const parQs = (await basketHandler.quote(fp('1'), 2)).quantities

    // de-peg by 50%

    await sfraxEmaOracle.setPrice(fp('0.5'))
    await sfrxETH.refresh()
    expect(await sfrxETH.savedPegPrice()).to.equal(fp('0.5'))

    const depeggedPrice = await basketHandler.price()
    const depeggedQs = (await basketHandler.quote(fp('1'), 2)).quantities

    const lowPriceChange = depeggedPrice[0].sub(parPrice[0]).mul(fp('1')).div(parPrice[0])
    const highPriceChange = depeggedPrice[1].sub(parPrice[1]).mul(fp('1')).div(parPrice[1])
    expect(lowPriceChange).to.be.closeTo(fp('-0.167646'), fp('1e-6')) // low price -16.7%
    expect(highPriceChange).be.closeTo(0, fp('1e-6')) // high price no change

    const sfrxETHChange = depeggedQs[0].sub(parQs[0]).mul(fp('1')).div(parQs[0])
    const wstETHChange = depeggedQs[1].sub(parQs[1]).mul(fp('1')).div(parQs[1])
    const rETHChange = depeggedQs[2].sub(parQs[2]).mul(fp('1')).div(parQs[2])
    expect(sfrxETHChange).to.be.closeTo(fp('1'), fp('1e-6')) // sFraxETH +100%
    expect(wstETHChange).to.be.closeTo(0, fp('1e-6')) // wstETH -0.12%
    expect(rETHChange).to.be.equal(0) // rETH no change
  })
})

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
  EmaPriceOracleStableSwapMock,
  LidoStakedEthCollateral,
  RTokenAsset,
  SFraxEthCollateral,
  TestIBasketHandler,
  RethCollateral,
} from '../../../typechain'
import { useEnv } from '#/utils/env'
import { combinedError } from '#/scripts/deployment/utils'

const describeFork = useEnv('FORK') ? describe : describe.skip

const ASSET_REGISTRY_ADDR = '0xf526f058858E4cD060cFDD775077999562b31bE0' // ETH+ asset registry
const BASKET_HANDLER_ADDR = '0x56f40A33e3a3fE2F1614bf82CBeb35987ac10194' // ETH+ basket handler
const BASKET_LIB_ADDR = '0xf383dC60D29A5B9ba461F40A0606870d80d1EA88' // BasketLibP1
const RTOKEN_ASSET_ADDR = '0x3f11C47E7ed54b24D7EFC222FD406d8E1F49Fb69' // ETH+ RTokenAsset
const OWNER = '0x5d8A7DC9405F08F14541BA918c1Bf7eb2dACE556' // ETH+ timelock

// run on mainnet only

describeFork(`ETH+ Issuance Premium - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let assetRegistry: AssetRegistryP1
  let basketHandler: TestIBasketHandler
  let rTokenAsset: RTokenAsset
  let chainId: string

  let snap: string

  let oldRTokenPrice: BigNumber[] // <4.0.0
  let newRTokenPrice: BigNumber[] // >= <4.0.0
  let oldPrice: BigNumber[] // <4.0.0
  let newPriceF: BigNumber[] // >= 4.0.0 price(false)
  let newPriceT: BigNumber[] // >= 4.0.0 price(true)
  let oldQs: BigNumber[] // <4.0.0 quantities
  let newQs: BigNumber[] // >= 4.0.0 quantities

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
    basketHandler = <TestIBasketHandler>(
      await ethers.getContractAt('TestIBasketHandler', BASKET_HANDLER_ADDR)
    )
    rTokenAsset = <RTokenAsset>await ethers.getContractAt('RTokenAsset', RTOKEN_ASSET_ADDR)

    const oldBasketHandler = await ethers.getContractAt('BasketHandlerP1', BASKET_HANDLER_ADDR)
    oldRTokenPrice = await rTokenAsset.price()
    oldPrice = await oldBasketHandler['price()']()
    oldQs = (await oldBasketHandler['quote(uint192,uint8)'](fp('1'), 2)).quantities

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

    // RTokenAsset
    const RTokenAssetFactory = await ethers.getContractFactory('RTokenAsset')
    rTokenAsset = await RTokenAssetFactory.deploy(
      await rTokenAsset.erc20(),
      await rTokenAsset.maxTradeVolume()
    )

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
      const bh = await ethers.getContractAt('BasketHandlerP1', BASKET_HANDLER_ADDR)
      await bh.connect(timelockSigner).upgradeTo(newBasketHandlerImpl.address)
      await assetRegistry.connect(timelockSigner).swapRegistered(newSfrxETH.address)
      await assetRegistry.connect(timelockSigner).swapRegistered(newWstETH.address)
      await assetRegistry.connect(timelockSigner).swapRegistered(newRETH.address)
      await assetRegistry.connect(timelockSigner).swapRegistered(rTokenAsset.address)
      await basketHandler.connect(timelockSigner).setIssuancePremiumEnabled(true)
    })
    await basketHandler.refreshBasket()
    expect(await basketHandler.status()).to.equal(0)
    expect(await basketHandler.fullyCollateralized()).to.equal(true)

    newRTokenPrice = await rTokenAsset.price()
    newPriceF = await basketHandler.price(false)
    newPriceT = await basketHandler.price(true)
    newQs = (await basketHandler.quote(fp('1'), true, 2)).quantities

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
    // USD issuance costs rise ~0.04% due to sfrxETH's ~0.12% premium, as given by basketHandler.price(true)

    // rTokenAsset.price()
    const lowRTokenPriceChange = newRTokenPrice[0]
      .sub(oldRTokenPrice[0])
      .mul(fp('1'))
      .div(oldRTokenPrice[0])
    const highRTokenPriceChange = newRTokenPrice[1]
      .sub(oldRTokenPrice[1])
      .mul(fp('1'))
      .div(oldRTokenPrice[1])
    expect(lowRTokenPriceChange).to.be.closeTo(fp('0'), fp('1e-4')) // low RToken price no change
    expect(highRTokenPriceChange).to.be.closeTo(fp('0.0004'), fp('1e-4')) // high RToken price +0.04%

    // basketHandler.price(false)
    const lowPriceChangeF = newPriceF[0].sub(oldPrice[0]).mul(fp('1')).div(oldPrice[0])
    const highPriceChangeF = newPriceF[1].sub(oldPrice[1]).mul(fp('1')).div(oldPrice[1])
    expect(lowPriceChangeF).to.be.closeTo(fp('0'), fp('1e-4')) // low price no change
    expect(highPriceChangeF).to.be.closeTo(fp('0'), fp('1e-4')) // high price no change

    // basketHandler.price(true)
    const lowPriceChangeT = newPriceT[0].sub(oldPrice[0]).mul(fp('1')).div(oldPrice[0])
    const highPriceChangeT = newPriceT[1].sub(oldPrice[1]).mul(fp('1')).div(oldPrice[1])
    expect(lowPriceChangeT).to.be.closeTo(fp('0'), fp('1e-4')) // low price no change
    expect(highPriceChangeT).to.be.closeTo(fp('0.0004'), fp('1e-4')) // high price +0.04%

    // basketHandler.quote()
    const sfrxETHChange = newQs[0].sub(oldQs[0]).mul(fp('1')).div(oldQs[0])
    const wstETHChange = newQs[1].sub(oldQs[1]).mul(fp('1')).div(oldQs[1])
    const rETHChange = newQs[2].sub(oldQs[2]).mul(fp('1')).div(oldQs[2])
    expect(sfrxETHChange).to.be.closeTo(fp('0.0012'), fp('1e-4')) // sFraxETH +0.12%
    expect(wstETHChange).to.be.closeTo(fp('0.0001'), fp('1e-4')) // wstETH +0.01%
    expect(rETHChange).to.be.equal(0) // rETH no change
  })

  it('from 4.0.0 to 4.0.0 at-peg', async () => {
    // this test case compares the state after the 4.0.0 upgrade to the state when frxETH is at peg
    // as given by basketHandler.price(true), USD issuance costs do not change since the premium compensates completely

    await sfraxEmaOracle.setPrice(fp('1'))

    const parRTokenPrice = await rTokenAsset.price()
    const parPriceF = await basketHandler.price(false)
    const parPriceT = await basketHandler.price(true)
    const parQs = (await basketHandler.quote(fp('1'), true, 2)).quantities

    // rTokenAsset.price()
    const lowRTokenPriceChange = parRTokenPrice[0]
      .sub(newRTokenPrice[0])
      .mul(fp('1'))
      .div(newRTokenPrice[0])
    const highRTokenPriceChange = parRTokenPrice[1]
      .sub(newRTokenPrice[1])
      .mul(fp('1'))
      .div(newRTokenPrice[1])
    expect(lowRTokenPriceChange).to.be.closeTo(fp('0.0004'), fp('1e-4')) // low price +0.04%
    expect(highRTokenPriceChange).to.be.closeTo(fp('0'), fp('1e-4')) // high price no change

    // basketHandler.price(false)
    const lowPriceChangeF = parPriceF[0].sub(newPriceF[0]).mul(fp('1')).div(newPriceF[0])
    const highPriceChangeF = parPriceF[1].sub(newPriceF[1]).mul(fp('1')).div(newPriceF[1])
    expect(lowPriceChangeF).to.be.closeTo(fp('0.0004'), fp('1e-4')) // low price +0.04%
    expect(highPriceChangeF).to.be.closeTo(fp('0.0004'), fp('1e-4')) // high price +0.04%%

    // basketHandler.price(true)
    const lowPriceChangeT = parPriceT[0].sub(newPriceT[0]).mul(fp('1')).div(newPriceT[0])
    const highPriceChangeT = parPriceT[1].sub(newPriceT[1]).mul(fp('1')).div(newPriceT[1])
    expect(lowPriceChangeT).to.be.closeTo(fp('0.0004'), fp('1e-4')) // low price +0.04%
    expect(highPriceChangeT).to.be.closeTo(fp('0'), fp('1e-4')) // high price no change

    // basketHandler.quote()
    const sfrxETHChange = parQs[0].sub(newQs[0]).mul(fp('1')).div(newQs[0])
    const wstETHChange = parQs[1].sub(newQs[1]).mul(fp('1')).div(newQs[1])
    const rETHChange = parQs[2].sub(newQs[2]).mul(fp('1')).div(newQs[2])
    expect(sfrxETHChange).to.be.closeTo(fp('-0.0012'), fp('1e-4')) // sFraxETH -0.12%%
    expect(wstETHChange).to.be.closeTo(fp('-0.0001'), fp('1e-4')) // wstETH -0.01%
    expect(rETHChange).to.be.equal(0) // rETH no change
  })

  it('from 4.0.0 at-peg to 2% below peg', async () => {
    // this test case compares the state from at-peg to the state after a 2% de-peg of frxETH
    // which is well within the default threshold.
    // as given by basketHandler.price(true), USD issuance costs do not change since the premium compensates completely

    await sfraxEmaOracle.setPrice(fp('1'))

    const parRTokenPrice = await rTokenAsset.price()
    const parPriceF = await basketHandler.price(false)
    const parPriceT = await basketHandler.price(true)
    const parQs = (await basketHandler.quote(fp('1'), true, 2)).quantities

    // de-peg by 2%

    await sfraxEmaOracle.setPrice(fp('0.98'))
    const depeggedRTokenPrice = await rTokenAsset.price()
    await sfrxETH.refresh()
    expect(await sfrxETH.savedPegPrice()).to.equal(fp('0.98'))

    const depeggedPriceF = await basketHandler.price(false)
    const depeggedPriceT = await basketHandler.price(true)
    const depeggedQs = (await basketHandler.quote(fp('1'), true, 2)).quantities

    // rTokenAsset.price()
    const lowRTokenPriceChange = depeggedRTokenPrice[0]
      .sub(parRTokenPrice[0])
      .mul(fp('1'))
      .div(parRTokenPrice[0])
    const highRTokenPriceChange = depeggedRTokenPrice[1]
      .sub(parRTokenPrice[1])
      .mul(fp('1'))
      .div(parRTokenPrice[1])
    expect(lowRTokenPriceChange).to.be.closeTo(fp('-0.0067'), fp('1e-4')) // low RToken price -0.67%
    expect(highRTokenPriceChange).be.closeTo(fp('-0.0065'), fp('1e-4')) // high RToken -0.66%

    // basketHandler.price(false)
    const lowPriceChangeF = depeggedPriceF[0].sub(parPriceF[0]).mul(fp('1')).div(parPriceF[0])
    const highPriceChangeF = depeggedPriceF[1].sub(parPriceF[1]).mul(fp('1')).div(parPriceF[1])
    expect(lowPriceChangeF).to.be.closeTo(fp('-0.0067'), fp('1e-4')) // low price -0.67%
    expect(highPriceChangeF).be.closeTo(fp('-0.0065'), fp('1e-4')) // high price -0.66%

    // basketHandler.price(true)
    const lowPriceChangeT = depeggedPriceT[0].sub(parPriceT[0]).mul(fp('1')).div(parPriceT[0])
    const highPriceChangeT = depeggedPriceT[1].sub(parPriceT[1]).mul(fp('1')).div(parPriceT[1])
    expect(lowPriceChangeT).to.be.closeTo(fp('-0.0067'), fp('1e-4')) // low price -0.67%
    expect(highPriceChangeT).be.closeTo(0, fp('1e-4')) // high price no change

    // basketHandler.quote()
    const sfrxETHChange = depeggedQs[0].sub(parQs[0]).mul(fp('1')).div(parQs[0])
    const wstETHChange = depeggedQs[1].sub(parQs[1]).mul(fp('1')).div(parQs[1])
    const rETHChange = depeggedQs[2].sub(parQs[2]).mul(fp('1')).div(parQs[2])
    expect(sfrxETHChange).to.be.closeTo(fp('0.0204'), fp('1e-4')) // sFraxETH +2.04
    expect(wstETHChange).to.be.closeTo(0, fp('1e-4')) // wstETH no change
    expect(rETHChange).to.be.equal(0) // rETH no change
  })

  it('from 4.0.0 at-peg to 50% below peg', async () => {
    // this test case compares the state from at-peg to the state after a 50% de-peg of frxETH
    // as given by basketHandler.price(true), USD issuance costs do not change since the premium compensates completely

    await sfraxEmaOracle.setPrice(fp('1'))

    const parRTokenPrice = await rTokenAsset.price()
    const parPriceF = await basketHandler.price(false)
    const parPriceT = await basketHandler.price(true)
    const parQs = (await basketHandler.quote(fp('1'), true, 2)).quantities

    // de-peg by 50%

    await sfraxEmaOracle.setPrice(fp('0.5'))
    const depeggedRTokenPrice = await rTokenAsset.price()
    await sfrxETH.refresh()
    expect(await sfrxETH.savedPegPrice()).to.equal(fp('0.5'))

    const depeggedPriceF = await basketHandler.price(false)
    const depeggedPriceT = await basketHandler.price(true)
    const depeggedQs = (await basketHandler.quote(fp('1'), true, 2)).quantities

    // rTokenAsset.price()
    const lowRTokenPriceChange = depeggedRTokenPrice[0]
      .sub(parRTokenPrice[0])
      .mul(fp('1'))
      .div(parRTokenPrice[0])
    const highRTokenPriceChange = depeggedRTokenPrice[1]
      .sub(parRTokenPrice[1])
      .mul(fp('1'))
      .div(parRTokenPrice[1])
    expect(lowRTokenPriceChange).to.be.closeTo(fp('-0.1676'), fp('1e-4')) // low RToken price -16.76%
    expect(highRTokenPriceChange).to.be.closeTo(fp('-0.1649'), fp('1e-4')) // high RToken price -16.49%

    // basketHandler.price(false)
    const lowPriceChangeF = depeggedPriceF[0].sub(parPriceF[0]).mul(fp('1')).div(parPriceF[0])
    const highPriceChangeF = depeggedPriceF[1].sub(parPriceF[1]).mul(fp('1')).div(parPriceF[1])
    expect(lowPriceChangeF).to.be.closeTo(fp('-0.1676'), fp('1e-4')) // low price -16.76%
    expect(highPriceChangeF).be.closeTo(fp('-0.1649'), fp('1e-4')) // high price -16.49%

    // basketHandler.price(true)
    const lowPriceChangeT = depeggedPriceT[0].sub(parPriceT[0]).mul(fp('1')).div(parPriceT[0])
    const highPriceChangeT = depeggedPriceT[1].sub(parPriceT[1]).mul(fp('1')).div(parPriceT[1])
    expect(lowPriceChangeT).to.be.closeTo(fp('-0.1676'), fp('1e-4')) // low price -16.76%
    expect(highPriceChangeT).be.closeTo(0, fp('1e-4')) // high price no change

    // basketHandler.quote()
    const sfrxETHChange = depeggedQs[0].sub(parQs[0]).mul(fp('1')).div(parQs[0])
    const wstETHChange = depeggedQs[1].sub(parQs[1]).mul(fp('1')).div(parQs[1])
    const rETHChange = depeggedQs[2].sub(parQs[2]).mul(fp('1')).div(parQs[2])
    expect(sfrxETHChange).to.be.closeTo(fp('1'), fp('1e-4')) // sFraxETH +100%
    expect(wstETHChange).to.be.closeTo(0, fp('1e-4')) // wstETH no change
    expect(rETHChange).to.be.equal(0) // rETH no change
  })
})

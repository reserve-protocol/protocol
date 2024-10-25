import { loadFixture, setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { getLatestBlockTimestamp } from '../utils/time'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import { makeDecayFn } from '../utils/rewards'
import { ethers, upgrades } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp } from '../../common/numbers'
import { setOraclePrice } from '../utils/oracles'
import {
  TEN_BPS_FEE,
  ONE_PERCENT_FEE,
  TWO_PERCENT_FEE,
  FIFTY_BPS_FEE,
} from '../plugins/individual-collateral/dtf/constants'
import {
  Asset,
  BasketLibP1,
  ERC20Mock,
  IAssetRegistry,
  RTokenAsset,
  MockV3Aggregator,
  TestIBackingManager,
  TestIBasketHandler,
  TestIMain,
  TestIRevenueTrader,
  TestIRToken,
  DemurrageCollateral,
} from '../../typechain'
import { advanceTime } from '../utils/time'
import { defaultFixtureNoBasket, IMPLEMENTATION, Implementation } from '../fixtures'
import { CollateralStatus, ZERO_ADDRESS } from '../../common/constants'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1(`Demurrage Collateral - P${IMPLEMENTATION}`, () => {
  const amt = fp('1')

  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  let tokens: ERC20Mock[]
  let collateral: DemurrageCollateral[]
  let initialWeights: BigNumber[]

  let uoaPerTokFeed: MockV3Aggregator
  let uoaPerTargetFeed: MockV3Aggregator
  let targetPerTokFeed: MockV3Aggregator

  let config: IConfig

  let main: TestIMain
  let backingManager: TestIBackingManager
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let bh: TestIBasketHandler
  let rTokenTrader: TestIRevenueTrader
  let rsrTrader: TestIRevenueTrader
  let rsrAsset: Asset
  let rTokenAsset: RTokenAsset

  const calcBasketWeight = async (
    coll: DemurrageCollateral,
    decayedAmt: BigNumber
  ): Promise<BigNumber> => {
    const elapsed = (await getLatestBlockTimestamp()) - (await coll.T0())
    const decayFn = makeDecayFn(await coll.fee())
    return fp('1e18').div(decayFn(decayedAmt, elapsed))
  }

  describe('Demurrage Collateral', () => {
    beforeEach(async () => {
      ;[owner, addr1] = await ethers.getSigners()

      // Deploy fixture
      ;({ assetRegistry, backingManager, config, main, rToken, rTokenTrader, rsrTrader, rsrAsset } =
        await loadFixture(defaultFixtureNoBasket))

      // Setup Factories
      const BasketLibFactory: ContractFactory = await ethers.getContractFactory('BasketLibP1')
      const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()
      const BasketHandlerFactory: ContractFactory = await ethers.getContractFactory(
        'BasketHandlerP1',
        { libraries: { BasketLibP1: basketLib.address } }
      )

      // Replace with reweightable basket handler
      bh = await ethers.getContractAt(
        'TestIBasketHandler',
        (
          await upgrades.deployProxy(
            BasketHandlerFactory,
            [main.address, config.warmupPeriod, true, true],
            {
              initializer: 'init',
              kind: 'uups',
            }
          )
        ).address
      )
      await setStorageAt(main.address, 204, bh.address)
      await setStorageAt(rToken.address, 355, bh.address)
      await setStorageAt(backingManager.address, 302, bh.address)
      await setStorageAt(assetRegistry.address, 201, bh.address)

      // Update RTokenAsset
      const RTokenAssetFactory: ContractFactory = await ethers.getContractFactory('RTokenAsset')
      rTokenAsset = <RTokenAsset>await RTokenAssetFactory.deploy(rToken.address, fp('1e6'))
      await assetRegistry.connect(owner).swapRegistered(rTokenAsset.address)
    })

    context('Asymmetric DMRs', () => {
      beforeEach(async () => {
        const DemurrageCollateralFactory: ContractFactory = await ethers.getContractFactory(
          'DemurrageCollateral'
        )
        const ERC20Factory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
        const ChainlinkFactory: ContractFactory = await ethers.getContractFactory(
          'MockV3Aggregator'
        )

        /*****  Replace the original 4 tokens with 4 demurrage collateral with asymmetric DMRs ***********/
        // The 4 versions of DemurrageCollateral, each with different DMR rate:
        //   1. isFiat = false: {UoA/tok} (no default detection)
        //   2. isFiat = true: {UoA/tok} (/w default detection)
        //   3. targetUnitFeed0 = false: {UoA/tok} and {UoA/target} (/w default detection)
        //   4. targetUnitFeed0 = true: {target/tok} and {UoA/target} (/w default detection)

        tokens = <ERC20Mock[]>(
          await Promise.all([
            ERC20Factory.deploy('NAME1', 'TKN1'),
            ERC20Factory.deploy('NAME2', 'TKN2'),
            ERC20Factory.deploy('NAME3', 'TKN3'),
            ERC20Factory.deploy('NAME4', 'TKN4'),
          ])
        )

        uoaPerTokFeed = <MockV3Aggregator>await ChainlinkFactory.deploy(8, bn('1e8'))
        uoaPerTargetFeed = <MockV3Aggregator>await ChainlinkFactory.deploy(8, bn('1e8'))
        targetPerTokFeed = <MockV3Aggregator>await ChainlinkFactory.deploy(8, bn('1e8'))

        collateral = <DemurrageCollateral[]>await Promise.all([
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[0].address,
              targetName: ethers.utils.formatBytes32String('DMR10USD'),
              priceTimeout: bn('604800'),
              chainlinkFeed: uoaPerTokFeed.address, // {UoA/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: false,
              targetUnitFeed0: false,
              fee: TEN_BPS_FEE,
              feed1: ZERO_ADDRESS,
              timeout1: bn('0'),
              error1: bn('0'),
            }
          ),
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[1].address,
              targetName: ethers.utils.formatBytes32String('DMR50EUR'),
              priceTimeout: bn('604800'),
              chainlinkFeed: uoaPerTokFeed.address, // {UoA/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: true,
              targetUnitFeed0: false,
              fee: FIFTY_BPS_FEE,
              feed1: ZERO_ADDRESS,
              timeout1: bn('0'),
              error1: bn('0'),
            }
          ),
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[2].address,
              targetName: ethers.utils.formatBytes32String('DMR100XAU'),
              priceTimeout: bn('604800'),
              chainlinkFeed: uoaPerTokFeed.address, // {UoA/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: false,
              targetUnitFeed0: false,
              fee: ONE_PERCENT_FEE,
              feed1: uoaPerTargetFeed.address, // {UoA/target}
              timeout1: bn('86400').toString(), // 24 hr
              error1: fp('0.01').toString(), // 1%
            }
          ),
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[3].address,
              targetName: ethers.utils.formatBytes32String('DMR200SPY'),
              priceTimeout: bn('604800'),
              chainlinkFeed: targetPerTokFeed.address, // {target/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: false,
              targetUnitFeed0: true,
              fee: TWO_PERCENT_FEE,
              feed1: uoaPerTargetFeed.address, // {UoA/target}
              timeout1: bn('86400').toString(), // 24 hr
              error1: fp('0.01').toString(), // 1%
            }
          ),
        ])

        for (let i = 0; i < collateral.length; i++) {
          await assetRegistry.connect(owner).register(collateral[i].address)
          await tokens[i].mint(addr1.address, amt)
          await tokens[i].connect(addr1).approve(rToken.address, amt)
        }

        initialWeights = await Promise.all(
          collateral.map((coll) => calcBasketWeight(coll, fp('1')))
        )

        await bh.connect(owner).setPrimeBasket(
          tokens.map((t) => t.address),
          initialWeights
        )
        await bh.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)
        await rToken.connect(addr1).issue(amt)
        expect(await rToken.totalSupply()).to.equal(amt)
        expect(await bh.status()).to.equal(CollateralStatus.SOUND)
        expect(await bh.fullyCollateralized()).to.equal(true)
      })

      it('prices/pegPrices should be correct', async () => {
        for (let i = 0; i < 3; i++) {
          const [low, high, pegPrice] = await collateral[i].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1'))
          expect(pegPrice).to.equal(fp('1'))
        }
        const [low, high, pegPrice] = await collateral[3].tryPrice()
        expect(low.add(high).div(2)).to.equal(fp('1.0001')) // asymmetry from multiplying oracles together
        expect(pegPrice).to.equal(fp('1'))
      })

      it('quantities in basket should start out near fp(1)', async () => {
        const [erc20s, quantities] = await bh.quote(fp('1'), false, 2)
        for (let i = 0; i < collateral.length; i++) {
          expect(erc20s[i]).to.equal(tokens[i].address)
          expect(quantities[i]).to.be.closeTo(fp('1'), fp('1').div(bn('1e5')))
        }
      })

      context('after 1 year', () => {
        beforeEach(async () => {
          await advanceTime(Number(bn('31535940'))) // 1 year - 60s
          await uoaPerTokFeed.updateAnswer(bn('1e8'))
          await uoaPerTargetFeed.updateAnswer(bn('1e8'))
          await targetPerTokFeed.updateAnswer(bn('1e8'))
          await setOraclePrice(rsrAsset.address, bn('1e8'))

          await assetRegistry.refresh()
          expect(await bh.status()).to.equal(CollateralStatus.SOUND)
          expect(await bh.fullyCollateralized()).to.equal(true)
        })

        it('oracle prices shouldnt change', async () => {
          for (let i = 0; i < 3; i++) {
            const [low, high, pegPrice] = await collateral[i].tryPrice()
            expect(low.add(high).div(2)).to.equal(fp('1'))
            expect(pegPrice).to.equal(fp('1'))
          }
          const [low, high, pegPrice] = await collateral[3].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1.0001')) // asymmetry from multiplying oracles together
          expect(pegPrice).to.equal(fp('1'))
        })

        it('RToken quantities should decrease correctly per fee tier: [0.1%, 0.50%, 1%, 2%]', async () => {
          const expected = [fp('0.999'), fp('0.995'), fp('0.99'), fp('0.98')]

          const [erc20s, quantities] = await bh.quote(fp('1'), false, 2)
          for (let i = 0; i < collateral.length; i++) {
            expect(erc20s[i]).to.equal(tokens[i].address)
            expect(quantities[i]).to.be.closeTo(expected[i], expected[i].div(bn('1e6')))
          }
        })

        it('refreshBasket() should not restore the RToken to genesis peg', async () => {
          const [erc20s, quantities] = await bh.quote(fp('1'), false, 2)
          await expect(bh.connect(owner).refreshBasket()).to.emit(bh, 'BasketSet')
          const [newERC20s, newQuantities] = await bh.quote(fp('1'), false, 2)

          expect(await bh.status()).to.equal(CollateralStatus.SOUND)
          expect(await bh.fullyCollateralized()).to.equal(true)
          for (let i = 0; i < collateral.length; i++) {
            expect(erc20s[i]).to.equal(newERC20s[i])
            expect(quantities[i]).to.be.gt(newQuantities[i])
            expect(quantities[i]).to.be.lt(newQuantities[i].add(fp('1e-6')))
          }
        })

        it('setPrimeBasket() should not restore the RToken to genesis peg', async () => {
          // First try refreshBasket() in isolation
          const [erc20s, quantities] = await bh.quote(fp('1'), false, 2)
          await bh.connect(owner).refreshBasket()
          const [newERC20s, newQuantities] = await bh.quote(fp('1'), false, 2)

          expect(await bh.status()).to.equal(CollateralStatus.SOUND)
          expect(await bh.fullyCollateralized()).to.equal(true)
          for (let i = 0; i < collateral.length; i++) {
            expect(erc20s[i]).to.equal(newERC20s[i])
            expect(quantities[i]).to.be.gt(newQuantities[i])
            expect(quantities[i]).to.be.lt(newQuantities[i].add(fp('1e-6')))
          }

          // Then try refreshBasket() after setPrimeBasket()
          await bh.connect(owner).setPrimeBasket(
            tokens.map((t) => t.address),
            initialWeights
          )
          await bh.connect(owner).refreshBasket()
          const [newerERC20s, newerQuantities] = await bh.quote(fp('1'), false, 2)

          expect(await bh.status()).to.equal(CollateralStatus.SOUND)
          expect(await bh.fullyCollateralized()).to.equal(true)
          for (let i = 0; i < collateral.length; i++) {
            expect(erc20s[i]).to.equal(newerERC20s[i])
            expect(quantities[i]).to.be.gt(newerQuantities[i])
            expect(quantities[i]).to.be.lt(newerQuantities[i].add(fp('1e-6')))
          }
        })

        it('should detect default and propagate through to prices/pegPrices correctly', async () => {
          // 1. break uoaPerTokFeed
          await uoaPerTokFeed.updateAnswer(bn('1e8').div(2))
          await assetRegistry.refresh()

          // token1
          let [low, high, pegPrice] = await collateral[0].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('0.5'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[0].status()).to.equal(CollateralStatus.SOUND)

          // token2
          ;[low, high, pegPrice] = await collateral[1].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('0.5'))
          expect(pegPrice).to.equal(fp('0.5'))
          expect(await collateral[1].status()).to.equal(CollateralStatus.IFFY)

          // token3
          ;[low, high, pegPrice] = await collateral[2].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('0.5'))
          expect(pegPrice).to.equal(fp('0.5'))
          expect(await collateral[2].status()).to.equal(CollateralStatus.IFFY)

          // token4
          ;[low, high, pegPrice] = await collateral[3].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1.0001'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[3].status()).to.equal(CollateralStatus.SOUND)

          // 2. break uoaPerTargetFeed
          await uoaPerTokFeed.updateAnswer(bn('1e8'))
          await uoaPerTargetFeed.updateAnswer(bn('1e8').div(2))
          await assetRegistry.refresh()

          // token1
          ;[low, high, pegPrice] = await collateral[0].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[0].status()).to.equal(CollateralStatus.SOUND)

          // token2
          ;[low, high, pegPrice] = await collateral[1].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[1].status()).to.equal(CollateralStatus.SOUND)

          // token3
          ;[low, high, pegPrice] = await collateral[2].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1'))
          expect(pegPrice).to.equal(fp('2'))
          expect(await collateral[2].status()).to.equal(CollateralStatus.IFFY)

          // token4
          ;[low, high, pegPrice] = await collateral[3].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('0.50005'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[3].status()).to.equal(CollateralStatus.SOUND)

          // 3. break targetPerTokFeed
          await uoaPerTargetFeed.updateAnswer(bn('1e8'))
          await targetPerTokFeed.updateAnswer(bn('1e8').div(2))
          await assetRegistry.refresh()

          // token1
          ;[low, high, pegPrice] = await collateral[0].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[0].status()).to.equal(CollateralStatus.SOUND)

          // token2
          ;[low, high, pegPrice] = await collateral[1].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[1].status()).to.equal(CollateralStatus.SOUND)

          // token3
          ;[low, high, pegPrice] = await collateral[2].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('1'))
          expect(pegPrice).to.equal(fp('1'))
          expect(await collateral[2].status()).to.equal(CollateralStatus.SOUND)

          // token4
          ;[low, high, pegPrice] = await collateral[3].tryPrice()
          expect(low.add(high).div(2)).to.equal(fp('0.50005'))
          expect(pegPrice).to.equal(fp('0.5'))
          expect(await collateral[3].status()).to.equal(CollateralStatus.IFFY)
        })

        it('should open revenue auctions with asymmetric tokens and minted RToken', async () => {
          // Forward balances
          const all = tokens.map((t) => t.address)
          all.push(rToken.address)
          await backingManager.forwardRevenue(all)

          // 0th token will have no balance because smallest DMR; rest should have some
          for (let i = 1; i < tokens.length; i++) {
            expect(await tokens[i].balanceOf(rTokenTrader.address)).to.be.gt(0)
            expect(await tokens[i].balanceOf(rsrTrader.address)).to.be.gt(0)
          }
          expect(await rToken.balanceOf(rTokenTrader.address)).to.be.gt(0)
          expect(await rToken.balanceOf(rsrTrader.address)).to.be.gt(0)

          // RTokenTrader should be able to open auctions for tokens[1], tokens[2], and tokens[3], as well as distribute RToken
          await rTokenTrader.manageTokens(
            [tokens[1].address, tokens[2].address, tokens[3].address, rToken.address],
            [0, 0, 0, 0]
          )
          expect(await rTokenTrader.tradesOpen()).to.equal(3)
          await expect(rTokenTrader.manageTokens([tokens[0].address], [0])).to.be.revertedWith(
            '0 balance'
          )

          // RSRTrader should be able to open auctions for tokens[1], tokens[2], and tokens[3], and RToken
          await rsrTrader.manageTokens(
            [tokens[1].address, tokens[2].address, tokens[3].address, rToken.address],
            [0, 0, 0, 0]
          )
          expect(await rsrTrader.tradesOpen()).to.equal(4)
          await expect(rsrTrader.manageTokens([tokens[0].address], [0])).to.be.revertedWith(
            '0 balance'
          )
        })
      })
    })

    context('Symmetric DMRs', () => {
      beforeEach(async () => {
        const DemurrageCollateralFactory: ContractFactory = await ethers.getContractFactory(
          'DemurrageCollateral'
        )
        const ERC20Factory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
        const ChainlinkFactory: ContractFactory = await ethers.getContractFactory(
          'MockV3Aggregator'
        )

        /*****  Replace the original 4 tokens with demurrage collateral with the same DMR rate ***********/
        // The 4 versions of DemurrageCollateral:
        //   1. isFiat = false: {UoA/tok} (no default detection)
        //   2. isFiat = true: {UoA/tok} (/w default detection)
        //   3. targetUnitFeed0 = false: {UoA/tok} and {UoA/target} (/w default detection)
        //   4. targetUnitFeed0 = true: {target/tok} and {UoA/target} (/w default detection)

        tokens = <ERC20Mock[]>(
          await Promise.all([
            ERC20Factory.deploy('NAME1', 'TKN1'),
            ERC20Factory.deploy('NAME2', 'TKN2'),
            ERC20Factory.deploy('NAME3', 'TKN3'),
            ERC20Factory.deploy('NAME4', 'TKN4'),
          ])
        )

        uoaPerTokFeed = <MockV3Aggregator>await ChainlinkFactory.deploy(8, bn('1e8'))
        uoaPerTargetFeed = <MockV3Aggregator>await ChainlinkFactory.deploy(8, bn('1e8'))
        targetPerTokFeed = <MockV3Aggregator>await ChainlinkFactory.deploy(8, bn('1e8'))

        collateral = <DemurrageCollateral[]>await Promise.all([
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[0].address,
              targetName: ethers.utils.formatBytes32String('DMR100USD'),
              priceTimeout: bn('604800'),
              chainlinkFeed: uoaPerTokFeed.address, // {UoA/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: false,
              targetUnitFeed0: false,
              fee: ONE_PERCENT_FEE,
              feed1: ZERO_ADDRESS,
              timeout1: bn('0'),
              error1: bn('0'),
            }
          ),
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[1].address,
              targetName: ethers.utils.formatBytes32String('DMR100EUR'),
              priceTimeout: bn('604800'),
              chainlinkFeed: uoaPerTokFeed.address, // {UoA/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: true,
              targetUnitFeed0: false,
              fee: ONE_PERCENT_FEE,
              feed1: ZERO_ADDRESS,
              timeout1: bn('0'),
              error1: bn('0'),
            }
          ),
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[2].address,
              targetName: ethers.utils.formatBytes32String('DMR100XAU'),
              priceTimeout: bn('604800'),
              chainlinkFeed: uoaPerTokFeed.address, // {UoA/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: false,
              targetUnitFeed0: false,
              fee: ONE_PERCENT_FEE,
              feed1: uoaPerTargetFeed.address, // {UoA/target}
              timeout1: bn('86400').toString(), // 24 hr
              error1: fp('0.01').toString(), // 1%
            }
          ),
          await DemurrageCollateralFactory.deploy(
            {
              erc20: tokens[3].address,
              targetName: ethers.utils.formatBytes32String('DMR100SPY'),
              priceTimeout: bn('604800'),
              chainlinkFeed: targetPerTokFeed.address, // {target/tok}
              oracleError: fp('0.01').toString(), // 1%
              oracleTimeout: bn('86400').toString(), // 24 hr
              maxTradeVolume: fp('1e6').toString(), // $1m,
              defaultThreshold: fp('0.01'),
              delayUntilDefault: bn('86400'),
            },
            {
              isFiat: false,
              targetUnitFeed0: true,
              fee: ONE_PERCENT_FEE,
              feed1: uoaPerTargetFeed.address, // {UoA/target}
              timeout1: bn('86400').toString(), // 24 hr
              error1: fp('0.01').toString(), // 1%
            }
          ),
        ])

        for (let i = 0; i < collateral.length; i++) {
          await assetRegistry.connect(owner).register(collateral[i].address)
          await tokens[i].mint(addr1.address, amt)
          await tokens[i].connect(addr1).approve(rToken.address, amt)
        }

        initialWeights = await Promise.all(
          collateral.map((coll) => calcBasketWeight(coll, fp('1')))
        )

        await bh.connect(owner).setPrimeBasket(
          tokens.map((t) => t.address),
          initialWeights
        )
        await bh.connect(owner).refreshBasket()
        await advanceTime(Number(config.warmupPeriod) + 1)
        await rToken.connect(addr1).issue(amt)
        expect(await rToken.totalSupply()).to.equal(amt)
        expect(await bh.status()).to.equal(CollateralStatus.SOUND)
        expect(await bh.fullyCollateralized()).to.equal(true)
      })

      context('after 1 year', () => {
        beforeEach(async () => {
          await advanceTime(Number(bn('31535940'))) // 1 year - 60s
          await uoaPerTokFeed.updateAnswer(bn('1e8'))
          await uoaPerTargetFeed.updateAnswer(bn('1e8'))
          await targetPerTokFeed.updateAnswer(bn('1e8'))
          await setOraclePrice(rsrAsset.address, bn('1e8'))

          await assetRegistry.refresh()
          expect(await bh.status()).to.equal(CollateralStatus.SOUND)
          expect(await bh.fullyCollateralized()).to.equal(true)
        })

        it('should open revenue auctions with minted RToken', async () => {
          // Forward balances
          const all = tokens.map((t) => t.address)
          all.push(rToken.address)
          await backingManager.forwardRevenue(all)

          // No tokens should have balances at traders
          for (let i = 0; i < tokens.length; i++) {
            expect(await tokens[i].balanceOf(rTokenTrader.address)).to.equal(0)
            expect(await tokens[i].balanceOf(rsrTrader.address)).to.equal(0)
          }

          // RTokenTrader should distribute its RToken
          await rTokenTrader.manageTokens([rToken.address], [0])
          expect(await rTokenTrader.tradesOpen()).to.equal(0)
          await expect(rTokenTrader.manageTokens([tokens[3].address], [0])).to.be.revertedWith(
            '0 balance'
          )

          // RSRTrader should be able to open auctions for RToken
          await rsrTrader.manageTokens([rToken.address], [0])
          expect(await rsrTrader.tradesOpen()).to.equal(1)
          await expect(rsrTrader.manageTokens([tokens[3].address], [0])).to.be.revertedWith(
            '0 balance'
          )
        })
      })
    })
  })
})

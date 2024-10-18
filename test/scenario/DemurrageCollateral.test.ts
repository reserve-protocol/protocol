import { loadFixture, setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp } from '../../common/numbers'
import {
  BasketLibP1,
  ERC20Mock,
  IAssetRegistry,
  MockV3Aggregator,
  TestIBackingManager,
  TestIBasketHandler,
  TestIMain,
  TestIRToken,
  DemurrageCollateral,
} from '../../typechain'
import { advanceTime } from '../utils/time'
import { defaultFixtureNoBasket, IMPLEMENTATION, Implementation } from '../fixtures'
import { CollateralStatus, ZERO_ADDRESS } from '../../common/constants'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

const FIFTY_PERCENT_ANNUALLY = bn('21979552668') // 50% annually

describeP1(`Demurrage Collateral - P${IMPLEMENTATION}`, () => {
  const amt = fp('1')

  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  let tokens: ERC20Mock[]
  let collateral: DemurrageCollateral[]

  let uoaPerTokFeed: MockV3Aggregator
  let uoaPerTargetFeed: MockV3Aggregator
  let targetPerTokFeed: MockV3Aggregator

  let config: IConfig

  let main: TestIMain
  let backingManager: TestIBackingManager
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let bh: TestIBasketHandler

  describe('Demurrage Collateral', () => {
    beforeEach(async () => {
      ;[owner, addr1] = await ethers.getSigners()

      // Deploy fixture
      ;({ assetRegistry, backingManager, config, main, rToken } = await loadFixture(
        defaultFixtureNoBasket
      ))

      // Setup Factories
      const BasketLibFactory: ContractFactory = await ethers.getContractFactory('BasketLibP1')
      const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()
      const BasketHandlerFactory: ContractFactory = await ethers.getContractFactory(
        'BasketHandlerP1',
        { libraries: { BasketLibP1: basketLib.address } }
      )
      const DemurrageCollateralFactory: ContractFactory = await ethers.getContractFactory(
        'DemurrageCollateral'
      )
      const ERC20Factory: ContractFactory = await ethers.getContractFactory('ERC20Mock')
      const ChainlinkFactory: ContractFactory = await ethers.getContractFactory('MockV3Aggregator')

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

      /*****  Replace the original 4 tokens with 4 demurrage collateral ***********/
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
            targetName: ethers.utils.formatBytes32String('DMR5000USD'),
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
            fee: FIFTY_PERCENT_ANNUALLY,
            feed1: ZERO_ADDRESS,
            timeout1: bn('0'),
            error1: bn('0'),
          }
        ),
        await DemurrageCollateralFactory.deploy(
          {
            erc20: tokens[1].address,
            targetName: ethers.utils.formatBytes32String('DMR5000EUR'),
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
            fee: FIFTY_PERCENT_ANNUALLY,
            feed1: ZERO_ADDRESS,
            timeout1: bn('0'),
            error1: bn('0'),
          }
        ),
        await DemurrageCollateralFactory.deploy(
          {
            erc20: tokens[2].address,
            targetName: ethers.utils.formatBytes32String('DMR5000XAU'),
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
            fee: FIFTY_PERCENT_ANNUALLY,
            feed1: uoaPerTargetFeed.address, // {UoA/target}
            timeout1: bn('86400').toString(), // 24 hr
            error1: fp('0.01').toString(), // 1%
          }
        ),
        await DemurrageCollateralFactory.deploy(
          {
            erc20: tokens[3].address,
            targetName: ethers.utils.formatBytes32String('DMR5000SPY'),
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
            fee: FIFTY_PERCENT_ANNUALLY,
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

      await bh.connect(owner).setPrimeBasket(
        tokens.map((t) => t.address),
        [fp('1'), fp('1'), fp('1'), fp('1')]
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

    it('quantities should be correct', async () => {
      const [erc20s, quantities] = await bh.quote(fp('1'), false, 2)
      for (let i = 0; i < collateral.length; i++) {
        expect(erc20s[i]).to.equal(tokens[i].address)
        expect(quantities[i]).to.be.closeTo(fp('1'), fp('1').div(bn('1e5')))
      }
    })

    context('after 1 year', () => {
      beforeEach(async () => {
        await advanceTime(Number(bn('31535955'))) // 1 year - 45s
        await uoaPerTokFeed.updateAnswer(bn('1e8'))
        await uoaPerTargetFeed.updateAnswer(bn('1e8'))
        await targetPerTokFeed.updateAnswer(bn('1e8'))

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

      it('RToken quantities should have decreased ~50%', async () => {
        const [erc20s, quantities] = await bh.quote(fp('1'), false, 2)
        for (let i = 0; i < collateral.length; i++) {
          expect(erc20s[i]).to.equal(tokens[i].address)
          const expected = fp('1').div(2)
          expect(quantities[i]).to.be.closeTo(expected, expected.div(bn('1e6')))
        }
      })

      it('Excess should accrue as revenue', async () => {
        const [bottom] = await bh.basketsHeldBy(backingManager.address)
        expect(bottom).to.be.closeTo(amt.mul(2), amt.div(bn('1e3')))
      })

      it('refreshBasket() should not restore the RToken back genesis peg', async () => {
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
        const [erc20s, quantities] = await bh.quote(fp('1'), false, 2)
        await bh.connect(owner).setPrimeBasket(
          tokens.map((t) => t.address),
          [fp('1'), fp('1'), fp('1'), fp('1')]
        )
        await bh.connect(owner).refreshBasket()
        const [newERC20s, newQuantities] = await bh.quote(fp('1'), false, 2)

        expect(await bh.status()).to.equal(CollateralStatus.SOUND)
        expect(await bh.fullyCollateralized()).to.equal(true)
        for (let i = 0; i < collateral.length; i++) {
          expect(erc20s[i]).to.equal(newERC20s[i])
          expect(quantities[i]).to.be.gt(newQuantities[i])
          expect(quantities[i]).to.be.lt(newQuantities[i].add(fp('1e-6')))
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
    })
  })
})

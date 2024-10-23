import { loadFixture, setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers, upgrades } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp } from '../../common/numbers'
import {
  IAssetRegistry,
  TestIBackingManager,
  TestIRToken,
  SelfReferentialCollateral,
  BasketHandlerP1,
  ERC20Mock,
  MainP1,
  BasketLibP1,
} from '../../typechain'
import { advanceTime } from '../utils/time'
import {
  defaultFixtureNoBasket,
  IMPLEMENTATION,
  Implementation,
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
} from '../fixtures'
import { CollateralStatus } from '../../common/constants'

const makeBasicCollateral = async (symbol: string, target: 'ETH' | 'BTC' | 'USD') => {
  const ERC20Factory = await ethers.getContractFactory('ERC20Mock')
  const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
  const SelfReferentialFactory = await ethers.getContractFactory('SelfReferentialCollateral')

  const erc20 = await ERC20Factory.deploy(symbol + ' Token', symbol)
  const chainlinkFeed = await MockV3AggregatorFactory.deploy(8, bn('1e8'))

  if (target === 'BTC') {
    await chainlinkFeed.updateAnswer(bn('60000e8'))
  } else if (target === 'ETH') {
    await chainlinkFeed.updateAnswer(bn('2500e8'))
  }

  const coll = await SelfReferentialFactory.deploy({
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: chainlinkFeed.address,
    oracleError: ORACLE_ERROR,
    erc20: erc20.address,
    maxTradeVolume: fp('1e6'), // $1m
    oracleTimeout: ORACLE_TIMEOUT,
    targetName: ethers.utils.formatBytes32String(target),
    defaultThreshold: fp('0'), // Unsupported
    delayUntilDefault: bn('86400'), // 24h
  })

  await coll.refresh()

  return [erc20, coll] as const
}

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1(`Basket Normalization Test (Spell)`, () => {
  const amt = fp('1')

  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  let config: IConfig

  let main: MainP1
  let backingManager: TestIBackingManager
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let bh: BasketHandlerP1
  let basketLib: BasketLibP1

  let ethCollateral: SelfReferentialCollateral
  let btcCollateral: SelfReferentialCollateral
  let usdCollateral: SelfReferentialCollateral
  let allCollaterals: [
    SelfReferentialCollateral,
    SelfReferentialCollateral,
    SelfReferentialCollateral
  ]

  let ethERC20: ERC20Mock
  let btcERC20: ERC20Mock
  let usdERC20: ERC20Mock
  let allERC20s: [ERC20Mock, ERC20Mock, ERC20Mock]

  describe('ETH + BTC -> ETH + USD', () => {
    beforeEach(async () => {
      ;[owner, addr1] = await ethers.getSigners()

      // Deploy fixture
      ;({ assetRegistry, backingManager, config, rToken } = await loadFixture(
        defaultFixtureNoBasket
      ))

      // God types in this repo are horrendous
      main = await ethers.getContractAt('MainP1', await rToken.main())

      // Setup Factories
      const BasketLibFactory = await ethers.getContractFactory('BasketLibP1')
      basketLib = await BasketLibFactory.deploy()

      const BasketHandlerFactory = await ethers.getContractFactory('BasketHandlerP1', {
        libraries: {
          BasketLibP1: basketLib.address,
        },
      })

      // Enables reweightable and disables issuance premium
      bh = await ethers.getContractAt(
        'BasketHandlerP1',
        (
          await upgrades.deployProxy(
            BasketHandlerFactory,
            [main.address, config.warmupPeriod, true, false],
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

      // Create collaterals
      ;[ethERC20, ethCollateral] = await makeBasicCollateral('ETH', 'ETH')
      ;[btcERC20, btcCollateral] = await makeBasicCollateral('BTC', 'BTC')
      ;[usdERC20, usdCollateral] = await makeBasicCollateral('USD', 'USD')

      await assetRegistry.connect(owner).register(ethCollateral.address)
      await assetRegistry.connect(owner).register(btcCollateral.address)
      await assetRegistry.connect(owner).register(usdCollateral.address)

      allCollaterals = [ethCollateral, btcCollateral, usdCollateral]
      allERC20s = [ethERC20, btcERC20, usdERC20]

      for (let i = 0; i < allCollaterals.length; i++) {
        await assetRegistry.connect(owner).register(allCollaterals[i].address)
      }

      await bh.connect(owner).setPrimeBasket(
        [ethERC20.address, btcERC20.address], // Assets
        [fp('1'), fp('1')] // Initial Ratio by Quantity: 50% ETH + 50% BTC
      )

      await bh.connect(owner).refreshBasket()
      await advanceTime(Number(config.warmupPeriod) + 1)

      expect(await rToken.totalSupply()).to.equal(0)
      expect(await bh.status()).to.equal(CollateralStatus.SOUND)
      expect(await bh.fullyCollateralized()).to.equal(true)
    })

    it('Issue & Redeem', async () => {
      // Issue
      for (let i = 0; i < allERC20s.length; i++) {
        await allERC20s[i].mint(addr1.address, amt)
        await allERC20s[i].connect(addr1).approve(rToken.address, amt)
      }

      await rToken.connect(addr1).issue(amt)
      expect(await rToken.totalSupply()).to.equal(amt)
      expect(await bh.status()).to.equal(CollateralStatus.SOUND)
      expect(await bh.fullyCollateralized()).to.equal(true)

      // Redeem
      await rToken.connect(addr1).redeem(amt)
      expect(await rToken.totalSupply()).to.equal(0)
      expect(await bh.status()).to.equal(CollateralStatus.SOUND)
      expect(await bh.fullyCollateralized()).to.equal(true)
    })

    it('Spell Act', async () => {
      const SpellFactory = await ethers.getContractFactory('SpellBasketNormalizer', {
        libraries: {
          BasketLibP1: basketLib.address,
        },
      })
      const basketNormalizerSpell = await SpellFactory.deploy()

      const currentBasket = await bh.getPrimeBasket()
      expect(currentBasket.targetAmts[0]).to.equal(fp('1'))
      expect(currentBasket.targetAmts[1]).to.equal(fp('1'))

      const initialPrice = await bh['price(bool)'](false)

      await main.connect(owner).grantRole(await main.OWNER_ROLE(), basketNormalizerSpell.address)
      await basketNormalizerSpell.setNormalizedBasket(
        rToken.address,
        [ethERC20.address, usdERC20.address], // Assets
        [fp('1'), fp('2')] // Next Ratio by Quantity: 33% ETH + 66% USD
      )

      expect(await main.hasRole(await main.OWNER_ROLE(), basketNormalizerSpell.address)).to.be.false

      const nextBasket = await bh.getPrimeBasket()
      expect(nextBasket.targetAmts[0]).to.be.greaterThanOrEqual(fp('24.9'))
      expect(nextBasket.targetAmts[1]).to.be.greaterThanOrEqual(fp('49.9'))
      expect(nextBasket.targetAmts[0]).to.be.lessThanOrEqual(fp('25'))
      expect(nextBasket.targetAmts[1]).to.be.lessThanOrEqual(fp('50'))

      const price = await bh['price(bool)'](false)
      expect(price.low).to.be.closeTo(initialPrice.low, 1)
      expect(price.high).to.be.closeTo(initialPrice.high, 1)
    })
  })
})

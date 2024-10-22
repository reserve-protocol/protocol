import { loadFixture, setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp, toBNDecimals } from '../../common/numbers'
import {
  BasketLibP1,
  ERC20MockDecimals,
  IAssetRegistry,
  TestIBackingManager,
  TestIBasketHandler,
  TestIMain,
  TestIRToken,
  UnpricedCollateral,
} from '../../typechain'
import { advanceTime } from '../utils/time'
import { defaultFixtureNoBasket, IMPLEMENTATION, Implementation } from '../fixtures'
import { CollateralStatus } from '../../common/constants'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1(`Unpriced Collateral - P${IMPLEMENTATION}`, () => {
  const amt = fp('1')

  let owner: SignerWithAddress
  let addr1: SignerWithAddress

  let tokens: ERC20MockDecimals[]
  let collateral: UnpricedCollateral[]
  let decimals: number[]

  let config: IConfig

  let main: TestIMain
  let backingManager: TestIBackingManager
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let bh: TestIBasketHandler

  describe('Unpriced Collateral', () => {
    beforeEach(async () => {
      ;[owner, addr1] = await ethers.getSigners()

      // Deploy fixture
      let erc20s: ERC20MockDecimals[]
      ;({ assetRegistry, backingManager, config, main, rToken, erc20s } = await loadFixture(
        defaultFixtureNoBasket
      ))

      // Setup Factories
      const BasketLibFactory: ContractFactory = await ethers.getContractFactory('BasketLibP1')
      const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()
      const BasketHandlerFactory: ContractFactory = await ethers.getContractFactory(
        'BasketHandlerP1',
        { libraries: { BasketLibP1: basketLib.address } }
      )
      const UnpricedCollateralFactory: ContractFactory = await ethers.getContractFactory(
        'UnpricedCollateral'
      )
      const ERC20Factory: ContractFactory = await ethers.getContractFactory('ERC20MockDecimals')

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

      decimals = [6, 8, 9, 18]

      tokens = <ERC20MockDecimals[]>(
        await Promise.all([
          ERC20Factory.deploy('NAME1', 'TKN1', decimals[0]),
          ERC20Factory.deploy('NAME2', 'TKN2', decimals[1]),
          ERC20Factory.deploy('NAME3', 'TKN3', decimals[2]),
          ERC20Factory.deploy('NAME4', 'TKN4', decimals[3]),
        ])
      )

      collateral = <UnpricedCollateral[]>(
        await Promise.all(tokens.map((t) => UnpricedCollateralFactory.deploy(t.address)))
      )

      for (let i = 0; i < collateral.length; i++) {
        await assetRegistry.connect(owner).register(collateral[i].address)
        await tokens[i].mint(addr1.address, amt)
        await tokens[i].connect(addr1).approve(rToken.address, amt)
      }

      // Append a priced collateral
      tokens.push(erc20s[0])
      await erc20s[0].connect(addr1).mint(addr1.address, amt)
      await erc20s[0].connect(addr1).approve(rToken.address, amt)

      // Set basket to 4 UnpricedCollateral + 1 FiatCollateral, all unique targets
      await bh.connect(owner).setPrimeBasket(
        tokens.map((t) => t.address),
        [fp('1'), fp('1'), fp('1'), fp('1'), fp('1')]
      )
      await bh.connect(owner).refreshBasket()
      await advanceTime(Number(config.warmupPeriod) + 1)
      expect(await rToken.totalSupply()).to.equal(0)
      expect(await bh.status()).to.equal(CollateralStatus.SOUND)
      expect(await bh.fullyCollateralized()).to.equal(true)
    })

    it('collateral interface is correct', async () => {
      for (let i = 0; i < collateral.length; i++) {
        expect(await collateral[i].erc20()).to.equal(tokens[i].address)
        expect(await collateral[i].erc20Decimals()).to.equal(decimals[i])
        expect(await collateral[i].targetName()).to.equal(
          ethers.utils.formatBytes32String(`${await tokens[i].symbol()}`)
        )
        expect(await collateral[i].status()).to.equal(CollateralStatus.SOUND)
        expect(await collateral[i].refPerTok()).to.equal(fp('1'))
        expect(await collateral[i].targetPerRef()).to.equal(fp('1'))
        expect(await collateral[i].savedPegPrice()).to.equal(fp('0'))
        expect(await collateral[i].maxTradeVolume()).to.equal(fp('0'))
        expect(await collateral[i].lastSave()).to.equal(0)
        expect(await collateral[i].bal(addr1.address)).to.equal(
          (await tokens[i].balanceOf(addr1.address)).mul(bn('10').pow(18 - decimals[i]))
        )
      }
    })

    it('should issue and redeem RTokens correctly', async () => {
      // Issue
      await rToken.connect(addr1).issue(amt)
      expect(await rToken.totalSupply()).to.equal(amt)
      expect(await bh.status()).to.equal(CollateralStatus.SOUND)
      expect(await bh.fullyCollateralized()).to.equal(true)
      for (let i = 0; i < collateral.length; i++) {
        expect(await tokens[i].balanceOf(backingManager.address)).to.equal(
          toBNDecimals(amt, decimals[i])
        )
      }

      // Redeem
      await rToken.connect(addr1).redeem(amt)
      expect(await rToken.totalSupply()).to.equal(0)
      expect(await bh.status()).to.equal(CollateralStatus.SOUND)
      expect(await bh.fullyCollateralized()).to.equal(true)
      for (let i = 0; i < collateral.length; i++) {
        expect(await tokens[i].balanceOf(backingManager.address)).to.equal(0)
        expect(await tokens[i].balanceOf(addr1.address)).to.equal(amt)
      }
    })

    it('should not be able to rebalance because never uncollateralized', async () => {
      await rToken.connect(addr1).issue(amt)
      await expect(backingManager.rebalance(0)).to.be.revertedWith('already collateralized')
    })

    it('even IF it were to become undercollateralized by way of a hacked token, rebalance STILL should not haircut', async () => {
      await rToken.connect(addr1).issue(amt)
      expect(await rToken.basketsNeeded()).to.equal(amt)

      await tokens[0].burn(backingManager.address, 1)
      expect(await bh.fullyCollateralized()).to.equal(false)
      await expect(backingManager.rebalance(0)).to.be.revertedWith('BUs unpriced')
    })
  })
})

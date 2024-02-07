import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { CollateralStatus, TradeKind } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { expectRTokenPrice, setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'
import { advanceTime } from '../utils/time'
import {
  ERC20Mock,
  IAssetRegistry,
  FiatCollateral,
  MockV3Aggregator,
  RTokenAsset,
  TestIBackingManager,
  TestIBasketHandler,
  TestIStRSR,
  TestIRToken,
} from '../../typechain'
import {
  defaultFixtureNoBasket,
  IMPLEMENTATION,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.01') // 1%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

describe(`The peg (target/ref) should be arbitrary - P${IMPLEMENTATION}`, () => {
  const pegs = ['1e-9', '0.5', '2', '1e9']

  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Amounts
  const initialBal = bn('1000000e18')
  const issueAmt = initialBal.div(bn('1e9'))

  // Tokens and Assets
  let token0: ERC20Mock
  let collateral0: FiatCollateral
  let token1: ERC20Mock
  let collateral1: FiatCollateral
  let rTokenAsset: RTokenAsset

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let stRSR: TestIStRSR
  let rsr: ERC20Mock
  let rToken: TestIRToken
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({ rsr, stRSR, config, rToken, assetRegistry, backingManager, basketHandler, rTokenAsset } =
      await loadFixture(defaultFixtureNoBasket))

    // Variable-peg ERC20
    token0 = await (await ethers.getContractFactory('ERC20Mock')).deploy('Peg ERC20', 'PERC20')

    // Standard ERC20
    token1 = await (await ethers.getContractFactory('ERC20Mock')).deploy('Peg ERC20', 'PERC20')
    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    collateral1 = await (
      await ethers.getContractFactory('FiatCollateral')
    ).deploy({
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: chainlinkFeed.address,
      oracleError: ORACLE_ERROR,
      erc20: token1.address,
      maxTradeVolume: config.rTokenMaxTradeVolume,
      oracleTimeout: ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: DEFAULT_THRESHOLD,
      delayUntilDefault: DELAY_UNTIL_DEFAULT,
    })

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral1.address)
    await backingManager.grantRTokenAllowance(token1.address)

    // Mint initial balances
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)

    // Stake RSR
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(addr1).approve(stRSR.address, initialBal)
    await stRSR.connect(addr1).stake(initialBal)
  })

  for (let i = 0; i < pegs.length; i++) {
    const pegStr = pegs[i]
    context(`Peg = ${pegStr}`, function () {
      const peg = fp(pegStr)
      const token0Amt = issueAmt.mul(fp('1')).div(peg)
      const token1Amt = issueAmt

      beforeEach(async () => {
        const chainlinkFeed = <MockV3Aggregator>(
          await (await ethers.getContractFactory('MockV3Aggregator')).deploy(18, bn('1e18')) // needs more decimals
        )

        collateral0 = <FiatCollateral>await (
          await ethers.getContractFactory(`NontrivialPegCollateral${i}`)
        ).deploy({
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: chainlinkFeed.address,
          oracleError: ORACLE_ERROR,
          erc20: token0.address,
          maxTradeVolume: config.rTokenMaxTradeVolume,
          oracleTimeout: ORACLE_TIMEOUT,
          targetName: ethers.utils.formatBytes32String('USD'),
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        })

        await assetRegistry.connect(owner).register(collateral0.address)
        await backingManager.grantRTokenAllowance(token0.address)

        await setOraclePrice(collateral0.address, bn('1e18').mul(peg).div(fp('1'))) // 18 decimals

        await basketHandler.setPrimeBasket([token0.address, token1.address], [fp('1'), fp('1')])
        await basketHandler.refreshBasket()
        await advanceTime(config.warmupPeriod.toNumber() + 1)

        // Issue
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await rToken.connect(addr1).issue(issueAmt)
      })

      it('should set quantity correctly', async () => {
        expect(await basketHandler.quantity(token0.address)).to.equal(fp('1').mul(fp('1')).div(peg))
        expect(await basketHandler.quantity(token1.address)).to.equal(fp('1'))
      })

      it('should respect differing scales during issuance', async () => {
        expect(await token0.balanceOf(backingManager.address)).to.equal(token0Amt)
        expect(await token1.balanceOf(backingManager.address)).to.equal(token1Amt)
        expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmt)
      })

      it('should respect differing scales during redemption', async () => {
        await rToken.connect(addr1).redeem(issueAmt)
        expect(await token0.balanceOf(backingManager.address)).to.equal(0)
        expect(await token1.balanceOf(backingManager.address)).to.equal(0)
      })

      it('should not produce revenue', async () => {
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        // sum of target amounts
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('2'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )
        await expect(backingManager.rebalance(TradeKind.BATCH_AUCTION)).to.be.revertedWith(
          'already collateralized'
        )
        await expectEvents(
          backingManager
            .connect(owner)
            .forwardRevenue([token0.address, token1.address, rsr.address, rToken.address]),
          [
            {
              contract: token0,
              name: 'Transfer',
              emitted: false,
            },
            {
              contract: token1,
              name: 'Transfer',
              emitted: false,
            },
            {
              contract: rsr,
              name: 'Transfer',
              emitted: false,
            },
            {
              contract: rToken,
              name: 'Transfer',
              emitted: false,
            },
          ]
        )

        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)
        // sum of target amounts
        await expectRTokenPrice(
          rTokenAsset.address,
          fp('2'),
          ORACLE_ERROR,
          await backingManager.maxTradeSlippage(),
          config.minTradeVolume.mul((await assetRegistry.erc20s()).length)
        )
      })
    })
  }
})

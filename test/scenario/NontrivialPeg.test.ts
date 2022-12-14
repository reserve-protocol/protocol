import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import { setOraclePrice } from '../utils/oracles'
import { expectEvents } from '../../common/events'
import {
  NontrivialPegCollateral,
  ERC20Mock,
  IAssetRegistry,
  IBasketHandler,
  FiatCollateral,
  MockV3Aggregator,
  RTokenAsset,
  OracleLib,
  TestIBackingManager,
  TestIStRSR,
  TestIRToken,
} from '../../typechain'
import { defaultFixture, IMPLEMENTATION, ORACLE_TIMEOUT } from '../fixtures'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

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
  let collateral0: NontrivialPegCollateral
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
  let basketHandler: IBasketHandler
  let oracleLib: OracleLib

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      stRSR,
      config,
      rToken,
      assetRegistry,
      backingManager,
      basketHandler,
      oracleLib,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    // Variable-peg ERC20
    token0 = await (await ethers.getContractFactory('ERC20Mock')).deploy('Peg ERC20', 'PERC20')
    let chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(18, bn('1e18')) // needs more decimals
    )
    collateral0 = await (
      await ethers.getContractFactory('NontrivialPegCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      fp('1'),
      chainlinkFeed.address,
      token0.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT
    )

    // Standard ERC20
    token1 = await (await ethers.getContractFactory('ERC20Mock')).deploy('Peg ERC20', 'PERC20')
    chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, bn('1e8'))
    )
    collateral1 = await (
      await ethers.getContractFactory('FiatCollateral', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      fp('1'),
      chainlinkFeed.address,
      token1.address,
      config.rTokenMaxTradeVolume,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT
    )

    // Basket configuration
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(collateral1.address)
    await backingManager.grantRTokenAllowance(token0.address)
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

  pegs.map((pegStr) => {
    context(`Peg = ${pegStr}`, function () {
      const peg = fp(pegStr)
      const token0Amt = issueAmt.mul(fp('1')).div(peg)
      const token1Amt = issueAmt

      beforeEach(async () => {
        await collateral0.setPeg(peg)
        await setOraclePrice(collateral0.address, bn('1e18').mul(peg).div(fp('1'))) // 18 decimals
        await basketHandler.setPrimeBasket([token0.address, token1.address], [fp('1'), fp('1')])
        await basketHandler.refreshBasket()

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
        expect(await rTokenAsset.strictPrice()).to.equal(fp('2')) // sum of target amounts
        await expectEvents(
          backingManager
            .connect(owner)
            .manageTokens([token0.address, token1.address, rsr.address, rToken.address]),
          [
            {
              contract: backingManager,
              name: 'TradeStarted',
              emitted: false,
            },
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
        expect(await rTokenAsset.strictPrice()).to.equal(fp('2')) // sum of target amounts
      })
    })
  })
})

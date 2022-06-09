import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { BN_SCALE_FACTOR, CollateralStatus } from '../../common/constants'
import { expectEvents } from '../../common/events'
import { bn, fp, pow10, toBNDecimals } from '../../common/numbers'
import {
  AaveLendingPoolMock,
  AaveOracleMock,
  BadERC20,
  CompoundOracleMock,
  ComptrollerMock,
  CTokenMock,
  ERC20Mock,
  Facade,
  GnosisMock,
  IBasketHandler,
  StaticATokenMock,
  TestIAssetRegistry,
  TestIBackingManager,
  TestIRToken,
  TestIStRSR,
  USDCMock,
} from '../../typechain'
import { advanceTime, getLatestBlockTimestamp } from '../utils/time'
import { Collateral, defaultFixture, IConfig, Implementation, IMPLEMENTATION } from '../fixtures'
import snapshotGasCost from '../utils/snapshotGasCost'

const DEFAULT_THRESHOLD = fp('0.05') // 5%
const DELAY_UNTIL_DEFAULT = bn('86400') // 24h

const createFixtureLoader = waffle.createFixtureLoader

const describeGas =
  IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS ? describe : describe.skip

describe(`Bad ERC20 - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let compoundMock: ComptrollerMock
  let compoundOracleInternal: CompoundOracleMock
  let aaveToken: ERC20Mock
  let aaveMock: AaveLendingPoolMock
  let aaveOracleInternal: AaveOracleMock

  // Trading
  let gnosis: GnosisMock

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: BadERC20
  let backupToken: ERC20Mock
  let collateral0: Collateral
  let backupCollateral: Collateral
  let basket: Collateral[]
  let basketsNeededAmts: BigNumber[]

  // Config values
  let config: IConfig

  // Contracts to retrieve after deploy
  let rToken: TestIRToken
  let stRSR: TestIStRSR
  let facade: Facade
  let assetRegistry: TestIAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()
    let erc20s: ERC20Mock[]

      // Deploy fixture
    ;({
      rsr,
      aaveToken,
      compoundMock,
      aaveMock,
      compoundOracleInternal,
      aaveOracleInternal,
      erc20s,
      collateral,
      basket,
      basketsNeededAmts,
      config,
      rToken,
      stRSR,
      gnosis,
      facade,
      assetRegistry,
      backingManager,
      basketHandler,
    } = await loadFixture(defaultFixture))

    // Main ERC20
    token0 = await (await ethers.getContractFactory('BadERC20')).deploy('Bad ERC20', 'BERC20')
    collateral0 = await (
      await ethers.getContractFactory('AavePricedFiatCollateral')
    ).deploy(
      token0.address,
      config.maxTradeVolume,
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT,
      compoundMock.address,
      aaveMock.address
    )

    // Backup
    backupToken = erc20s[2] // USDT
    backupCollateral = <Collateral>collateral[2]

    // Basket configuration
    await aaveOracleInternal.setPrice(token0.address, bn('2.5e14'))
    await assetRegistry.connect(owner).register(collateral0.address)
    await assetRegistry.connect(owner).register(backupCollateral.address)
    await basketHandler.setPrimeBasket([token0.address], [fp('1')])
    await basketHandler.setBackupConfig(ethers.utils.formatBytes32String('USD'), 1, [
      token0.address,
      backupToken.address,
    ])
    await basketHandler.refreshBasket()
    await backingManager.grantRTokenAllowance(token0.address)
    await backingManager.grantRTokenAllowance(backupToken.address)

    // Mint initial balances
    initialBal = bn('1000000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await backupToken.connect(owner).mint(addr1.address, initialBal)
    await token0.connect(owner).mint(addr2.address, initialBal)
    await backupToken.connect(owner).mint(addr2.address, initialBal)
  })

  it('should act normal at first', async () => {
    const issueAmt = initialBal.div(100)
    await token0.connect(addr1).approve(rToken.address, issueAmt)
    await rToken.connect(addr1).issue(issueAmt)
    await rToken.connect(addr1).transfer(addr2.address, issueAmt)
    expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmt)
    await token0.connect(addr2).approve(rToken.address, issueAmt)
    await rToken.connect(addr2).issue(issueAmt)
    expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmt.mul(2))
    expect(await rToken.decimals()).to.equal(18)
  })

  describe('with reverting decimals', function () {
    let issueAmt: BigNumber

    beforeEach(async () => {
      issueAmt = initialBal.div(100)
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await rToken.connect(addr1).issue(issueAmt)
      await token0.setRevertDecimals(true)
    })

    it('should fail safely during issuance', async () => {
      await token0.connect(addr2).approve(rToken.address, issueAmt)
      await expect(rToken.connect(addr2).issue(issueAmt)).to.be.reverted

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr2).issue(issueAmt)
    })

    it('should fail safely during redemption', async () => {
      await expect(rToken.connect(addr1).redeem(issueAmt)).to.be.reverted

      // Should work now
      await token0.setRevertDecimals(false)
      await rToken.connect(addr1).redeem(issueAmt)
    })
  })
})

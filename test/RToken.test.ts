import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { signERC2612Permit } from 'eth-permit'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { IConfig, MAX_ISSUANCE_RATE } from '../common/configuration'
import { BN_SCALE_FACTOR, CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../common/constants'
import { expectEvents } from '../common/events'
import { setOraclePrice } from './utils/oracles'
import { bn, fp, shortString, toBNDecimals } from '../common/numbers'
import {
  ATokenFiatCollateral,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  ERC1271Mock,
  FacadeRead,
  FacadeTest,
  FiatCollateral,
  IAssetRegistry,
  IBasketHandler,
  MockV3Aggregator,
  RTokenAsset,
  RTokenP0,
  RTokenP1,
  StaticATokenMock,
  TestIBackingManager,
  TestIMain,
  TestIRToken,
  USDCMock,
} from '../typechain'
import { whileImpersonating } from './utils/impersonation'
import snapshotGasCost from './utils/snapshotGasCost'
import {
  advanceTime,
  advanceBlocks,
  getLatestBlockNumber,
  getLatestBlockTimestamp,
} from './utils/time'
import {
  Collateral,
  defaultFixture,
  Implementation,
  IMPLEMENTATION,
  SLOW,
  ORACLE_TIMEOUT,
} from './fixtures'
import { cartesianProduct } from './utils/cases'
import { issueMany } from './utils/issue'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS ? describe : describe.skip

const createFixtureLoader = waffle.createFixtureLoader

describe(`RTokenP${IMPLEMENTATION} contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: ATokenFiatCollateral
  let collateral3: CTokenFiatCollateral
  let basket: Collateral[]
  let initialBasketNonce: BigNumber
  let rTokenAsset: RTokenAsset

  // Config values
  let config: IConfig

  // Main
  let main: TestIMain
  let rToken: TestIRToken
  let facade: FacadeRead
  let facadeTest: FacadeTest
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  interface IIssuance {
    amount: BigNumber
    baskets: BigNumber
    basketNonce: BigNumber
    blockAvailableAt: BigNumber
    processed: boolean
  }

  // Implementation-agnostic testing interface for issuances
  const expectUnprocessedIssuance = async (
    account: string,
    index: number,
    issuance: Partial<IIssuance>
  ) => {
    if (IMPLEMENTATION == Implementation.P0) {
      const rTokenP0 = <RTokenP0>await ethers.getContractAt('RTokenP0', rToken.address)
      const [, amount, baskets, basketNonce, blockAvailableAt, processed] =
        await rTokenP0.issuances(account, index)

      if (issuance.amount) expect(amount.toString()).to.eql(issuance.amount.toString())
      if (issuance.baskets) expect(baskets.toString()).to.eql(issuance.baskets.toString())
      if (issuance.basketNonce) {
        expect(basketNonce.toString()).to.eql(issuance.basketNonce.toString())
      }

      if (issuance.blockAvailableAt) {
        expect(blockAvailableAt.toString()).to.eql(issuance.blockAvailableAt.toString())
      }
      if (issuance.processed !== undefined) expect(processed).to.eql(issuance.processed)
    } else if (IMPLEMENTATION == Implementation.P1) {
      const rTokenP1 = <RTokenP1>await ethers.getContractAt('RTokenP1', rToken.address)
      const [basketNonce, left] = await rTokenP1.issueQueues(account)
      const [, amtRTokenPrev, amtBasketsPrev] = await rTokenP1.issueItem(
        account,
        index == 0 ? index : index - 1
      )

      const [when, amtRToken, amtBaskets] = await rTokenP1.issueItem(account, index)

      const amt = index == 0 ? amtRTokenPrev : amtRToken.sub(amtRTokenPrev)
      const baskets = index == 0 ? amtBasketsPrev : amtBaskets.sub(amtBasketsPrev)

      if (issuance.amount) expect(amt.toString()).to.eql(issuance.amount.toString())
      if (issuance.baskets) expect(baskets.toString()).to.eql(issuance.baskets.toString())
      if (issuance.basketNonce) {
        expect(basketNonce.toString()).to.eql(issuance.basketNonce.toString())
      }
      if (issuance.blockAvailableAt) {
        expect(when.toString()).to.eql(issuance.blockAvailableAt.toString())
      }
      if (issuance.processed !== undefined && issuance.processed) expect(left).to.gte(index)
      if (issuance.processed !== undefined && !issuance.processed) expect(left).to.lte(index)
    } else {
      throw new Error('PROTO_IMPL must be set to either `0` or `1`')
    }
  }

  const expectProcessedIssuance = async (account: string, index: number) => {
    if (IMPLEMENTATION == Implementation.P1) {
      const rTokenP1 = <RTokenP1>await ethers.getContractAt('RTokenP1', rToken.address)
      await expect(rTokenP1.issueItem(account, index)).to.be.revertedWith('out of range')
    } else if (IMPLEMENTATION == Implementation.P0) {
      const rTokenP0 = <RTokenP0>await ethers.getContractAt('RTokenP0', rToken.address)
      expect(await rTokenP0.validP1IssueItemIndex(account, index)).to.eql(false)
      await expect(rTokenP0.issuances(account, index)).to.be.reverted
    } else {
      throw new Error('PROTO_IMPL must be set to either `0` or `1`')
    }
  }

  const endIdForVest = async (account: string) => {
    if (IMPLEMENTATION == Implementation.P1) {
      return await facade.endIdForVest(rToken.address, account)
    } else if (IMPLEMENTATION == Implementation.P0) {
      const rTok = await ethers.getContractAt('RTokenP0', rToken.address)
      return await rTok.endIdForVest(account)
    } else {
      throw new Error('PROTO_IMPL must be set to either `0` or `1`')
    }
  }

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      assetRegistry,
      backingManager,
      basket,
      basketHandler,
      config,
      facade,
      facadeTest,
      main,
      rToken,
      rTokenAsset,
    } = await loadFixture(defaultFixture))

    // Get assets and tokens
    collateral0 = <Collateral>basket[0]
    collateral1 = <Collateral>basket[1]
    collateral2 = <ATokenFiatCollateral>basket[2]
    collateral3 = <CTokenFiatCollateral>basket[3]
    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <USDCMock>await ethers.getContractAt('USDCMock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())

    initialBasketNonce = BigNumber.from(await basketHandler.nonce())

    // Mint initial balances
    initialBal = bn('40000e18')
    await token0.connect(owner).mint(addr1.address, initialBal)
    await token1.connect(owner).mint(addr1.address, initialBal)
    await token2.connect(owner).mint(addr1.address, initialBal)
    await token3.connect(owner).mint(addr1.address, initialBal)

    await token0.connect(owner).mint(addr2.address, initialBal)
    await token1.connect(owner).mint(addr2.address, initialBal)
    await token2.connect(owner).mint(addr2.address, initialBal)
    await token3.connect(owner).mint(addr2.address, initialBal)
  })

  describe('Deployment #fast', () => {
    it('Deployment should setup RToken correctly', async () => {
      expect(await rToken.name()).to.equal('RTKN RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.basketsNeeded()).to.equal(0)

      // Check RToken price
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)
      await rToken.connect(addr1).issue(fp('1'))
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
    })

    it('Should setup the DomainSeparator for Permit correctly', async () => {
      const chainId = await getChainId(hre)
      const _name = await rToken.name()
      const version = '1'
      const verifyingContract = rToken.address
      expect(await rToken.DOMAIN_SEPARATOR()).to.equal(
        await ethers.utils._TypedDataEncoder.hashDomain({
          name: _name,
          version,
          chainId,
          verifyingContract,
        })
      )
    })
  })

  describe('Configuration #fast', () => {
    it('Should allow to set basketsNeeded only from BackingManager', async () => {
      // Check initial status
      expect(await rToken.basketsNeeded()).to.equal(0)

      // Try to update value if not BackingManager
      await expect(rToken.connect(owner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
        'not backing manager'
      )

      await whileImpersonating(assetRegistry.address, async (bhSigner) => {
        await expect(rToken.connect(bhSigner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
          'not backing manager'
        )
      })

      // Check value not updated
      expect(await rToken.basketsNeeded()).to.equal(0)

      await whileImpersonating(backingManager.address, async (bhSigner) => {
        await expect(rToken.connect(bhSigner).setBasketsNeeded(fp('1')))
          .to.emit(rToken, 'BasketsNeededChanged')
          .withArgs(0, fp('1'))
      })

      // Check updated value
      expect(await rToken.basketsNeeded()).to.equal(fp('1'))
    })

    it('Should allow to update issuanceRate if Owner and perform validations', async () => {
      const newValue: BigNumber = fp('0.1')

      // Check existing value
      expect(await rToken.issuanceRate()).to.equal(config.issuanceRate)

      // If not owner cannot update
      await expect(rToken.connect(other).setIssuanceRate(newValue)).to.be.revertedWith(
        'governance only'
      )

      // Check value did not change
      expect(await rToken.issuanceRate()).to.equal(config.issuanceRate)

      // Update with owner
      await expect(rToken.connect(owner).setIssuanceRate(newValue))
        .to.emit(rToken, 'IssuanceRateSet')
        .withArgs(rToken.issuanceRate, newValue)

      // Check value was updated
      expect(await rToken.issuanceRate()).to.equal(newValue)

      // Cannot update with issuanceRate > max
      await expect(
        rToken.connect(owner).setIssuanceRate(MAX_ISSUANCE_RATE.add(1))
      ).to.be.revertedWith('invalid issuanceRate')
    })

    it('Should not allow to set issuanceRate to zero', async () => {
      // If not owner cannot update
      await expect(rToken.connect(owner).setIssuanceRate(bn('0'))).to.be.revertedWith(
        'invalid issuanceRate'
      )
    })

    it('Should allow to update scalingRedemptionRate if Owner and perform validations', async () => {
      await expect(rToken.connect(addr1).setScalingRedemptionRate(0)).to.be.revertedWith(
        'governance only'
      )
      await rToken.connect(owner).setScalingRedemptionRate(0)
      expect(await rToken.scalingRedemptionRate()).to.equal(0)

      await expect(rToken.connect(addr1).setScalingRedemptionRate(fp('0.15'))).to.be.revertedWith(
        'governance only'
      )
      await rToken.connect(owner).setScalingRedemptionRate(fp('0.15'))
      expect(await rToken.scalingRedemptionRate()).to.equal(fp('0.15'))

      await expect(rToken.connect(addr1).setScalingRedemptionRate(fp('1'))).to.be.revertedWith(
        'governance only'
      )
      await rToken.connect(owner).setScalingRedemptionRate(fp('1'))
      expect(await rToken.scalingRedemptionRate()).to.equal(fp('1'))

      // Cannot update with invalid value
      await expect(rToken.connect(owner).setScalingRedemptionRate(fp('1.0001'))).to.be.revertedWith(
        'invalid fraction'
      )
    })

    it('Should allow to update redemptionRateFloor if Owner', async () => {
      await expect(rToken.connect(addr1).setRedemptionRateFloor(0)).to.be.reverted
      await rToken.connect(owner).setRedemptionRateFloor(0)
      expect(await rToken.redemptionRateFloor()).to.equal(0)

      await expect(rToken.connect(addr1).setRedemptionRateFloor(fp('1e3'))).to.be.reverted
      await rToken.connect(owner).setRedemptionRateFloor(fp('1e3'))
      expect(await rToken.redemptionRateFloor()).to.equal(fp('1e3'))

      await expect(rToken.connect(addr1).setRedemptionRateFloor(fp('1e4'))).to.be.reverted
      await rToken.connect(owner).setRedemptionRateFloor(fp('1e4'))
      expect(await rToken.redemptionRateFloor()).to.equal(fp('1e4'))
    })
  })

  describe('Issuance and Slow Minting', function () {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    it('Should not issue RTokens if paused', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Pause Main
      await main.connect(owner).pause()

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('paused or frozen')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if frozen', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('paused or frozen')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if UNPRICED collateral', async function () {
      const issueAmount: BigNumber = bn('10e18')

      await advanceTime(ORACLE_TIMEOUT.toString())

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('basket unsound')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not vest RTokens if paused', async function () {
      const issueAmount: BigNumber = bn('100000e18')

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Pause Main
      await main.connect(owner).pause()

      // Try to vest
      await expect(rToken.connect(addr1).vest(addr1.address, 1)).to.be.revertedWith(
        'paused or frozen'
      )

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not vest RTokens if frozen', async function () {
      const issueAmount: BigNumber = bn('100000e18')

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Try to vest
      await expect(rToken.connect(addr1).vest(addr1.address, 1)).to.be.revertedWith(
        'paused or frozen'
      )

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not vest RTokens if UNPRICED collateral', async function () {
      const issueAmount: BigNumber = bn('100000e18')

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      await advanceTime(ORACLE_TIMEOUT.toString())

      // Try to vest
      await expect(rToken.connect(addr1).vest(addr1.address, 1)).to.be.revertedWith(
        'basket unsound'
      )

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not be able to cancel vesting if frozen', async function () {
      const issueAmount: BigNumber = bn('100000e18')

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Try to cancel
      await expect(rToken.connect(addr1).cancel(1, true)).to.be.revertedWith('frozen')
    })

    it('Should be able to DOS issuance only from owner, by calling refreshBasket', async function () {
      const issueAmount: BigNumber = bn('100000e18')

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Refresh from non-owner account should fail
      await expect(basketHandler.connect(addr2).refreshBasket()).to.be.revertedWith(
        'basket unrefreshable'
      )

      // Refresh from owner should succeed
      await basketHandler.connect(owner).refreshBasket()

      // Vest should return tokens
      await expect(rToken.vest(addr1.address, 1)).to.emit(rToken, 'IssuancesCanceled')

      // Cancel should not work (in fact it has deleted the issuance)
      await expect(rToken.connect(addr1).cancel(1, true)).to.be.revertedWith('out of range')
      await expectProcessedIssuance(addr1.address, 0)
      await expect(rToken.connect(addr1).cancel(0, false)).to.not.emit(rToken, 'IssuancesCanceled')
      await expect(rToken.connect(addr1).cancel(0, true)).to.not.emit(rToken, 'IssuancesCanceled')
    })

    it('Should be able to refund issuances when calling vest if basket changed', async function () {
      const issueAmount: BigNumber = bn('20000e18')

      // Start issuances
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Refresh from owner should succeed
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Vest should return tokens
      await expect(rToken.connect(addr1).vest(addr1.address, 3))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 3, issueAmount.mul(3))
    })

    it('Should be able to refund issuances when calling issue if basket changed', async function () {
      const issueAmount: BigNumber = bn('20000e18')

      // Start issuances
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Refresh from owner should succeed
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Prepare a new issuance
      await token0.connect(addr1).approve(rToken.address, issueAmount)

      // Issue should return tokens
      await expect(rToken.connect(addr1).issue(issueAmount))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 3, issueAmount.mul(3))
    })

    it('Should be able to cancel vesting if paused', async function () {
      const issueAmount: BigNumber = bn('100000e18')

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Pause Main
      await main.connect(owner).pause()

      // Cancel
      await rToken.connect(addr1).cancel(1, true)
    })

    it('Should not be able to cancel vesting if index is out of range', async function () {
      const issueAmount: BigNumber = bn('100000e18')

      // Start issuance pre-pause
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Attempt to cancel
      await expect(rToken.connect(addr1).cancel(2, true)).to.be.revertedWith('out of range')

      // Cancel successfully
      await rToken.connect(addr1).cancel(1, true)

      // Attempt to cancel with older index
      await expect(rToken.connect(addr1).cancel(0, true)).to.not.emit(rToken, 'IssuancesCanceled')
    })

    it('Should not issue RTokens if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Try to issue
      await expect(rToken.connect(addr1).issue(zero)).to.be.revertedWith('Cannot issue zero')

      // Check values
      expect(await rToken.totalSupply()).to.equal(bn('0'))
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn('10e18')

      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: insufficient allowance'
      )
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const issueAmount: BigNumber = bn('10000000000e18')

      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)

      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
      expect(await rToken.totalSupply()).to.equal(bn('0'))
    })

    it('Should issue RTokens with single basket token', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Set basket
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // RToken price pre-issuance
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'IssuanceStarted')

      // Check Balances after
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(rToken.address)).to.equal(issueAmount)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)

      // Check if minting was registered
      const currentBlockNumber = await getLatestBlockNumber()
      const blockAddPct: BigNumber = issueAmount.mul(BN_SCALE_FACTOR).div(MIN_ISSUANCE_PER_BLOCK)
      await expectUnprocessedIssuance(addr1.address, 0, {
        amount: issueAmount,
        basketNonce: initialBasketNonce.add(1),
        blockAvailableAt: fp(currentBlockNumber - 1).add(blockAddPct),
      })

      // Process issuance
      await advanceBlocks(17)

      const endID = await endIdForVest(addr1.address)
      expect(endID).to.equal(1)
      await expectEvents(rToken.vest(addr1.address, 1), [
        {
          contract: rToken,
          name: 'IssuancesCompleted',
          args: [addr1.address, 0, 1, issueAmount],
          emitted: true,
        },
        {
          contract: rToken,
          name: 'Issuance',
          args: [addr1.address, issueAmount, issueAmount],
          emitted: true,
        },
      ])

      // Check minting was deleted
      await expectProcessedIssuance(addr1.address, 0)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Check asset value
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
    })

    it('Should issue RTokens correctly for more complex basket multiple users', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)

      // check balances before
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token1.balanceOf(main.address)).to.equal(0)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token2.balanceOf(main.address)).to.equal(0)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token3.balanceOf(main.address)).to.equal(0)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'IssuanceStarted')

      // Check Balances after
      const expectedTkn0: BigNumber = quotes[0]
      expect(await token0.balanceOf(rToken.address)).to.equal(expectedTkn0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      const expectedTkn1: BigNumber = quotes[1]
      expect(await token1.balanceOf(rToken.address)).to.equal(expectedTkn1)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      const expectedTkn2: BigNumber = quotes[2]
      expect(await token2.balanceOf(rToken.address)).to.equal(expectedTkn2)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      const expectedTkn3: BigNumber = quotes[3]
      expect(await token3.balanceOf(rToken.address)).to.equal(expectedTkn3)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check if minting was registered
      let currentBlockNumber = await getLatestBlockNumber()
      const blockAddPct: BigNumber = issueAmount.mul(BN_SCALE_FACTOR).div(MIN_ISSUANCE_PER_BLOCK)
      await expectUnprocessedIssuance(addr1.address, 0, {
        amount: issueAmount,
        basketNonce: initialBasketNonce,
        blockAvailableAt: fp(currentBlockNumber - 1).add(blockAddPct),
      })

      // Issue new RTokens with different user
      // This will also process the previous minting and send funds to the minter
      // Provide approvals
      await token0.connect(addr2).approve(rToken.address, initialBal)
      await token1.connect(addr2).approve(rToken.address, initialBal)
      await token2.connect(addr2).approve(rToken.address, initialBal)
      await token3.connect(addr2).approve(rToken.address, initialBal)
      await advanceBlocks(1)
      await expectEvents(rToken.vest(addr1.address, await endIdForVest(addr1.address)), [
        {
          contract: rToken,
          name: 'IssuancesCompleted',
          args: [addr1.address, 0, 1, issueAmount],
          emitted: true,
        },
        {
          contract: rToken,
          name: 'Issuance',
          args: [addr1.address, issueAmount, issueAmount],
          emitted: true,
        },
      ])

      // Check previous minting was processed and funds sent to minter
      await expectProcessedIssuance(addr1.address, 0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Check asset value at this point
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

      // Issue rTokens
      await rToken.connect(addr2).issue(issueAmount)

      // Check Balances after
      expect(await token0.balanceOf(backingManager.address)).to.equal(expectedTkn0)
      expect(await token1.balanceOf(backingManager.address)).to.equal(expectedTkn1)
      expect(await token2.balanceOf(backingManager.address)).to.equal(expectedTkn2)
      expect(await token3.balanceOf(backingManager.address)).to.equal(expectedTkn3)
      expect(await token0.balanceOf(rToken.address)).to.equal(expectedTkn0)
      expect(await token1.balanceOf(rToken.address)).to.equal(expectedTkn1)
      expect(await token2.balanceOf(rToken.address)).to.equal(expectedTkn2)
      expect(await token3.balanceOf(rToken.address)).to.equal(expectedTkn3)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(backingManager.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(addr2.address)).to.equal(0)

      // Check the new issuance is not processed
      currentBlockNumber = await getLatestBlockNumber()
      await expectUnprocessedIssuance(addr2.address, 0, {
        amount: issueAmount,
        basketNonce: initialBasketNonce,
        blockAvailableAt: fp(currentBlockNumber - 1).add(blockAddPct),
      })

      // Complete 2nd issuance
      await advanceBlocks(1)
      await rToken.vest(addr2.address, await endIdForVest(addr2.address))

      // Check issuance is confirmed
      await expectProcessedIssuance(addr2.address, 0)
      expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmount)

      // Check asset value
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.mul(2)
      )
    })

    it('Should not vest RTokens if collateral not SOUND', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Default one of the tokens - 50% price reduction and mark default as probable
      await setOraclePrice(collateral1.address, bn('0.5e8'))
      await main.poke()

      expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
      expect(await basketHandler.fullyCollateralized()).to.equal(true)

      // Attempt to vest (pending 1 block)
      await advanceBlocks(1)
      await expect(
        rToken.vest(addr1.address, await endIdForVest(addr1.address))
      ).to.be.revertedWith('basket unsound')

      // Check previous minting was not processed
      await expectUnprocessedIssuance(addr1.address, 0, {})
      expect(await rToken.totalSupply()).to.equal(bn('0'))
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
    })

    it('Should not vest RTokens early', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(3)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Attempt to vest
      await expect(rToken.vest(addr1.address, 1)).to.be.revertedWith('issuance not ready')

      await advanceBlocks(1)

      // Should vest now
      await rToken.vest(addr1.address, 1)
    })

    it('Should not vest if index is out of range', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(3)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Attempt to vest with invalid index
      await expect(rToken.vest(addr1.address, 2)).to.be.revertedWith('out of range')

      await advanceBlocks(1)

      // Should vest now
      await rToken.vest(addr1.address, 1)
    })

    it('Should return maxIssuable correctly', async () => {
      const issueAmount = initialBal.div(2)
      // Check values, with no issued tokens
      expect(await facade.callStatic.maxIssuable(rToken.address, addr1.address)).to.equal(
        initialBal.mul(4)
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
        initialBal.mul(4)
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, other.address)).to.equal(0)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Attempt to process slow issuances - nothing at this point
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))

      // Process 2 blocks
      await advanceTime(100)

      // Vest tokens
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))

      // Check values, with issued tokens
      expect(await facade.callStatic.maxIssuable(rToken.address, addr1.address)).to.equal(
        initialBal.mul(4).sub(issueAmount)
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
        initialBal.mul(4)
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, other.address)).to.equal(0)
    })

    it('Should return price 0 and trade min after full basket refresh', async () => {
      // Note: To get RToken price to 0, a full basket refresh needs to occur
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

      // Set basket - Single token
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // RToken price pre-issuance
      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(issueAmount))

      expect(await rTokenAsset.strictPrice()).to.equal(fp('1'))
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

      // Perform a basket switch
      // Set basket - Single token
      await basketHandler.connect(owner).setPrimeBasket([token1.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Should expect maxTradeSlippage + dust losses -- remember no insurance available
      // maxTradeSlippage + dust losses
      const dustPriceImpact = fp('1').mul(config.minTradeVolume).div(issueAmount)
      expect(await rTokenAsset.strictPrice()).to.equal(
        fp('1').mul(99).div(100).sub(dustPriceImpact.mul(2))
      )
      expect(await rTokenAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)
    })

    it('Should process issuances in multiple attempts (using minimum issuance)', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(4)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Check Balances after
      const expectedTkn0: BigNumber = quotes[0]
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(rToken.address)).to.equal(expectedTkn0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      const expectedTkn1: BigNumber = quotes[1]
      expect(await token1.balanceOf(main.address)).to.equal(0)
      expect(await token1.balanceOf(rToken.address)).to.equal(expectedTkn1)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      const expectedTkn2: BigNumber = quotes[2]
      expect(await token2.balanceOf(main.address)).to.equal(0)
      expect(await token2.balanceOf(rToken.address)).to.equal(expectedTkn2)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      const expectedTkn3: BigNumber = quotes[3]
      expect(await token3.balanceOf(main.address)).to.equal(0)
      expect(await token3.balanceOf(rToken.address)).to.equal(expectedTkn3)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check if minting was registered
      const currentBlockNumber = await getLatestBlockNumber()
      await expectUnprocessedIssuance(addr1.address, 0, {
        amount: issueAmount,
        basketNonce: initialBasketNonce,
        blockAvailableAt: fp(currentBlockNumber + 3),
      })

      // Nothing should process
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))
      // Check previous minting was not processed[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      await expectUnprocessedIssuance(addr1.address, 0, {})

      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check asset value at this point (still nothing issued)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // Process 4 blocks
      await advanceTime(100)
      await advanceTime(100)
      await advanceTime(100)
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))

      // Check previous minting was processed and funds sent to minter
      await expectProcessedIssuance(addr1.address, 0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)

      // Check asset value
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
    })

    it('Should process issuances in multiple attempts (using issuanceRate)', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(4)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Process slow issuances, resetting indices
      await advanceTime(100)
      await advanceTime(100)
      await advanceTime(100)
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))
      await expectProcessedIssuance(addr1.address, 0)

      // Check issuance was confirmed
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Set issuance rate to 50% per block
      // Update config
      await rToken.connect(owner).setIssuanceRate(fp('0.5'))

      // Try new issuance. Should be based on issuance rate = 50% per block should take two blocks
      // Based on current supply its gonna be 25000e18 tokens per block
      const ISSUANCE_PER_BLOCK = (await rToken.totalSupply()).div(2)
      const newIssuanceAmt: BigNumber = ISSUANCE_PER_BLOCK.mul(3)

      // Issue rTokens
      await rToken.connect(addr1).issue(newIssuanceAmt)

      // Check if minting was registered
      const currentBlockNumber = await getLatestBlockNumber()

      // Using issuance rate of 50% = 2 blocks
      const blockAddPct: BigNumber = newIssuanceAmt.mul(BN_SCALE_FACTOR).div(ISSUANCE_PER_BLOCK)
      await expectUnprocessedIssuance(addr1.address, 0, {
        amount: newIssuanceAmt,
        basketNonce: initialBasketNonce,
        blockAvailableAt: fp(currentBlockNumber - 1).add(blockAddPct),
      })

      // Should not process
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))

      // Check minting was not processed
      await expectUnprocessedIssuance(addr1.address, 0, {
        amount: newIssuanceAmt,
        basketNonce: initialBasketNonce,
        blockAvailableAt: fp(currentBlockNumber - 1).add(blockAddPct),
      })
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Check asset value at this point (still nothing issued beyond initial amount)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

      // Process slow mintings one more time
      await advanceBlocks(1)
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))

      // Check previous minting was processed and funds sent to minter
      await expectProcessedIssuance(addr1.address, 0)
      await expectProcessedIssuance(addr1.address, 1)
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(newIssuanceAmt))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssuanceAmt))

      // Check asset value
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.add(newIssuanceAmt)
      )
    })

    it('Should process multiple issuances in the correct order', async function () {
      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issuance #1 - Will be processed in 5 blocks
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(5)
      await rToken.connect(addr1).issue(issueAmount)

      // Issuance #2 and #3 - Will be processed in one additional block each
      const newIssueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK
      await rToken.connect(addr1).issue(newIssueAmount)
      await rToken.connect(addr1).issue(newIssueAmount)

      // Mine remaining block for first issuance (3 already automined by issue calls, this )
      await advanceBlocks(1)
      await rToken.vest(addr1.address, 1)

      // Check first slow minting is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

      // Process another block to get the 2nd issuance processed
      await rToken.vest(addr1.address, 2)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount))
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.add(newIssueAmount)
      )

      // Process another block to get the 3rd issuance processed
      await rToken.vest(addr1.address, 3)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount.mul(2)))
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.add(newIssueAmount.mul(2))
      )
    })

    it('Should calculate available vesting correctly', async function () {
      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issuance - Will be processed in 5 blocks
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(5)
      await rToken.connect(addr1).issue(issueAmount)

      let currentBlockNumber = await getLatestBlockNumber()
      const whenIssuance0 = fp(currentBlockNumber - 1).add(fp(5))
      await expectUnprocessedIssuance(addr1.address, 0, {
        amount: issueAmount,
        basketNonce: initialBasketNonce,
        blockAvailableAt: whenIssuance0,
      })

      // Check vestings - Nothing available yet
      expect(await endIdForVest(addr1.address)).to.equal(0)

      // Create three additional issuances of 3 blocks each
      const newIssueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(3)
      await rToken.connect(addr1).issue(newIssueAmount)
      const whenIssuance1 = whenIssuance0.add(fp(3))
      await expectUnprocessedIssuance(addr1.address, 1, {
        amount: newIssueAmount,
        basketNonce: initialBasketNonce,
        blockAvailableAt: whenIssuance1,
      })

      await rToken.connect(addr1).issue(newIssueAmount)
      const whenIssuance2 = whenIssuance1.add(fp(3))
      await expectUnprocessedIssuance(addr1.address, 2, {
        amount: newIssueAmount,
        basketNonce: initialBasketNonce,
        blockAvailableAt: whenIssuance2,
      })

      await rToken.connect(addr1).issue(newIssueAmount)
      const whenIssuance3 = whenIssuance2.add(fp(3))
      await expectUnprocessedIssuance(addr1.address, 3, {
        amount: newIssueAmount,
        basketNonce: initialBasketNonce,
        blockAvailableAt: whenIssuance3,
      })

      // Check vestings - Nothing available yet, need one more block
      expect(await endIdForVest(addr1.address)).to.equal(0)

      //  Advance 1 additional block required for first issuance
      await advanceBlocks(1)

      // Check vestings - We can vest the first issuance only
      currentBlockNumber = await getLatestBlockNumber()
      expect(whenIssuance0).to.be.lte(fp(currentBlockNumber))
      expect(whenIssuance1).to.be.gt(fp(currentBlockNumber))
      expect(await endIdForVest(addr1.address)).to.equal(1)

      // Advance 3 blocks, should be able to vest second issuance
      await advanceBlocks(3)

      // Check vestings - Can vest issuances #0 and #1
      currentBlockNumber = await getLatestBlockNumber()
      expect(whenIssuance1).to.be.lte(fp(currentBlockNumber))
      expect(whenIssuance2).to.be.gt(fp(currentBlockNumber))
      expect(await endIdForVest(addr1.address)).to.equal(2)

      // Advance 1 block
      await advanceBlocks(1)

      // Check vestings - Nothing changed
      currentBlockNumber = await getLatestBlockNumber()
      expect(whenIssuance2).to.be.gt(fp(currentBlockNumber))
      expect(await endIdForVest(addr1.address)).to.equal(2)

      // Advance 2 more blocks, will unlock issuance #2
      await advanceBlocks(2)

      // Check vestings - Can vest issuances #0, #1, and #2
      currentBlockNumber = await getLatestBlockNumber()
      expect(whenIssuance2).to.be.lte(fp(currentBlockNumber))
      expect(whenIssuance3).to.be.gt(fp(currentBlockNumber))
      expect(await endIdForVest(addr1.address)).to.equal(3)

      // Advance 10 blocks will unlock all issuances
      await advanceBlocks(10)

      // Check vestings - Can vest all issuances
      currentBlockNumber = await getLatestBlockNumber()
      expect(whenIssuance3).to.be.lt(fp(currentBlockNumber))
      expect(await endIdForVest(addr1.address)).to.equal(4)

      // Vest all issuances
      await rToken.vest(addr1.address, 4)

      // Check slow mintings are all confirmed
      const totalValue: BigNumber = issueAmount.add(newIssueAmount.mul(3))
      expect(await rToken.balanceOf(addr1.address)).to.equal(totalValue)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(totalValue)
    })

    it('Should allow multiple issuances in the same block', async function () {
      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Issuance #1 -  Will be processed in 1 blocks
      const issueAmount: BigNumber = bn('5000e18')
      await rToken.connect(addr1).issue(issueAmount)

      // Issuance #2 - Should be processed in the same block
      await rToken.connect(addr1).issue(issueAmount)

      // Mine block
      await advanceBlocks(1)

      // Check both slow mintings are confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.mul(2))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.mul(2)
      )

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])

      // Process issuances again, should not change anything
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.mul(2))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.mul(2)
      )
    })

    it('Should allow instant issuances', async function () {
      const instantIssue: BigNumber = MIN_ISSUANCE_PER_BLOCK.sub(1)
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(3)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Attempt to vest
      await expect(rToken.vest(addr1.address, 1)).to.be.revertedWith('not ready')
      await advanceBlocks(5)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(instantIssue)).to.emit(rToken, 'IssuanceStarted')

      // Should vest now
      await expect(await rToken.vest(addr1.address, 1)).to.emit(rToken, 'IssuancesCompleted')
    })

    it('Should move issuances to next block if exceeds issuance limit', async function () {
      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Issuance #1 -  Will be processed in 0.5 blocks
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.div(2)
      await rToken.connect(addr1).issue(issueAmount)

      // Issuance #2 - Will be processed in 1.0001 blocks
      const newIssueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.div(2).add(
        MIN_ISSUANCE_PER_BLOCK.div(10000)
      )
      await rToken.connect(addr1).issue(newIssueAmount)

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])

      // Check first slow mintings is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

      // Process issuance #2
      await rToken.vest(addr1.address, (await endIdForVest(addr1.address)).add(1))

      // Check second mintings is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
        issueAmount.add(newIssueAmount)
      )
    })

    it('Should allow the issuer to rollback some, but not all, issuances', async () => {
      // Regression test for TOB-RES-8

      // Mint more tokens! Wind up with 32e24 of each token.
      await token0.connect(owner).mint(addr1.address, bn('32e24').sub(initialBal))
      await token1.connect(owner).mint(addr1.address, bn('32e24').sub(initialBal))
      await token2.connect(owner).mint(addr1.address, bn('32e24').sub(initialBal))
      await token3.connect(owner).mint(addr1.address, bn('32e24').sub(initialBal))

      await token0.connect(addr1).approve(rToken.address, bn('32e24'))
      await token1.connect(addr1).approve(rToken.address, bn('32e24'))
      await token2.connect(addr1).approve(rToken.address, bn('32e24'))
      await token3.connect(addr1).approve(rToken.address, bn('32e24'))

      const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, bn('1e24'))
      const expectedTkn0: BigNumber = quotes[0]
      const expectedTkn1: BigNumber = quotes[1]
      const expectedTkn2: BigNumber = quotes[2]
      const expectedTkn3: BigNumber = quotes[3]

      // launch 5 issuances of increasing size (1e24, 2e24, ... 16e24)
      for (let i = 0; i < 5; i++) await rToken.connect(addr1).issue(bn('1e24').mul(2 ** i))

      const before0 = bn('32e24').sub(expectedTkn0.mul(31))
      const before1 = bn('32e24').sub(expectedTkn1.mul(31))
      const before2 = bn('32e24').sub(expectedTkn2.mul(31))
      const before3 = bn('32e24').sub(expectedTkn3.mul(31))

      expect(await token0.balanceOf(addr1.address)).to.equal(before0)
      expect(await token1.balanceOf(addr1.address)).to.equal(before1)
      expect(await token2.balanceOf(addr1.address)).to.equal(before2)
      expect(await token3.balanceOf(addr1.address)).to.equal(before3)

      // Check initial state
      await expectUnprocessedIssuance(addr1.address, 0, { processed: false })
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Cancel the last 3 issuances
      await expect(rToken.connect(addr1).cancel(2, false))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 2, 5, bn('28e24'))

      // Check that the last 3 issuances were refunded
      // (28 = 4 + 8 + 16)
      expect((await token0.balanceOf(addr1.address)).sub(before0).div(expectedTkn0)).to.equal(28)
      expect((await token1.balanceOf(addr1.address)).sub(before1).div(expectedTkn1)).to.equal(28)
      expect((await token2.balanceOf(addr1.address)).sub(before2).div(expectedTkn2)).to.equal(28)
      expect((await token3.balanceOf(addr1.address)).sub(before3).div(expectedTkn3)).to.equal(28)

      // Check total asset value did not change
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // Cancel only the first issuance
      await expect(rToken.connect(addr1).cancel(1, true))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 1, bn('1e24'))
    })

    it('Should allow the issuer to rollback minting', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)
      const expectedTkn0: BigNumber = quotes[0]
      const expectedTkn1: BigNumber = quotes[1]
      const expectedTkn2: BigNumber = quotes[2]
      const expectedTkn3: BigNumber = quotes[3]

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      // Check initial state
      await expectUnprocessedIssuance(addr1.address, 0, {})
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Cancel with issuer
      await expect(rToken.connect(addr1).cancel(1, true))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 1, issueAmount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check balances returned to user
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      // Check total asset value did not change
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)

      // We've cleared the queue so calls to cancel should revert
      await expectProcessedIssuance(addr1.address, 0)
      await expect(rToken.connect(addr1).cancel(1, true)).to.be.revertedWith('out of range')
    })

    it('Should allow the issuer to rollback specific set of mintings', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)
      const expectedTkn0: BigNumber = quotes[0]
      const expectedTkn1: BigNumber = quotes[1]
      const expectedTkn2: BigNumber = quotes[2]
      const expectedTkn3: BigNumber = quotes[3]

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Check if minting was registered
      await expectUnprocessedIssuance(addr1.address, 0, {})
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      // Vest minting
      await advanceBlocks(1)
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))

      // Check previous minting was processed and funds sent to minter
      await expectProcessedIssuance(addr1.address, 0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Create another issuance
      await rToken.connect(addr1).issue(issueAmount)

      // Check initial state -- reuses same index
      await expectUnprocessedIssuance(addr1.address, 0, {})
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0.mul(2)))
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1.mul(2)))
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2.mul(2)))
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3.mul(2)))

      // Cancel with issuer
      await expect(rToken.connect(addr1).cancel(1, true))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 1, issueAmount)

      // Check minting was cancelled and not tokens minted
      await expectProcessedIssuance(addr1.address, 0)
      await expectProcessedIssuance(addr1.address, 1)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Check balances returned to user
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      // Check total asset value did not change
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

      // Another call will not do anything
      await rToken.connect(addr1).cancel(0, true)
      await expect(rToken.connect(addr1).cancel(1, true)).to.be.revertedWith('out of range')
    })

    it('Should rollback mintings if Basket changes (2 blocks)', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const [, quotes] = await facade.connect(addr1).callStatic.issue(rToken.address, issueAmount)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Check Balances - Before vault switch
      const expectedTkn0: BigNumber = quotes[0]
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(rToken.address)).to.equal(expectedTkn0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn0))

      const expectedTkn1: BigNumber = quotes[1]
      expect(await token1.balanceOf(main.address)).to.equal(0)
      expect(await token1.balanceOf(rToken.address)).to.equal(expectedTkn1)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn1))

      const expectedTkn2: BigNumber = quotes[2]
      expect(await token2.balanceOf(main.address)).to.equal(0)
      expect(await token2.balanceOf(rToken.address)).to.equal(expectedTkn2)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn2))

      const expectedTkn3: BigNumber = quotes[3]
      expect(await token3.balanceOf(main.address)).to.equal(0)
      expect(await token3.balanceOf(rToken.address)).to.equal(expectedTkn3)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal.sub(expectedTkn3))

      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Update basket to trigger rollbacks (using same one to keep fullyCollateralized = true)
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).refreshBasket()

      // Cancel slow issuances
      await expect(rToken.connect(addr1).cancel(0, false))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 1, issueAmount)

      // Check Balances after - Funds returned to minter
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token1.balanceOf(main.address)).to.equal(0)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token2.balanceOf(main.address)).to.equal(0)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await token3.balanceOf(main.address)).to.equal(0)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      expect(await rToken.balanceOf(rToken.address)).to.equal(0)

      await expectProcessedIssuance(addr1.address, 0)
      expect(await endIdForVest(addr1.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check total asset value did not change
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    })

    it('Should not allow solidified cancel exploit', async () => {
      // This test is modeled after the solidified-provided proof of concept test

      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2) // takes 2 blocks to vest
      const beforeBal = await token0.balanceOf(addr1.address)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)
      await token0.connect(addr2).approve(rToken.address, initialBal)
      await token1.connect(addr2).approve(rToken.address, initialBal)
      await token2.connect(addr2).approve(rToken.address, initialBal)
      await token3.connect(addr2).approve(rToken.address, initialBal)
      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
      await rToken.connect(addr1).issue(issueAmount)
      await rToken.connect(addr2).issue(issueAmount) // This will be stolen by addr1

      // Cancel with addr1
      await expect(rToken.connect(addr1).cancel(1, false))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 1, 2, issueAmount)

      // before: queue.right is 1
      await rToken.connect(addr1).issue(1)
      // after: queue.right is 2

      // Shoult not allow to double-dip into cancellation
      await expect(rToken.connect(addr1).cancel(3, false)).to.be.revertedWith('out of range')
      await expect(rToken.connect(addr1).cancel(3, true)).to.be.revertedWith('out of range')
      await expect(rToken.connect(addr1).cancel(2, false)).to.not.emit(rToken, 'IssuancesCanceled')
      await expect(rToken.connect(addr1).cancel(0, true)).to.not.emit(rToken, 'IssuancesCanceled')

      // Should still be able to cancel the initial issuance and the malicious +1
      // and importantly, these should be all that's left to cancel
      await expect(rToken.connect(addr1).cancel(0, false))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 2, issueAmount.add(1))

      // Should have initial tokens back, up to 1 less. Not more
      expect(await token0.balanceOf(addr1.address)).to.be.lte(beforeBal)
      expect(await token0.balanceOf(addr1.address)).to.be.closeTo(beforeBal, 1)
    })
  })

  describe('Redeem', function () {
    it('Should revert if zero amount #fast', async function () {
      const zero: BigNumber = bn('0')
      await expect(rToken.connect(addr1).redeem(zero)).to.be.revertedWith('Cannot redeem zero')
    })

    it('Should revert if no balance of RToken #fast', async function () {
      const redeemAmount: BigNumber = bn('20000e18')

      await expect(rToken.connect(addr1).redeem(redeemAmount)).to.be.revertedWith(
        'not enough RToken'
      )
    })

    context('With issued RTokens', function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)

        // Issue rTokens
        await rToken.connect(addr1).issue(issueAmount)
      })

      it('Should redeem RTokens correctly', async function () {
        const redeemAmount = bn('100e18')

        // Check balances
        expect(await rToken.balanceOf(addr1.address)).to.equal(redeemAmount)
        expect(await rToken.totalSupply()).to.equal(redeemAmount)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

        // Redeem rTokens
        await rToken.connect(addr1).redeem(redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.sub(redeemAmount)
        )
      })

      it('Should redeem RTokens correctly for multiple users', async function () {
        const issueAmount = bn('100e18')
        const redeemAmount = bn('100e18')

        // Issue new RTokens
        await token0.connect(addr2).approve(rToken.address, initialBal)
        await token1.connect(addr2).approve(rToken.address, initialBal)
        await token2.connect(addr2).approve(rToken.address, initialBal)
        await token3.connect(addr2).approve(rToken.address, initialBal)
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)

        // Issue rTokens
        await rToken.connect(addr2).issue(issueAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2)
        )

        // Redeem rTokens
        await rToken.connect(addr1).redeem(redeemAmount)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2).sub(redeemAmount)
        )

        // Redeem rTokens with another user
        await rToken.connect(addr2).redeem(redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.balanceOf(addr2.address)).to.equal(0)

        expect(await rToken.totalSupply()).to.equal(0)

        expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

        expect(await token0.balanceOf(addr2.address)).to.equal(initialBal)
        expect(await token1.balanceOf(addr2.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr2.address)).to.equal(initialBal)
        expect(await token3.balanceOf(addr2.address)).to.equal(initialBal)

        // Check asset value
        expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(
          issueAmount.mul(2).sub(redeemAmount.mul(2))
        )
      })

      it('Should redeem if basket is IFFY #fast', async function () {
        // Default one of the tokens - 50% price reduction and mark default as probable
        await setOraclePrice(collateral3.address, bn('0.5e8'))

        await rToken.connect(addr1).redeem(issueAmount)
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should redeem if basket is UNPRICED #fast', async function () {
        await advanceTime(ORACLE_TIMEOUT.toString())

        await rToken.connect(addr1).redeem(issueAmount)
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should redeem if paused #fast', async function () {
        await main.connect(owner).pause()
        await rToken.connect(addr1).redeem(issueAmount)
        expect(await rToken.totalSupply()).to.equal(0)
      })

      it('Should revert if frozen #fast', async function () {
        await main.connect(owner).freezeShort()

        // Try to redeem
        await expect(rToken.connect(addr1).redeem(issueAmount)).to.be.revertedWith('frozen')

        // Check values
        expect(await rToken.totalSupply()).to.equal(issueAmount)
      })

      it('Should revert if empty redemption #fast', async function () {
        // Eliminate most token balances
        const bal = issueAmount.div(4)
        await token0.connect(owner).burn(backingManager.address, bal)
        await token1.connect(owner).burn(backingManager.address, toBNDecimals(bal, 6))
        await token2.connect(owner).burn(backingManager.address, bal)

        // Should not revert with empty redemption yet
        await rToken.connect(addr1).redeem(issueAmount.div(2))
        expect(await rToken.totalSupply()).to.equal(issueAmount.div(2))

        // Burn the rest
        await token3
          .connect(owner)
          .burn(backingManager.address, await token3.balanceOf(backingManager.address))

        // Now it should revert
        await expect(rToken.connect(addr1).redeem(issueAmount.div(2))).to.be.revertedWith(
          'Empty redemption'
        )

        // Check values
        expect(await rToken.totalSupply()).to.equal(issueAmount.div(2))
      })

      it('Should revert if basket is DISABLED #fast', async function () {
        // Default immediately
        await token3.setExchangeRate(fp('0.999999'))

        await expect(rToken.connect(addr1).redeem(issueAmount)).to.be.revertedWith(
          'collateral default'
        )
        expect(await rToken.totalSupply()).to.equal(issueAmount)
      })

      context('And redemption throttling', function () {
        let redemptionRateFloor: BigNumber
        let redeemAmount: BigNumber

        beforeEach(async function () {
          redemptionRateFloor = (await rToken.totalSupply()).div(100) // 1% of totalSupply
          // the scaling rate is 5%

          await rToken.connect(owner).setRedemptionRateFloor(redemptionRateFloor)
          expect(await rToken.redemptionRateFloor()).to.equal(redemptionRateFloor)

          // Charge battery
          await advanceBlocks(300)
        })

        it('Should calculate redemption limit correctly', async function () {
          redeemAmount = issueAmount.mul(config.scalingRedemptionRate).div(fp('1'))
          expect(await rToken.redemptionLimit()).to.equal(redeemAmount)
        })

        it('Should be able to do geometric redemptions to scale down supply', async function () {
          // Should complete is just under 52 iterations at rates: 5% + 1e18
          const numIterations = 53
          for (let i = 0; i < numIterations; i++) {
            const totalSupply = await rToken.totalSupply()
            if (totalSupply.eq(0)) break

            // Charge + redeem
            await advanceBlocks(300)
            redeemAmount = await rToken.redemptionLimit()

            await rToken.connect(addr1).redeem(redeemAmount)
            issueAmount = issueAmount.sub(redeemAmount)
            expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
            expect(await rToken.totalSupply()).to.equal(issueAmount)

            // Should reach dust supply before exhausting loop iterations
            expect(i < numIterations - 1).to.equal(true)
          }

          expect(await rToken.totalSupply()).to.equal(0)
        })

        it('Should revert on overly-large redemption #fast', async function () {
          redeemAmount = issueAmount.mul(config.scalingRedemptionRate).div(fp('1'))
          await expect(rToken.connect(addr1).redeem(redeemAmount.add(1))).to.be.revertedWith(
            'redemption battery insufficient'
          )
          await rToken.connect(addr1).redeem(redeemAmount)
        })

        it('Should ignore redemption throttling if max redemption charge is zero', async function () {
          const prevMaxRedemption: BigNumber = await rToken.scalingRedemptionRate()
          await rToken.connect(owner).setScalingRedemptionRate(bn(0))
          await rToken.connect(owner).setRedemptionRateFloor(bn(0))
          expect(await rToken.scalingRedemptionRate()).to.equal(bn(0))
          expect(await rToken.redemptionRateFloor()).to.equal(bn(0))

          // Large redemption will work
          redeemAmount = issueAmount.mul(prevMaxRedemption).div(fp('1'))
          await rToken.connect(addr1).redeem(redeemAmount.add(1))
        })

        it('Should allow two redemptions of half value #fast', async function () {
          redeemAmount = issueAmount.mul(config.scalingRedemptionRate).div(fp('1'))
          await rToken.connect(addr1).redeem(redeemAmount.div(2))
          await rToken.connect(addr1).redeem(redeemAmount.div(2))
          await expect(rToken.connect(addr1).redeem(redeemAmount.div(100))).to.be.revertedWith(
            'redemption battery insufficient'
          )
        })

        it('Should use real total supply for redemption  if greater then or equal to virtualTotalSupply', async function () {
          // Issue twice the virtual total supply
          // Provide approvals
          await token0.connect(addr2).approve(rToken.address, initialBal)
          await token1.connect(addr2).approve(rToken.address, initialBal)
          await token2.connect(addr2).approve(rToken.address, initialBal)
          await token3.connect(addr2).approve(rToken.address, initialBal)

          await rToken.connect(addr2).issue(issueAmount)
          redeemAmount = issueAmount.mul(2).mul(config.scalingRedemptionRate).div(fp('1'))

          expect(await rToken.redemptionLimit()).to.equal(redeemAmount)

          // Can redeem
          await rToken.connect(addr2).redeem(redeemAmount)
        })
      })
    })
  })

  describe('Melt/Mint #fast', () => {
    const issueAmount: BigNumber = bn('100e18')

    beforeEach(async () => {
      // Issue some RTokens
      await token0.connect(owner).mint(addr1.address, initialBal)
      await token1.connect(owner).mint(addr1.address, initialBal)
      await token2.connect(owner).mint(addr1.address, initialBal)
      await token3.connect(owner).mint(addr1.address, initialBal)

      // Approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue tokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('Should not melt if paused', async () => {
      await main.connect(owner).pause()
      await expect(rToken.connect(addr1).melt(issueAmount)).to.be.revertedWith('paused or frozen')
    })

    it('Should not melt if frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(rToken.connect(addr1).melt(issueAmount)).to.be.revertedWith('paused or frozen')
    })

    it('Should allow to melt tokens if caller', async () => {
      // Melt tokens
      const meltAmount: BigNumber = bn('10e18')

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      await rToken.connect(addr1).melt(meltAmount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(meltAmount))
      expect(await rToken.totalSupply()).to.equal(issueAmount.sub(meltAmount))
    })

    it('Should not allow mint/transfer/transferFrom to address(this)', async () => {
      // mint
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(rToken.connect(signer).mint(rToken.address, 1)).to.be.revertedWith(
          'RToken transfer to self'
        )
      })

      // transfer
      await expect(rToken.connect(addr1).transfer(rToken.address, 1)).to.be.revertedWith(
        'RToken transfer to self'
      )

      // transferFrom
      await rToken.connect(addr1).approve(addr2.address, 1)
      await expect(
        rToken.connect(addr2).transferFrom(addr1.address, rToken.address, 1)
      ).to.be.revertedWith('RToken transfer to self')
    })

    it('Should allow to mint tokens when called by backing manager', async () => {
      // Mint tokens
      const mintAmount: BigNumber = bn('10e18')

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      await whileImpersonating(backingManager.address, async (signer) => {
        await rToken.connect(signer).mint(addr1.address, mintAmount)
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(mintAmount))
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(mintAmount))

      // Trying to mint with another account will fail
      await expect(rToken.connect(other).mint(addr1.address, mintAmount)).to.be.revertedWith(
        'not backing manager'
      )

      // Trying to mint from a non-backing manager component should fail
      await whileImpersonating(basketHandler.address, async (signer) => {
        await expect(rToken.connect(signer).mint(addr1.address, mintAmount)).to.be.revertedWith(
          'not backing manager'
        )
      })
    })

    it('Should not allow setBasketsNeeded to set BU exchange rate to outside [1e-9, 1e9]', async () => {
      // setBasketsNeeded()
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(
          rToken.connect(signer).setBasketsNeeded(issueAmount.mul(bn('1e9')).add(1))
        ).to.be.revertedWith('BU rate out of range')
        await expect(
          rToken.connect(signer).setBasketsNeeded(issueAmount.div(bn('1e9')).sub(1))
        ).to.be.revertedWith('BU rate out of range')
        await rToken.connect(signer).setBasketsNeeded(issueAmount.mul(bn('1e9')))
        await rToken.connect(signer).setBasketsNeeded(issueAmount.div(bn('1e9')))
      })
    })

    it('Should not allow mint to set BU exchange rate to above 1e9', async () => {
      // mint()
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(
          rToken
            .connect(signer)
            .mint(addr1.address, issueAmount.mul(bn('1e9')).add(1).sub(issueAmount))
        ).to.be.revertedWith('BU rate out of range')
        await rToken
          .connect(signer)
          .mint(addr1.address, issueAmount.mul(bn('1e9')).sub(issueAmount))
      })
    })

    it('Should not allow melt to set BU exchange rate to below 1e-9', async () => {
      // melt()
      await expect(
        rToken.connect(addr1).melt(issueAmount.sub(issueAmount.div(bn('1e9'))).add(1))
      ).to.be.revertedWith('BU rate out of range')
      await rToken.connect(addr1).melt(issueAmount.sub(issueAmount.div(bn('1e9'))))
    })
  })

  describe('Reward Claiming #fast', () => {
    it('should not claim rewards when paused', async () => {
      await main.connect(owner).pause()
      await expect(rToken.claimRewards()).to.be.revertedWith('paused or frozen')
      await expect(rToken.claimRewardsSingle(token0.address)).to.be.revertedWith('paused or frozen')
    })

    it('should not sweep rewards when paused', async () => {
      await main.connect(owner).pause()
      await expect(rToken.sweepRewards()).to.be.revertedWith('paused or frozen')
      await expect(rToken.sweepRewardsSingle(token0.address)).to.be.revertedWith('paused or frozen')
    })

    it('should not claim rewards when frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(rToken.claimRewards()).to.be.revertedWith('paused or frozen')
      await expect(rToken.claimRewardsSingle(token0.address)).to.be.revertedWith('paused or frozen')
    })

    it('should not claim rewards when frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(rToken.sweepRewards()).to.be.revertedWith('paused or frozen')
      await expect(rToken.sweepRewardsSingle(token0.address)).to.be.revertedWith('paused or frozen')
    })
  })

  describe('Reward Sweeping #fast', () => {
    const issueAmt = bn('100000e18')
    const amt = fp('2')

    beforeEach(async () => {
      // Provide approvals for future issuances
      await token0.connect(addr1).approve(rToken.address, issueAmt)
      await token1.connect(addr1).approve(rToken.address, issueAmt)
      await token2.connect(addr1).approve(rToken.address, issueAmt)
      await token3.connect(addr1).approve(rToken.address, issueAmt)
    })

    it('should sweep without liabilities', async () => {
      await token0.mint(rToken.address, amt)

      const smallerAmt = bn('10000e18') // fits in one block
      await rToken.connect(addr1).issue(smallerAmt) // fast issuance

      await expect(rToken.sweepRewards())
        .to.emit(token0, 'Transfer')
        .withArgs(rToken.address, backingManager.address, amt)

      await token0.mint(rToken.address, amt.add(1))

      await rToken.connect(addr1).redeem(smallerAmt)

      await expect(rToken.sweepRewards())
        .to.emit(token0, 'Transfer')
        .withArgs(rToken.address, backingManager.address, amt.add(1))
    })

    it('should not sweep with full liabilities', async () => {
      await rToken.connect(addr1).issue(issueAmt) // slow issuance
      await expect(rToken.sweepRewards()).to.not.emit(token0, 'Transfer')
    })

    it('should sweep with partial liabilities', async () => {
      await rToken.connect(addr1).issue(issueAmt) // slow issuance

      await token0.mint(rToken.address, amt)
      await expect(rToken.sweepRewards())
        .to.emit(token0, 'Transfer')
        .withArgs(rToken.address, backingManager.address, amt)
    })

    // ===

    it('should single sweep without liabilities', async () => {
      await token0.mint(rToken.address, amt)

      const smallerAmt = bn('10000e18') // fits in one block
      await rToken.connect(addr1).issue(smallerAmt) // fast issuance

      await expect(rToken.sweepRewardsSingle(token0.address))
        .to.emit(token0, 'Transfer')
        .withArgs(rToken.address, backingManager.address, amt)

      await token0.mint(rToken.address, amt.add(1))

      await rToken.connect(addr1).redeem(smallerAmt)

      await expect(rToken.sweepRewardsSingle(token0.address))
        .to.emit(token0, 'Transfer')
        .withArgs(rToken.address, backingManager.address, amt.add(1))
    })

    it('should not single sweep with full liabilities', async () => {
      await rToken.connect(addr1).issue(issueAmt) // slow issuance
      await expect(rToken.sweepRewardsSingle(token0.address)).to.not.emit(token0, 'Transfer')
    })

    it('should single sweep with partial liabilities', async () => {
      await rToken.connect(addr1).issue(issueAmt) // slow issuance

      await token0.mint(rToken.address, amt)
      await expect(rToken.sweepRewardsSingle(token0.address))
        .to.emit(token0, 'Transfer')
        .withArgs(rToken.address, backingManager.address, amt)
    })
  })

  describe('Transfers #fast', () => {
    let amount: BigNumber

    beforeEach(async function () {
      amount = bn('10e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(amount)
    })

    it('Should transfer tokens between accounts', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      //  Perform transfer
      await rToken.connect(addr1).transfer(addr2.address, amount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev.add(amount))
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should not transfer if no balance', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      //  Perform transfer with user with no balance
      await expect(rToken.connect(addr2).transfer(addr1.address, amount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )

      // Nothing transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should not transfer from/to zero address', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      // Attempt to send to zero address
      await expect(rToken.connect(addr1).transfer(ZERO_ADDRESS, amount)).to.be.revertedWith(
        'ERC20: transfer to the zero address'
      )

      // Attempt to send from zero address - Impersonation is the only way to get to this validation
      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(rToken.connect(signer).transfer(addr2.address, amount)).to.be.revertedWith(
          'ERC20: transfer from the zero address'
        )
      })

      // Nothing transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should not allow transfer/transferFrom to address(this)', async () => {
      // transfer
      await expect(rToken.connect(addr1).transfer(rToken.address, 1)).to.be.revertedWith(
        'RToken transfer to self'
      )

      // transferFrom
      await rToken.connect(addr1).approve(addr2.address, 1)
      await expect(
        rToken.connect(addr2).transferFrom(addr1.address, rToken.address, 1)
      ).to.be.revertedWith('RToken transfer to self')
    })

    it('Should transferFrom between accounts', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      // Set allowance and transfer
      await rToken.connect(addr1).approve(addr2.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)

      await rToken.connect(addr2).transferFrom(addr1.address, other.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.balanceOf(other.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should set allowance when using "Permit"', async () => {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      const permit = await signERC2612Permit(
        addr1,
        rToken.address,
        addr1.address,
        addr2.address,
        amount.toString()
      )

      await expect(
        rToken.permit(
          addr1.address,
          addr2.address,
          amount,
          permit.deadline,
          permit.v,
          permit.r,
          permit.s
        )
      )
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)
    })

    it('Should perform validations on "Permit"', async () => {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      // Set invalid signature
      const permit = await signERC2612Permit(
        addr1,
        rToken.address,
        addr1.address,
        addr2.address,
        amount.add(1).toString()
      )

      // Attempt to run permit with invalid signature
      await expect(
        rToken.permit(
          addr1.address,
          addr2.address,
          amount,
          permit.deadline,
          permit.v,
          permit.r,
          permit.s
        )
      ).to.be.revertedWith('ERC20Permit: invalid signature')

      // Attempt to run permit with expired deadline
      await expect(
        rToken.permit(
          addr1.address,
          addr2.address,
          amount,
          (await getLatestBlockTimestamp()) - 1,
          permit.v,
          permit.r,
          permit.s
        )
      ).to.be.revertedWith('ERC20Permit: expired deadline')

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)
    })

    it('Should not transferFrom if no allowance', async function () {
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const totalSupplyPrev = await rToken.totalSupply()

      // Transfer
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)
      await expect(
        rToken.connect(addr2).transferFrom(addr1.address, other.address, amount)
      ).to.be.revertedWith('ERC20: insufficient allowance')

      // Nothing transferred
      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await rToken.balanceOf(other.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(totalSupplyPrev)
    })

    it('Should perform validations on approvals', async function () {
      expect(await rToken.allowance(addr1.address, ZERO_ADDRESS)).to.equal(0)
      expect(await rToken.allowance(ZERO_ADDRESS, addr2.address)).to.equal(0)

      // Attempt to set allowance to zero address
      await expect(rToken.connect(addr1).approve(ZERO_ADDRESS, amount)).to.be.revertedWith(
        'ERC20: approve to the zero address'
      )

      // Attempt set allowance from zero address - Impersonation is the only way to get to this validation
      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(rToken.connect(signer).approve(addr2.address, amount)).to.be.revertedWith(
          'ERC20: approve from the zero address'
        )
      })

      // Nothing set
      expect(await rToken.allowance(addr1.address, ZERO_ADDRESS)).to.equal(0)
      expect(await rToken.allowance(ZERO_ADDRESS, addr2.address)).to.equal(0)
    })

    it('Should allow to increase/decrease allowances', async function () {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      //  Increase allowance
      await expect(rToken.connect(addr1).increaseAllowance(addr2.address, amount))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)

      // Increase again
      await expect(rToken.connect(addr1).increaseAllowance(addr2.address, amount))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount.mul(2))

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount.mul(2))

      // Decrease allowance
      await expect(rToken.connect(addr1).decreaseAllowance(addr2.address, amount))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)

      // Should not allow to decrease below zero
      await expect(
        rToken.connect(addr1).decreaseAllowance(addr2.address, amount.add(1))
      ).to.be.revertedWith('ERC20: decreased allowance below zero')

      // No changes
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(amount)
    })

    it('Should not decrease allowance when Max allowance pattern is used', async function () {
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(0)

      // Increase to maximum allowance
      await expect(rToken.connect(addr1).increaseAllowance(addr2.address, MAX_UINT256))
        .to.emit(rToken, 'Approval')
        .withArgs(addr1.address, addr2.address, MAX_UINT256)

      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(MAX_UINT256)

      // Perform a transfer, should not decrease allowance (Max allowance pattern assumed)
      await rToken.connect(addr2).transferFrom(addr1.address, other.address, amount)

      // Remains the same
      expect(await rToken.allowance(addr1.address, addr2.address)).to.equal(MAX_UINT256)
    })
  })

  describe('ERC1271 permit #fast', () => {
    const issueAmount = bn('100e18') // fits into one block
    let erc1271Mock: ERC1271Mock

    beforeEach(async () => {
      const ERC1271Factory = await ethers.getContractFactory('ERC1271Mock')
      erc1271Mock = await ERC1271Factory.deploy()

      // Issue
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Give RToken balance at ERC1271Mock
      await rToken.connect(addr1).transfer(erc1271Mock.address, issueAmount)
    })

    it('should not permit without ERC1271 support', async () => {
      // Try a smart contract that does not support ERC1271
      await expect(
        rToken.permit(
          main.address,
          addr1.address,
          issueAmount,
          bn(2).pow(255),
          0,
          ethers.utils.formatBytes32String(''),
          ethers.utils.formatBytes32String('')
        )
      ).to.be.reverted
      expect(await rToken.allowance(main.address, addr1.address)).to.equal(0)

      // Try the ERC1271Mock with approvals turned off
      await expect(
        rToken.permit(
          erc1271Mock.address,
          addr1.address,
          issueAmount,
          bn(2).pow(255),
          0,
          ethers.utils.formatBytes32String(''),
          ethers.utils.formatBytes32String('')
        )
      ).to.be.revertedWith('ERC1271: Unauthorized')
      expect(await rToken.allowance(erc1271Mock.address, addr1.address)).to.equal(0)
    })

    it('should permit spend with ERC1271 support', async () => {
      // ERC1271 with approvals turned on
      expect(await rToken.nonces(erc1271Mock.address)).to.equal(0)
      await erc1271Mock.enableApprovals()
      await rToken.permit(
        erc1271Mock.address,
        addr1.address,
        issueAmount,
        bn(2).pow(255),
        0,
        ethers.utils.formatBytes32String(''),
        ethers.utils.formatBytes32String('')
      )
      expect(await rToken.allowance(erc1271Mock.address, addr1.address)).to.equal(issueAmount)
      await rToken.connect(addr1).transferFrom(erc1271Mock.address, addr1.address, issueAmount)
      expect(await rToken.balanceOf(erc1271Mock.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.nonces(erc1271Mock.address)).to.equal(1)
    })
  })

  context(`Extreme Values`, () => {
    // makeColl: Deploy and register a new constant-price collateral
    async function makeColl(index: number | string, price: BigNumber): Promise<ERC20Mock> {
      const ERC20: ContractFactory = await ethers.getContractFactory('ERC20Mock')
      const erc20: ERC20Mock = <ERC20Mock>await ERC20.deploy('Token ' + index, 'T' + index)
      const OracleFactory: ContractFactory = await ethers.getContractFactory('MockV3Aggregator')
      const oracle: MockV3Aggregator = <MockV3Aggregator>await OracleFactory.deploy(8, bn('1e8'))
      const CollateralFactory: ContractFactory = await ethers.getContractFactory('FiatCollateral', {
        libraries: { OracleLib: oracle.address },
      })
      const coll: FiatCollateral = <FiatCollateral>(
        await CollateralFactory.deploy(
          fp('1'),
          oracle.address,
          erc20.address,
          fp('1e36'),
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          fp('0.05'),
          bn(86400)
        )
      )
      await assetRegistry.register(coll.address)
      expect(await assetRegistry.isRegistered(erc20.address)).to.be.true
      await setOraclePrice(coll.address, price)
      return erc20
    }

    async function forceUpdateGetStatus(): Promise<CollateralStatus> {
      await whileImpersonating(basketHandler.address, async (bhSigner) => {
        await assetRegistry.connect(bhSigner).refresh()
      })
      return basketHandler.status()
    }

    async function runScenario([
      toIssue,
      toRedeem,
      totalSupply, // in this scenario, rtoken supply _after_ issuance.
      numBasketAssets,
      weightFirst, // target amount per asset (weight of first asset)
      weightRest, // another target amount per asset (weight of second+ assets)
      issuanceRate, // range under test: [.000_001 to 1.0]
    ]: BigNumber[]) {
      // skip nonsense cases
      if (
        (numBasketAssets.eq(1) && !weightRest.eq(1)) ||
        toRedeem.gt(totalSupply) ||
        toIssue.gt(totalSupply)
      ) {
        return
      }

      // ==== Deploy and register basket collateral

      const N = numBasketAssets.toNumber()
      const erc20s: ERC20Mock[] = []
      const weights: BigNumber[] = []
      let totalWeight: BigNumber = fp(0)
      for (let i = 0; i < N; i++) {
        const erc20 = await makeColl(i, fp('0.00025'))
        erc20s.push(erc20)
        const currWeight = i == 0 ? weightFirst : weightRest
        weights.push(currWeight)
        totalWeight = totalWeight.add(currWeight)
      }
      expect(await forceUpdateGetStatus()).to.equal(CollateralStatus.SOUND)

      // ==== Switch Basket

      const basketAddresses: string[] = erc20s.map((erc20) => erc20.address)
      await basketHandler.connect(owner).setPrimeBasket(basketAddresses, weights)
      await basketHandler.connect(owner).refreshBasket()
      expect(await forceUpdateGetStatus()).to.equal(CollateralStatus.SOUND)

      for (let i = 0; i < basketAddresses.length; i++) {
        expect(await basketHandler.quantity(basketAddresses[i])).to.equal(weights[i])
      }

      // ==== Mint basket tokens to owner and addr1

      const toIssue0 = totalSupply.sub(toIssue)
      const e18 = BN_SCALE_FACTOR
      for (let i = 0; i < N; i++) {
        const erc20: ERC20Mock = erc20s[i]
        // user owner starts with enough basket assets to issue (totalSupply - toIssue)
        const toMint0: BigNumber = toIssue0.mul(weights[i]).add(e18.sub(1)).div(e18)
        await erc20.mint(owner.address, toMint0)
        await erc20.connect(owner).increaseAllowance(rToken.address, toMint0)

        // user addr1 starts with enough basket assets to issue (toIssue)
        const toMint: BigNumber = toIssue.mul(weights[i]).add(e18.sub(1)).div(e18)
        await erc20.mint(addr1.address, toMint)
        await erc20.connect(addr1).increaseAllowance(rToken.address, toMint)
      }

      await rToken.connect(owner).setIssuanceRate(issuanceRate)

      // ==== Issue the "initial" rtoken supply to owner

      expect(await rToken.balanceOf(owner.address)).to.equal(bn(0))
      await issueMany(facade, rToken, toIssue0, owner)
      expect(await rToken.balanceOf(owner.address)).to.equal(toIssue0)

      // ==== Issue the toIssue supply to addr1

      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      await issueMany(facade, rToken, toIssue, addr1)
      expect(await rToken.balanceOf(addr1.address)).to.equal(toIssue)

      // ==== Send enough rTokens to addr2 that it can redeem the amount `toRedeem`

      // owner has toIssue0 rToken, addr1 has toIssue rToken.
      if (toRedeem.lte(toIssue0)) {
        await rToken.connect(owner).transfer(addr2.address, toRedeem)
      } else {
        await rToken.connect(owner).transfer(addr2.address, toIssue0)
        await rToken.connect(addr1).transfer(addr2.address, toRedeem.sub(toIssue0))
      }
      expect(await rToken.balanceOf(addr2.address)).to.equal(toRedeem)

      // ==== Redeem tokens

      await rToken.connect(addr2).redeem(toRedeem)
      expect(await rToken.balanceOf(addr2.address)).to.equal(0)
    }

    // ==== Generate the tests
    const MAX_RTOKENS = bn('1e48')
    const MAX_WEIGHT = fp(1000)
    const MIN_WEIGHT = fp('1e-6')
    const MIN_ISSUANCE_FRACTION = fp('1e-6')

    let paramList

    if (SLOW) {
      const bounds: BigNumber[][] = [
        [bn(1), MAX_RTOKENS, bn('1.205e24')], // toIssue
        [bn(1), MAX_RTOKENS, bn('4.4231e24')], // toRedeem
        [MAX_RTOKENS, bn('7.907e24')], // totalSupply
        [bn(1), bn(3)], // numAssets
        [MIN_WEIGHT, MAX_WEIGHT, fp('0.1')], // weightFirst
        [MIN_WEIGHT, MAX_WEIGHT, fp('0.2')], // weightRest
        [fp('0.00025'), fp(1), MIN_ISSUANCE_FRACTION], // issuanceRate
      ]

      // A few big heavy test cases
      const bounds2: BigNumber[][] = [
        [MAX_RTOKENS, bn(1)],
        [MAX_RTOKENS, bn(1)],
        [MAX_RTOKENS],
        [bn(255)],
        [MAX_WEIGHT, MIN_WEIGHT],
        [MAX_WEIGHT, MIN_WEIGHT],
        [fp('0.1')],
      ]

      paramList = cartesianProduct(...bounds).concat(cartesianProduct(...bounds2))
    } else {
      const bounds: BigNumber[][] = [
        [bn(1), MAX_RTOKENS], // toIssue
        [bn(1), MAX_RTOKENS], // toRedeem
        [MAX_RTOKENS], // totalSupply
        [bn(1)], // numAssets
        [MIN_WEIGHT, MAX_WEIGHT], // weightFirst
        [MIN_WEIGHT], // weightRest
        [MIN_ISSUANCE_FRACTION, fp(1)], // issuanceRate
      ]
      paramList = cartesianProduct(...bounds)
    }
    const numCases = paramList.length.toString()
    paramList.forEach((params, index) => {
      it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
        await runScenario(params)
      })
    })
  })

  describeGas('Gas Reporting', () => {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')
    let issueAmount: BigNumber

    beforeEach(async () => {
      issueAmount = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)
    })

    it('Transfer', async () => {
      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Vest
      await advanceTime(100)
      await advanceTime(100)
      await rToken.vest(addr1.address, await endIdForVest(addr1.address))
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Transfer
      await snapshotGasCost(rToken.connect(addr1).transfer(addr2.address, issueAmount.div(2)))

      // Transfer again
      await snapshotGasCost(rToken.connect(addr1).transfer(addr2.address, issueAmount.div(2)))

      // Transfer back
      await snapshotGasCost(rToken.connect(addr2).transfer(addr1.address, issueAmount))
    })

    it('Issuance: within block', async () => {
      // Issue rTokens twice within block
      await snapshotGasCost(rToken.connect(addr1).issue(issueAmount.div(2)))
      await snapshotGasCost(rToken.connect(addr1).issue(issueAmount.div(2)))
    })

    it('Issuance: across blocks', async () => {
      // Issue 1
      await snapshotGasCost(rToken.connect(addr1).issue(issueAmount))
      await snapshotGasCost(rToken.connect(addr1).issue(issueAmount))
    })

    it('Issuance: vesting', async () => {
      // Issue
      await rToken.connect(addr1).issue(issueAmount)
      await rToken.connect(addr1).issue(issueAmount)

      // Vest
      await advanceTime(100)
      await snapshotGasCost(rToken.vest(addr1.address, await endIdForVest(addr1.address)))

      // Vest
      await advanceTime(100)
      await snapshotGasCost(rToken.vest(addr1.address, await endIdForVest(addr1.address)))
    })

    it('Redemption', async () => {
      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount.div(2))
      await snapshotGasCost(rToken.connect(addr1).redeem(issueAmount.div(2)))
    })
  })
})

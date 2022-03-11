import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { BN_SCALE_FACTOR, CollateralStatus } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveOracleMock,
  ATokenFiatCollateral,
  BackingManagerP0,
  BasketHandlerP0,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeP0,
  MainP0,
  RTokenP0,
  StaticATokenMock,
  USDCMock,
} from '../../typechain'
import { whileImpersonating } from '../utils/impersonation'
import { advanceTime, advanceBlocks, getLatestBlockNumber } from '../utils/time'
import { Collateral, defaultFixture, IConfig } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('RTokenP0 contract', () => {
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

  // Config values
  let config: IConfig

  // Aave / Compound
  let aaveOracleInternal: AaveOracleMock
  // Main
  let main: MainP0
  let rToken: RTokenP0
  let facade: FacadeP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      aaveOracleInternal,
      basket,
      config,
      main,
      rToken,
      facade,
      backingManager,
      basketHandler,
      rToken,
      facade,
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

    initialBasketNonce = (await basketHandler.lastSet())[0]

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

  describe('Deployment', () => {
    it('Deployment should setup RToken correctly', async () => {
      expect(await rToken.name()).to.equal('RTKN RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.basketsNeeded()).to.equal(0)

      // Check RToken price
      expect(await rToken.price()).to.equal(fp('1'))
    })
  })

  describe('Configuration', () => {
    it('Should allow to set basketsNeeded only from Main components', async () => {
      // Check initial status
      expect(await rToken.basketsNeeded()).to.equal(0)

      // Try to update value if not a Main component
      await expect(rToken.connect(owner).setBasketsNeeded(fp('1'))).to.be.revertedWith(
        'Component: caller is not a component'
      )

      await whileImpersonating(basketHandler.address, async (bhSigner) => {
        await expect(rToken.connect(bhSigner).setBasketsNeeded(fp('1')))
          .to.emit(rToken, 'BasketsNeededChanged')
          .withArgs(0, fp('1'))
      })

      // Check updated value
      expect(await rToken.basketsNeeded()).to.equal(fp('1'))
    })

    it('Should allow to update issuanceRate if Owner', async () => {
      const newValue: BigNumber = fp('0.1')

      // Check existing value
      expect(await rToken.issuanceRate()).to.equal(config.issuanceRate)

      // If not owner cannot update
      await expect(rToken.connect(other).setIssuanceRate(newValue)).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Check value did not change
      expect(await rToken.issuanceRate()).to.equal(config.issuanceRate)

      // Update with owner
      await expect(rToken.connect(owner).setIssuanceRate(newValue))
        .to.emit(rToken, 'IssuanceRateSet')
        .withArgs(rToken.issuanceRate, newValue)

      // Check value was updated
      expect(await rToken.issuanceRate()).to.equal(newValue)
    })
  })

  describe('Issuance and Slow Minting', function () {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    it('Should not issue RTokens if paused', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Pause Main
      await main.connect(owner).pause()

      // Try to issue
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith('paused')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Try to issue
      await expect(rToken.connect(addr1).issue(zero)).to.be.revertedWith('Cannot issue zero')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn('0'))
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn('10e18')

      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
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
      await basketHandler.connect(owner).switchBasket()

      // Check RToken price
      expect(await rToken.price()).to.equal(fp('1'))

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Check Balances after
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(rToken.address)).to.equal(issueAmount)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal.sub(issueAmount))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)

      // Check if minting was registered
      const currentBlockNumber = await getLatestBlockNumber()
      let [sm_minter, sm_amt, , sm_basketNonce, sm_availableAt, sm_proc] = await rToken.issuances(
        addr1.address,
        0
      )
      const blockAddPct: BigNumber = issueAmount.mul(BN_SCALE_FACTOR).div(MIN_ISSUANCE_PER_BLOCK)
      expect(sm_basketNonce).to.equal(initialBasketNonce.add(2))
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_availableAt).to.equal(fp(currentBlockNumber - 1).add(blockAddPct))
      expect(sm_proc).to.equal(false)

      // Process issuance
      await advanceBlocks(17)

      let endID = await rToken.endIdForVest(addr1.address)
      expect(endID).to.equal(1)
      await rToken.vest(addr1.address, 1)

      // Check minting is confirmed
      ;[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(true)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Check asset value
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
    })

    it('Should issue RTokens correctly for more complex basket multiple users', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const quotes: BigNumber[] = await rToken.connect(addr1).callStatic.issue(issueAmount)

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
      await rToken.connect(addr1).issue(issueAmount)

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
      let [sm_minter, sm_amt, , sm_basketNonce, sm_availableAt, sm_proc] = await rToken.issuances(
        addr1.address,
        0
      )

      const blockAddPct: BigNumber = issueAmount.mul(BN_SCALE_FACTOR).div(MIN_ISSUANCE_PER_BLOCK)
      expect(sm_basketNonce).to.equal(initialBasketNonce)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_availableAt).to.equal(fp(currentBlockNumber - 1).add(blockAddPct))
      expect(sm_proc).to.equal(false)

      // Issue new RTokens with different user
      // This will also process the previous minting and send funds to the minter
      // Provide approvals
      await token0.connect(addr2).approve(rToken.address, initialBal)
      await token1.connect(addr2).approve(rToken.address, initialBal)
      await token2.connect(addr2).approve(rToken.address, initialBal)
      await token3.connect(addr2).approve(rToken.address, initialBal)
      advanceBlocks(1)
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Check asset value at this point
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

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
      ;[sm_minter, sm_amt, , sm_basketNonce, sm_availableAt, sm_proc] = await rToken.issuances(
        addr2.address,
        0
      )
      expect(sm_basketNonce).to.equal(initialBasketNonce)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr2.address)
      expect(sm_availableAt).to.equal(fp(currentBlockNumber - 1).add(blockAddPct))
      expect(sm_proc).to.equal(false)

      // Complete 2nd issuance
      advanceBlocks(1)
      await rToken.vest(addr2.address, await rToken.endIdForVest(addr2.address))

      // Check issuance is confirmed
      ;[, , , , , sm_proc] = await rToken.issuances(addr2.address, 0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr2.address)).to.equal(issueAmount)

      // Check asset value
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(2))
    })

    it('Should not issue/vest RTokens if collateral defaulted', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Default one of the tokens - 50% price reduction and mark default as probable
      await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))
      await collateral1.forceUpdates()
      expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
      expect(await basketHandler.fullyCapitalized()).to.equal(true)

      // Attempt to vest (pending 1 block)
      advanceBlocks(1)
      await expect(
        rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))
      ).to.be.revertedWith('collateral default')

      // Check previous minting was not processed
      let [, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(false)
      expect(await rToken.totalSupply()).to.equal(bn('0'))
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Cannot start a new issuance either
      await expect(rToken.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'collateral not sound'
      )

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn('0'))
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)
    })

    it('Should return maxIssuable correctly', async () => {
      const issueAmount = initialBal.div(2)

      // Check values, with no issued tokens
      expect(await facade.callStatic.maxIssuable(addr1.address)).to.equal(initialBal.mul(4))
      expect(await facade.callStatic.maxIssuable(addr2.address)).to.equal(initialBal.mul(4))
      expect(await facade.callStatic.maxIssuable(other.address)).to.equal(0)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, issueAmount)
      await token1.connect(addr1).approve(rToken.address, issueAmount)
      await token2.connect(addr1).approve(rToken.address, issueAmount)
      await token3.connect(addr1).approve(rToken.address, issueAmount)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)

      // Process slow issuances
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check values, with issued tokens
      expect(await facade.callStatic.maxIssuable(addr1.address)).to.equal(
        initialBal.mul(4).sub(issueAmount)
      )
      expect(await facade.callStatic.maxIssuable(addr2.address)).to.equal(initialBal.mul(4))
      expect(await facade.callStatic.maxIssuable(other.address)).to.equal(0)
    })

    it('Should process issuances in multiple attempts (using minimum issuance)', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(4)

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const quotes: BigNumber[] = await rToken.connect(addr1).callStatic.issue(issueAmount)

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
      let currentBlockNumber = await getLatestBlockNumber()
      let [sm_minter, sm_amt, , sm_basketNonce, sm_availableAt, sm_proc] = await rToken.issuances(
        addr1.address,
        0
      )
      expect(sm_basketNonce).to.equal(initialBasketNonce)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_availableAt).to.equal(fp(currentBlockNumber + 3))
      expect(sm_proc).to.equal(false)

      // Nothing should process
      expect(
        await rToken.callStatic.vest(addr1.address, await rToken.endIdForVest(addr1.address))
      ).to.equal(0)
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check previous minting was not processed[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(false)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check asset value at this point (still nothing issued)
      expect(await facade.callStatic.totalAssetValue()).to.equal(0)

      // Process 4 blocks
      await advanceTime(100)
      await advanceTime(100)
      await advanceTime(100)
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)

      // Check asset value
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)
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

      // Process slow issuances
      await advanceTime(100)
      await advanceTime(100)
      await advanceTime(100)
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check issuance was confirmed
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Set issuance rate to 50% per block
      // Update config
      rToken.connect(owner).setIssuanceRate(fp('0.5'))

      // Try new issuance. Should be based on issuance rate = 50% per block should take two blocks
      // Based on current supply its gonna be 25000e18 tokens per block
      const ISSUANCE_PER_BLOCK = (await rToken.totalSupply()).div(2)
      const newIssuanceAmt: BigNumber = ISSUANCE_PER_BLOCK.mul(3)

      // Issue rTokens
      await rToken.connect(addr1).issue(newIssuanceAmt)

      // Check if minting was registered
      let currentBlockNumber = await getLatestBlockNumber()

      let [sm_minter, sm_amt, , sm_basketNonce, sm_availableAt, sm_proc] = await rToken.issuances(
        addr1.address,
        1
      )
      const blockAddPct: BigNumber = newIssuanceAmt.mul(BN_SCALE_FACTOR).div(ISSUANCE_PER_BLOCK)
      expect(sm_basketNonce).to.equal(initialBasketNonce)
      expect(sm_amt).to.equal(newIssuanceAmt)
      expect(sm_minter).to.equal(addr1.address)
      // Using issuance rate of 50% = 2 blocks
      expect(sm_availableAt).to.equal(fp(currentBlockNumber - 1).add(blockAddPct))
      expect(sm_proc).to.equal(false)

      // Should not process
      expect(
        await rToken.callStatic.vest(addr1.address, await rToken.endIdForVest(addr1.address))
      ).to.equal(0)
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check previous minting was not processed
      // [, , , , , sm_proc] = await rToken.issuances(addr1.address, 1)
      expect(sm_proc).to.equal(false)
      expect(await rToken.totalSupply()).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

      // Check asset value at this point (still nothing issued beyond initial amount)
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

      // Process slow mintings one more time
      advanceBlocks(1)
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await rToken.issuances(addr1.address, 1)
      expect(sm_proc).to.equal(true)
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(newIssuanceAmt))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssuanceAmt))

      // Check asset value
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.add(newIssuanceAmt))
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
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

      // Process another block to get the 2nd issuance processed
      await rToken.vest(addr1.address, 2)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount))
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.add(newIssueAmount))

      // Process another block to get the 3rd issuance processed
      await rToken.vest(addr1.address, 3)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount.mul(2)))
      expect(await facade.callStatic.totalAssetValue()).to.equal(
        issueAmount.add(newIssueAmount.mul(2))
      )
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

      // Check mintings
      // First minting
      let currentBlockNumber = await getLatestBlockNumber()
      let [sm_minter, sm_amt, , sm_basketNonce, sm_availableAt, sm_proc] = await rToken.issuances(
        addr1.address,
        0
      )
      const blockAddPct: BigNumber = issueAmount.mul(BN_SCALE_FACTOR).div(MIN_ISSUANCE_PER_BLOCK)
      expect(sm_basketNonce).to.equal(initialBasketNonce)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_availableAt).to.equal(fp(currentBlockNumber - 1).add(blockAddPct))
      expect(sm_proc).to.equal(true)

      // Second minting
      ;[sm_minter, sm_amt, , sm_basketNonce, sm_availableAt, sm_proc] = await rToken.issuances(
        addr1.address,
        1
      )
      expect(sm_basketNonce).to.equal(initialBasketNonce)
      expect(sm_amt).to.equal(issueAmount)
      expect(sm_minter).to.equal(addr1.address)
      expect(sm_availableAt).to.equal(fp(currentBlockNumber - 1).add(fp('1')))
      expect(sm_proc).to.equal(true)

      // Check both slow mintings are confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.mul(2))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(2))

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])

      // Process issuances
      expect(
        await rToken.callStatic.vest(addr1.address, await rToken.endIdForVest(addr1.address))
      ).to.equal(0)
      await rToken.callStatic.vest(addr1.address, await rToken.endIdForVest(addr1.address))
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
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

      // Process issuance 2
      await rToken.vest(addr1.address, 2)

      // Check second mintings is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.add(newIssueAmount))
    })

    it('Should allow the issuer to rollback minting', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const quotes: BigNumber[] = await rToken.connect(addr1).callStatic.issue(issueAmount)
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
      let [, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(false)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Cancel with issuer
      await expect(rToken.connect(addr1).cancel(1, true))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 1)

      // Check minting was cancelled but not tokens minted
      ;[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check balances returned to user
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

      // Check total asset value did not change
      expect(await facade.callStatic.totalAssetValue()).to.equal(0)

      // Another call will not do anything, will not revert
      await rToken.connect(addr1).cancel(1, true)
    })

    it('Should rollback mintings if Basket changes (2 blocks)', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      // Provide approvals
      await token0.connect(addr1).approve(rToken.address, initialBal)
      await token1.connect(addr1).approve(rToken.address, initialBal)
      await token2.connect(addr1).approve(rToken.address, initialBal)
      await token3.connect(addr1).approve(rToken.address, initialBal)

      const quotes: BigNumber[] = await rToken.connect(addr1).callStatic.issue(issueAmount)

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

      // Update basket to trigger rollbacks (using same one to keep fullyCapitalized = true)
      await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
      await basketHandler.connect(owner).switchBasket()

      // Cancel slow issuances
      await expect(rToken.connect(addr1).cancel(0, false))
        .to.emit(rToken, 'IssuancesCanceled')
        .withArgs(addr1.address, 0, 1)

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
      let sm_proc
      ;[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Check total asset value did not change
      expect(await facade.callStatic.totalAssetValue()).to.equal(0)
    })
  })

  describe('Redeem', function () {
    it('Should revert if zero amount', async function () {
      const zero: BigNumber = bn('0')
      await expect(rToken.connect(addr1).redeem(zero)).to.be.revertedWith('Cannot redeem zero')
    })

    it('Should revert if no balance of RToken', async function () {
      const redeemAmount: BigNumber = bn('20000e18')

      await expect(rToken.connect(addr1).redeem(redeemAmount)).to.be.revertedWith(
        'not enough RToken'
      )
    })

    context('With issued RTokens', async function () {
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
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

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
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.sub(redeemAmount))
      })

      it('Should redeem RTokens correctly for multiple users', async function () {
        const issueAmount = bn('100e18')
        const redeemAmount = bn('100e18')

        //Issue new RTokens
        await token0.connect(addr2).approve(rToken.address, initialBal)
        await token1.connect(addr2).approve(rToken.address, initialBal)
        await token2.connect(addr2).approve(rToken.address, initialBal)
        await token3.connect(addr2).approve(rToken.address, initialBal)
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount)

        //Issue rTokens
        await rToken.connect(addr2).issue(issueAmount)

        // Check asset value
        expect(await facade.callStatic.totalAssetValue()).to.equal(issueAmount.mul(2))

        // Redeem rTokens
        await rToken.connect(addr1).redeem(redeemAmount)

        // Check asset value
        expect(await facade.callStatic.totalAssetValue()).to.equal(
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
        expect(await facade.callStatic.totalAssetValue()).to.equal(
          issueAmount.mul(2).sub(redeemAmount.mul(2))
        )
      })
    })
  })

  describe('Melt/Mint', () => {
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

    it('Should allow to melt tokens if caller', async () => {
      // Melt tokens
      const meltAmount: BigNumber = bn('10e18')

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      await rToken.connect(addr1).melt(meltAmount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(meltAmount))
      expect(await rToken.totalSupply()).to.equal(issueAmount.sub(meltAmount))
    })

    it('Should allow to mint tokens when called by Auctioneer', async () => {
      // Mint tokens
      const mintAmount: BigNumber = bn('10e18')

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      await whileImpersonating(backingManager.address, async (auctioneerSigner) => {
        await rToken.connect(auctioneerSigner).mint(addr1.address, mintAmount)
      })

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(mintAmount))
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(mintAmount))

      // Trying to mint with another account will fail
      await expect(rToken.connect(other).mint(addr1.address, mintAmount)).to.be.revertedWith(
        'Component: caller is not a component'
      )
    })
  })
})

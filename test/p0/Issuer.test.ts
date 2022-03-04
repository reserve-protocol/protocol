import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'

import { BN_SCALE_FACTOR } from '../../common/constants'
import { bn, fp } from '../../common/numbers'
import {
  AaveClaimAdapterP0,
  AaveLendingPoolMockP0,
  AssetP0,
  ATokenFiatCollateralP0,
  CollateralP0,
  CompoundClaimAdapterP0,
  CompoundPricedAssetP0,
  ComptrollerMockP0,
  CTokenFiatCollateralP0,
  CTokenMock,
  DeployerP0,
  ERC20Mock,
  FacadeP0,
  FurnaceP0,
  MainP0,
  MarketMock,
  RevenueTraderP0,
  RTokenAssetP0,
  RTokenP0,
  StaticATokenMock,
  StRSRP0,
  AssetRegistryP0,
  BackingManagerP0,
  BasketHandlerP0,
  IssuerP0,
  DistributorP0,
  USDCMock,
} from '../../typechain'
import { advanceTime, advanceBlocks, getLatestBlockNumber } from '../utils/time'
import { Collateral, defaultFixture, IConfig, IRevenueShare } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('IssuerP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Deployer contract
  let deployer: DeployerP0

  // Assets
  let collateral: Collateral[]

  // Non-backing assets
  let rsr: ERC20Mock
  let rsrAsset: AssetP0
  let compAsset: AssetP0
  let compoundMock: ComptrollerMockP0
  let aaveToken: ERC20Mock
  let aaveAsset: AssetP0
  let aaveMock: AaveLendingPoolMockP0

  // Trading
  let market: MarketMock
  let rsrTrader: RevenueTraderP0
  let rTokenTrader: RevenueTraderP0

  // Tokens and Assets
  let initialBal: BigNumber
  let token0: ERC20Mock
  let token1: USDCMock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: CollateralP0
  let collateral1: CollateralP0
  let collateral2: ATokenFiatCollateralP0
  let collateral3: CTokenFiatCollateralP0
  let basket: Collateral[]
  let basketsNeededAmts: BigNumber[]
  let initialBasketNonce: BigNumber

  // Config values
  let config: IConfig
  let dist: IRevenueShare

  // Contracts to retrieve after deploy
  let rToken: RTokenP0
  let stRSR: StRSRP0
  let furnace: FurnaceP0
  let main: MainP0
  let facade: FacadeP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let issuer: IssuerP0
  let distributor: DistributorP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()
    let erc20s: ERC20Mock[]

      // Deploy fixture
    ;({
      rsr,
      rsrAsset,
      aaveToken,
      compAsset,
      aaveAsset,
      compoundMock,
      aaveMock,
      erc20s,
      collateral,
      basket,
      basketsNeededAmts,
      config,
      deployer,
      dist,
      main,
      rToken,
      furnace,
      stRSR,
      market,
      facade,
      assetRegistry,
      backingManager,
      basketHandler,
      issuer,
      distributor,
      rToken,
      furnace,
      stRSR,
      market,
      facade,
      rsrTrader,
      rTokenTrader,
    } = await loadFixture(defaultFixture))
    token0 = erc20s[collateral.indexOf(basket[0])]
    token1 = erc20s[collateral.indexOf(basket[1])]
    token2 = <StaticATokenMock>erc20s[collateral.indexOf(basket[2])]
    token3 = <CTokenMock>erc20s[collateral.indexOf(basket[3])]

    // Set Aave revenue token
    await token2.setAaveToken(aaveToken.address)

    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = <ATokenFiatCollateralP0>basket[2]
    collateral3 = <CTokenFiatCollateralP0>basket[3]

    initialBasketNonce = (await basketHandler.lastSet())[0]

    rsrTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rsrTrader())
    )
    rTokenTrader = <RevenueTraderP0>(
      await ethers.getContractAt('RevenueTraderP0', await main.rTokenTrader())
    )

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

  describe('Issuance and Slow Minting', function () {
    const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

    it('Should not issue RTokens if paused', async function () {
      const issueAmount: BigNumber = bn('10e18')

      // Pause Main
      await main.connect(owner).pause()

      // Try to issue
      await expect(issuer.connect(addr1).issue(issueAmount)).to.be.revertedWith('paused')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if amount is zero', async function () {
      const zero: BigNumber = bn('0')

      // Try to issue
      await expect(issuer.connect(addr1).issue(zero)).to.be.revertedWith('Cannot issue zero')

      //Check values
      expect(await rToken.totalSupply()).to.equal(bn('0'))
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const issueAmount: BigNumber = bn('10e18')

      await expect(issuer.connect(addr1).issue(issueAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )
      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const issueAmount: BigNumber = bn('10000000000e18')

      await token0.connect(addr1).approve(issuer.address, issueAmount)
      await token1.connect(addr1).approve(issuer.address, issueAmount)
      await token2.connect(addr1).approve(issuer.address, issueAmount)
      await token3.connect(addr1).approve(issuer.address, issueAmount)

      await expect(issuer.connect(addr1).issue(issueAmount)).to.be.revertedWith(
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
      expect(await issuer.rTokenPrice()).to.equal(fp('1'))

      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)

      // check balances before
      expect(await token0.balanceOf(main.address)).to.equal(0)
      expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Issue rTokens
      await issuer.connect(addr1).issue(issueAmount)

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
      expect(await facade.totalAssetValue()).to.equal(issueAmount)
    })

    it('Should issue RTokens correctly for more complex basket multiple users', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(2)

      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      const quotes: BigNumber[] = await issuer.connect(addr1).callStatic.issue(issueAmount)

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
      await issuer.connect(addr1).issue(issueAmount)

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
      await token0.connect(addr2).approve(issuer.address, initialBal)
      await token1.connect(addr2).approve(issuer.address, initialBal)
      await token2.connect(addr2).approve(issuer.address, initialBal)
      await token3.connect(addr2).approve(issuer.address, initialBal)
      advanceBlocks(1)
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check previous minting was processed and funds sent to minter
      ;[, , , , , sm_proc] = await rToken.issuances(addr1.address, 0)
      expect(sm_proc).to.equal(true)
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(main.address)).to.equal(0)

      // Check asset value at this point
      expect(await facade.totalAssetValue()).to.equal(issueAmount)

      // Issue rTokens
      await issuer.connect(addr2).issue(issueAmount)

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
      expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2))
    })

    it('Should return maxIssuable correctly', async () => {
      const issueAmount = initialBal.div(2)

      // Check values, with no issued tokens
      expect(await facade.maxIssuable(addr1.address)).to.equal(initialBal.mul(4))
      expect(await facade.maxIssuable(addr2.address)).to.equal(initialBal.mul(4))
      expect(await facade.maxIssuable(other.address)).to.equal(0)

      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, issueAmount)
      await token1.connect(addr1).approve(issuer.address, issueAmount)
      await token2.connect(addr1).approve(issuer.address, issueAmount)
      await token3.connect(addr1).approve(issuer.address, issueAmount)

      // Issue rTokens
      await issuer.connect(addr1).issue(issueAmount)

      // Process slow issuances
      await rToken.vest(addr1.address, await rToken.endIdForVest(addr1.address))

      // Check values, with issued tokens
      expect(await facade.maxIssuable(addr1.address)).to.equal(initialBal.mul(4).sub(issueAmount))
      expect(await facade.maxIssuable(addr2.address)).to.equal(initialBal.mul(4))
      expect(await facade.maxIssuable(other.address)).to.equal(0)
    })

    it('Should process issuances in multiple attempts (using minimum issuance)', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(4)

      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      const quotes: BigNumber[] = await issuer.connect(addr1).callStatic.issue(issueAmount)

      // Issue rTokens
      await issuer.connect(addr1).issue(issueAmount)

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
      expect(await facade.totalAssetValue()).to.equal(0)

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
      expect(await facade.totalAssetValue()).to.equal(issueAmount)
    })

    it('Should process issuances in multiple attempts (using issuanceRate)', async function () {
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(4)

      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      // Issue rTokens
      await issuer.connect(addr1).issue(issueAmount)

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
      await issuer.connect(addr1).issue(newIssuanceAmt)

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
      expect(await facade.totalAssetValue()).to.equal(issueAmount)

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
      expect(await facade.totalAssetValue()).to.equal(issueAmount.add(newIssuanceAmt))
    })

    it('Should process multiple issuances in the correct order', async function () {
      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      // Issuance #1 - Will be processed in 5 blocks
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.mul(5)
      await issuer.connect(addr1).issue(issueAmount)

      // Issuance #2 and #3 - Will be processed in one additional block each
      const newIssueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK
      await issuer.connect(addr1).issue(newIssueAmount)
      await issuer.connect(addr1).issue(newIssueAmount)

      // Mine remaining block for first issuance (3 already automined by issue calls, this )
      await advanceBlocks(1)
      await rToken.vest(addr1.address, 1)

      // Check first slow minting is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await facade.totalAssetValue()).to.equal(issueAmount)

      // Process another block to get the 2nd issuance processed
      await rToken.vest(addr1.address, 2)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount))
      expect(await facade.totalAssetValue()).to.equal(issueAmount.add(newIssueAmount))

      // Process another block to get the 3rd issuance processed
      await rToken.vest(addr1.address, 3)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount.mul(2)))
      expect(await facade.totalAssetValue()).to.equal(issueAmount.add(newIssueAmount.mul(2)))
    })

    it('Should allow multiple issuances in the same block', async function () {
      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Issuance #1 -  Will be processed in 1 blocks
      const issueAmount: BigNumber = bn('5000e18')
      await issuer.connect(addr1).issue(issueAmount)

      // Issuance #2 - Should be processed in the same block
      await issuer.connect(addr1).issue(issueAmount)

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
      expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2))

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
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Issuance #1 -  Will be processed in 0.5 blocks
      const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.div(2)
      await issuer.connect(addr1).issue(issueAmount)

      // Issuance #2 - Will be processed in 1.0001 blocks
      const newIssueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK.div(2).add(
        MIN_ISSUANCE_PER_BLOCK.div(10000)
      )
      await issuer.connect(addr1).issue(newIssueAmount)

      // Mine block
      await hre.network.provider.send('evm_mine', [])

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])

      // Check first slow mintings is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facade.totalAssetValue()).to.equal(issueAmount)

      // Process issuance 2
      await rToken.vest(addr1.address, 2)

      // Check second mintings is confirmed
      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(newIssueAmount))
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await facade.totalAssetValue()).to.equal(issueAmount.add(newIssueAmount))
    })

    it('Should allow issuer to rollback minting', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      const quotes: BigNumber[] = await issuer.connect(addr1).callStatic.issue(issueAmount)
      const expectedTkn0: BigNumber = quotes[0]
      const expectedTkn1: BigNumber = quotes[1]
      const expectedTkn2: BigNumber = quotes[2]
      const expectedTkn3: BigNumber = quotes[3]

      // Issue rTokens
      await issuer.connect(addr1).issue(issueAmount)

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
      expect(await facade.totalAssetValue()).to.equal(0)

      // Another call will not do anything, will not revert
      await rToken.connect(addr1).cancel(1, true)
    })

    it('Should rollback mintings if Basket changes (2 blocks)', async function () {
      const issueAmount: BigNumber = bn('50000e18')

      // Provide approvals
      await token0.connect(addr1).approve(issuer.address, initialBal)
      await token1.connect(addr1).approve(issuer.address, initialBal)
      await token2.connect(addr1).approve(issuer.address, initialBal)
      await token3.connect(addr1).approve(issuer.address, initialBal)

      const quotes: BigNumber[] = await issuer.connect(addr1).callStatic.issue(issueAmount)

      // Issue rTokens
      await issuer.connect(addr1).issue(issueAmount)

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
      expect(await facade.totalAssetValue()).to.equal(0)
    })
  })

  describe('Redeem', function () {
    it('Should revert if zero amount', async function () {
      const zero: BigNumber = bn('0')
      await expect(issuer.connect(addr1).redeem(zero)).to.be.revertedWith('Cannot redeem zero')
    })

    it('Should revert if no balance of RToken', async function () {
      const redeemAmount: BigNumber = bn('20000e18')

      await expect(issuer.connect(addr1).redeem(redeemAmount)).to.be.revertedWith(
        'not enough RToken'
      )
    })

    context('With issued RTokens', async function () {
      let issueAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        issueAmount = bn('100e18')
        // Provide approvals
        await token0.connect(addr1).approve(issuer.address, initialBal)
        await token1.connect(addr1).approve(issuer.address, initialBal)
        await token2.connect(addr1).approve(issuer.address, initialBal)
        await token3.connect(addr1).approve(issuer.address, initialBal)

        // Issue rTokens
        await issuer.connect(addr1).issue(issueAmount)
      })

      it('Should redeem RTokens correctly', async function () {
        const redeemAmount = bn('100e18')

        // Check balances
        expect(await rToken.balanceOf(addr1.address)).to.equal(redeemAmount)
        expect(await rToken.totalSupply()).to.equal(redeemAmount)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)

        // Redeem rTokens
        await issuer.connect(addr1).redeem(redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(0)
        expect(await rToken.totalSupply()).to.equal(0)

        expect(await token0.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token1.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token2.balanceOf(addr1.address)).to.equal(initialBal)
        expect(await token3.balanceOf(addr1.address)).to.equal(initialBal)

        // Check asset value
        expect(await facade.totalAssetValue()).to.equal(issueAmount.sub(redeemAmount))
      })

      it('Should redeem RTokens correctly for multiple users', async function () {
        const issueAmount = bn('100e18')
        const redeemAmount = bn('100e18')

        //Issue new RTokens
        await token0.connect(addr2).approve(issuer.address, initialBal)
        await token1.connect(addr2).approve(issuer.address, initialBal)
        await token2.connect(addr2).approve(issuer.address, initialBal)
        await token3.connect(addr2).approve(issuer.address, initialBal)
        expect(await facade.totalAssetValue()).to.equal(issueAmount)

        //Issue rTokens
        await issuer.connect(addr2).issue(issueAmount)

        // Check asset value
        expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2))

        // Redeem rTokens
        await issuer.connect(addr1).redeem(redeemAmount)

        // Check asset value
        expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2).sub(redeemAmount))

        // Redeem rTokens with another user
        await issuer.connect(addr2).redeem(redeemAmount)

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
        expect(await facade.totalAssetValue()).to.equal(issueAmount.mul(2).sub(redeemAmount.mul(2)))
      })
    })
  })
})

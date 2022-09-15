import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { BN_SCALE_FACTOR } from '../common/constants'
import { bn, fp } from '../common/numbers'
import {
  CTokenMock,
  ERC20Mock,
  Facade,
  FacadeP1,
  StaticATokenMock,
  StRSRP1,
  TestIStRSR,
  TestIRToken,
  USDCMock,
} from '../typechain'
import { Collateral, Implementation, IMPLEMENTATION, defaultFixture } from './fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('Facade contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Tokens
  let initialBal: BigNumber
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock
  let basket: Collateral[]

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral

  // Facade
  let facade: Facade

  // Main
  let rToken: TestIRToken
  let stRSR: TestIStRSR

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ stRSR, rsr, compToken, aaveToken, basket, facade, rToken } = await loadFixture(
      defaultFixture
    ))

    // Get assets and tokens
    ;[tokenAsset, usdcAsset, aTokenAsset, cTokenAsset] = basket

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())
  })

  describe('Views', () => {
    let issueAmount: BigNumber
    let initialQuotes: BigNumber[]

    beforeEach(async () => {
      await rToken.connect(owner).setIssuanceRate(fp('1'))

      initialQuotes = [bn('0.25e18'), bn('0.25e6'), bn('0.25e18'), bn('1.25e9')]

      // Mint Tokens
      initialBal = bn('10000000000e18')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cToken.connect(owner).mint(addr1.address, initialBal)

      await token.connect(owner).mint(addr2.address, initialBal)
      await usdc.connect(owner).mint(addr2.address, initialBal)
      await aToken.connect(owner).mint(addr2.address, initialBal)
      await cToken.connect(owner).mint(addr2.address, initialBal)

      // Issue some RTokens
      issueAmount = bn('100e18')

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cToken.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('should return the correct facade address', async () => {
      expect(await facade.stToken(rToken.address)).to.equal(stRSR.address)
    })

    it('Should return maxIssuable correctly', async () => {
      // Check values
      expect(await facade.callStatic.maxIssuable(rToken.address, addr1.address)).to.equal(
        bn('39999999900e18')
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
        bn('40000000000e18')
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, other.address)).to.equal(0)
    })

    it('Should return currentAssets correctly', async () => {
      const initialQuantities: BigNumber[] = initialQuotes.map((q) => {
        return q.mul(issueAmount).div(BN_SCALE_FACTOR)
      })

      const [tokens, quantities] = await facade.callStatic.currentAssets(rToken.address)

      // Get Backing ERC20s addresses
      const backingERC20Addrs: string[] = await Promise.all(
        basket.map(async (c): Promise<string> => {
          return await c.erc20()
        })
      )

      // Check token addresses
      expect(tokens[0]).to.equal(rToken.address)
      expect(quantities[0]).to.equal(bn(0))

      expect(tokens[1]).to.equal(rsr.address)
      expect(quantities[1]).to.equal(bn(0))

      expect(tokens[2]).to.equal(aaveToken.address)
      expect(quantities[2]).to.equal(bn(0))

      expect(tokens[3]).to.equal(compToken.address)
      expect(quantities[3]).to.equal(bn(0))

      // Backing tokens
      expect(tokens.slice(4, 8)).to.eql(backingERC20Addrs)
      expect(quantities.slice(4, 8)).to.eql(initialQuantities)
    })

    it('Should return backingOverview correctly', async () => {
      let [backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully capitalized and no insurance
      expect(backing).to.equal(fp('1'))
      expect(insurance).to.equal(0)

      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully capitalized and fully insured
      expect(backing).to.equal(fp('1'))
      expect(insurance).to.equal(fp('0.5'))

      // Stake more RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      expect(backing).to.equal(fp('1'))
      expect(insurance).to.equal(fp('1'))

      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount)

      // Check values = 0 (no supply)
      ;[backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - No supply, returns 0
      expect(backing).to.equal(0)
      expect(insurance).to.equal(0)
    })

    it('Should return basketBreakdown correctly', async () => {
      const [erc20s, breakdown] = await facade.callStatic.basketBreakdown(rToken.address)
      expect(erc20s.length).to.equal(4)
      expect(breakdown.length).to.equal(4)
      expect(erc20s[0]).to.equal(token.address)
      expect(erc20s[1]).to.equal(usdc.address)
      expect(erc20s[2]).to.equal(aToken.address)
      expect(erc20s[3]).to.equal(cToken.address)
      expect(breakdown[0]).to.equal(fp('0.25'))
      expect(breakdown[1]).to.equal(fp('0.25'))
      expect(breakdown[2]).to.equal(fp('0.25'))
      expect(breakdown[3]).to.equal(fp('0.25'))
    })

    it('Should return totalAssetValue correctly', async () => {
      expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
    })

    it('Should return RToken price correctly', async () => {
      expect(await facade.price(rToken.address)).to.equal(fp('1'))
    })

    // P1 only
    if (IMPLEMENTATION == Implementation.P1) {
      let facadeP1: FacadeP1
      let stRSRP1: StRSRP1

      beforeEach(async () => {
        facadeP1 = await ethers.getContractAt('FacadeP1', facade.address)
        stRSRP1 = await ethers.getContractAt('StRSRP1', stRSR.address)
      })

      it('Should return pending issuances', async () => {
        const largeIssueAmount = initialBal.div(10)

        // Issue rTokens
        await rToken.connect(addr1).issue(largeIssueAmount)
        await rToken.connect(addr1).issue(largeIssueAmount.add(1))
        const pendings = await facadeP1.pendingIssuances(rToken.address, addr1.address)

        expect(pendings.length).to.eql(2)
        expect(pendings[0][0]).to.eql(bn(0)) // index
        expect(pendings[0][2]).to.eql(largeIssueAmount) // amount

        expect(pendings[1][0]).to.eql(bn(1)) // index
        expect(pendings[1][2]).to.eql(largeIssueAmount.add(1)) // amount
      })

      it('Should return pending unstakings', async () => {
        const unstakeAmount = bn('10000e18')
        await rsr.connect(owner).mint(addr1.address, unstakeAmount.mul(10))

        // Stake
        await rsr.connect(addr1).approve(stRSR.address, unstakeAmount.mul(10))
        await stRSRP1.connect(addr1).stake(unstakeAmount.mul(10))
        await stRSRP1.connect(addr1).unstake(unstakeAmount)
        await stRSRP1.connect(addr1).unstake(unstakeAmount.add(1))

        const pendings = await facadeP1.pendingUnstakings(rToken.address, addr1.address)
        expect(pendings.length).to.eql(2)
        expect(pendings[0][0]).to.eql(bn(0)) // index
        expect(pendings[0][2]).to.eql(unstakeAmount) // amount

        expect(pendings[1][0]).to.eql(bn(1)) // index
        expect(pendings[1][2]).to.eql(unstakeAmount.add(1)) // amount
      })
    }
  })
})

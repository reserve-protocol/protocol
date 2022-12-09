import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../common/numbers'
import {
  CTokenMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  StaticATokenMock,
  StRSRP1,
  TestIMain,
  TestIStRSR,
  TestIRToken,
  USDCMock,
} from '../typechain'
import {
  Collateral,
  Implementation,
  IMPLEMENTATION,
  defaultFixture,
  ORACLE_ERROR,
} from './fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('FacadeRead contract', () => {
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
  let basket: Collateral[]

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral

  // Facade
  let facade: FacadeRead
  let facadeTest: FacadeTest

  // Main
  let rToken: TestIRToken
  let main: TestIMain
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
    ;({ stRSR, rsr, basket, facade, facadeTest, rToken, main } = await loadFixture(defaultFixture))

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

    beforeEach(async () => {
      await rToken.connect(owner).setIssuanceRate(fp('1'))

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

    it('Should return backingOverview correctly', async () => {
      let [backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully capitalized and no insurance
      expect(backing).to.be.closeTo(fp('1'), 10)
      expect(insurance).to.equal(0)

      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully capitalized and fully insured
      expect(backing).to.be.closeTo(fp('1'), 10)
      expect(insurance).to.be.closeTo(fp('0.5'), 10)

      // Stake more RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      expect(backing).to.be.closeTo(fp('1'), 10)
      expect(insurance).to.be.closeTo(fp('1'), 10)

      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount)

      // Check values = 0 (no supply)
      ;[backing, insurance] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - No supply, returns 0
      expect(backing).to.equal(0)
      expect(insurance).to.equal(0)
    })

    it('Should return basketBreakdown correctly for paused token', async () => {
      await main.connect(owner).pause()
      const [erc20s, breakdown, targets] = await facade.callStatic.basketBreakdown(rToken.address)
      expect(erc20s.length).to.equal(4)
      expect(breakdown.length).to.equal(4)
      expect(targets.length).to.equal(4)
      expect(erc20s[0]).to.equal(token.address)
      expect(erc20s[1]).to.equal(usdc.address)
      expect(erc20s[2]).to.equal(aToken.address)
      expect(erc20s[3]).to.equal(cToken.address)
      expect(breakdown[0]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[1]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[2]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[3]).to.be.closeTo(fp('0.25'), 10)
      expect(targets[0]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[1]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[2]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[3]).to.equal(ethers.utils.formatBytes32String('USD'))
    })

    it('Should return totalAssetValue correctly - FacadeTest', async () => {
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
    })

    it('Should return RToken price correctly', async () => {
      const avgPrice = fp('1')
      const [lowPrice, highPrice] = await facade.price(rToken.address)
      const delta = avgPrice.mul(ORACLE_ERROR).div(fp('1'))
      const expectedLow = avgPrice.sub(delta)
      const expectedHigh = avgPrice.add(delta)
      expect(lowPrice).to.equal(expectedLow)
      expect(highPrice).to.equal(expectedHigh)
    })

    // P1 only
    if (IMPLEMENTATION == Implementation.P1) {
      let stRSRP1: StRSRP1

      beforeEach(async () => {
        stRSRP1 = await ethers.getContractAt('StRSRP1', stRSR.address)
      })

      it('Should return pending issuances', async () => {
        const largeIssueAmount = initialBal.div(10)

        // Issue rTokens
        await rToken.connect(addr1).issue(largeIssueAmount)
        await rToken.connect(addr1).issue(largeIssueAmount.add(1))
        const pendings = await facade.pendingIssuances(rToken.address, addr1.address)

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

        const pendings = await facade.pendingUnstakings(rToken.address, addr1.address)
        expect(pendings.length).to.eql(2)
        expect(pendings[0][0]).to.eql(bn(0)) // index
        expect(pendings[0][2]).to.eql(unstakeAmount) // amount

        expect(pendings[1][0]).to.eql(bn(1)) // index
        expect(pendings[1][2]).to.eql(unstakeAmount.add(1)) // amount
      })
    }
  })
})

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { bn, fp } from '../../common/numbers'
import {
  CTokenMock,
  ERC20Mock,
  ExplorerFacadeP0,
  MainP0,
  StaticATokenMock,
  USDCMock,
} from '../../typechain'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('ExplorerFacadeP0 contract', () => {
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
  let basket: Collateral[]

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral

  // Facade
  let facade: ExplorerFacadeP0

  // Main
  let main: MainP0

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ basket, facade, main } = await loadFixture(defaultFixture))

    // Get assets and tokens
    ;[tokenAsset, usdcAsset, aTokenAsset, cTokenAsset] = basket

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())
  })

  describe('Deployment', () => {
    it('Deployment should setup Facade correctly', async () => {
      expect(await facade.main()).to.equal(main.address)
    })
  })

  describe('Views', () => {
    let issueAmount: BigNumber

    beforeEach(async () => {
      await main.connect(owner).setIssuanceRate(fp('1'))

      // Mint Tokens
      initialBal = bn('1000e18')
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
      await token.connect(addr1).approve(rTokenIssuer.address, initialBal)
      await usdc.connect(addr1).approve(rTokenIssuer.address, initialBal)
      await aToken.connect(addr1).approve(rTokenIssuer.address, initialBal)
      await cToken.connect(addr1).approve(rTokenIssuer.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)
    })

    it('Should return maxIssuable correctly', async () => {
      // Check values
      expect(await facade.maxIssuable(addr1.address)).to.equal(bn('3900e18'))
      expect(await facade.maxIssuable(addr2.address)).to.equal(bn('4000e18'))
      expect(await facade.maxIssuable(other.address)).to.equal(0)
    })

    it('Should return currentBacking correctly', async () => {
      const [tokens, quantities] = await facade.currentBacking()

      // Check token addresses
      expect(tokens[0]).to.equal(token.address)
      expect(tokens[1]).to.equal(usdc.address)
      expect(tokens[2]).to.equal(aToken.address)
      expect(tokens[3]).to.equal(cToken.address)

      // Check quantities
      expect(quantities).to.eql([bn('25e18'), bn('25e6'), bn('25e18'), bn('25e8')])
    })
  })
})

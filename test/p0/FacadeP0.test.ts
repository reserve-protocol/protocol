import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Wallet, BigNumber } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { bn, fp } from '../../common/numbers'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { ExplorerFacadeP0 } from '../../typechain/ExplorerFacadeP0'
import { MainP0 } from '../../typechain/MainP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { USDCMock } from '../../typechain/USDCMock'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('ExplorerFacadeP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  //  Collateral
  let collateral: Collateral[]

  // Tokens
  let initialBal: BigNumber
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let rToken: RTokenP0
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let aaveToken: ERC20Mock

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

    let basket: Collateral[]

      // Deploy fixture
    ;({ rsr, compToken, aaveToken, collateral, rToken, basket, facade, main } = await loadFixture(
      defaultFixture
    ))

    // Get assets and tokens
    tokenAsset = basket[0]
    usdcAsset = basket[1]
    aTokenAsset = basket[2]
    cTokenAsset = basket[3]
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
    beforeEach(async () => {
      // Mint Tokens
      initialBal = bn('1e33')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cToken.connect(owner).mint(addr1.address, initialBal)

      await token.connect(owner).mint(addr2.address, initialBal)
      await usdc.connect(owner).mint(addr2.address, initialBal)
      await aToken.connect(owner).mint(addr2.address, initialBal)
      await cToken.connect(owner).mint(addr2.address, initialBal)

      // Issue some RTokens
      const issueAmount: BigNumber = bn('1e33')

      // Provide approvals
      await token.connect(addr1).approve(main.address, initialBal)
      await usdc.connect(addr1).approve(main.address, initialBal)
      await aToken.connect(addr1).approve(main.address, initialBal)
      await cToken.connect(addr1).approve(main.address, initialBal)

      // Issue rTokens
      await main.connect(addr1).issue(issueAmount)

      // Process issuance
      await main.poke()
    })

    it('Should return maxIssuable correctly', async () => {
      // Check values
      expect(await facade.maxIssuable(addr1.address)).to.equal(bn('3e33'))
      expect(await facade.maxIssuable(addr2.address)).to.equal(bn('4e33'))
      expect(await facade.maxIssuable(other.address)).to.equal(0)
    })

    it('Should return currentBacking correctly', async () => {
      const [tokens, quantities] = await facade.currentBacking()

      // Get backing ERC20s from collateral
      const backingERC20Addrs: string[] = await Promise.all(
        collateral.map(async (c): Promise<string> => {
          return await c.erc20()
        })
      )

      // Check token addresses
      expect(tokens[0]).to.equal(token.address)
      expect(tokens[1]).to.equal(usdc.address)
      expect(tokens[2]).to.equal(aToken.address)
      expect(tokens[3]).to.equal(cToken.address)

      // Check quantities
      // TODO
    })
  })
})

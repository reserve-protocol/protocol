import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { bn } from '../../common/numbers'
import { CTokenMock } from '../../typechain/CTokenMock'
import { ERC20Mock } from '../../typechain/ERC20Mock'
import { MainP0 } from '../../typechain/MainP0'
import { RTokenP0 } from '../../typechain/RTokenP0'
import { StaticATokenMock } from '../../typechain/StaticATokenMock'
import { Collateral, defaultFixture } from './utils/fixtures'

const createFixtureLoader = waffle.createFixtureLoader

describe('RTokenP0 contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let mainMock: SignerWithAddress
  let other: SignerWithAddress

  // Main
  let main: MainP0

  // Tokens/Assets
  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: StaticATokenMock
  let token3: CTokenMock

  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: Collateral
  let collateral3: Collateral

  // RToken
  let rToken: RTokenP0

  // Basket
  let basket: Collateral[]

  // Quantities
  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, mainMock, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ basket, main, rToken } = await loadFixture(defaultFixture))

    // Mint initial amounts of RSR
    initialBal = bn('100e18')

    // Get assets and tokens
    collateral0 = basket[0]
    collateral1 = basket[1]
    collateral2 = basket[2]
    collateral3 = basket[3]
    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())
  })

  describe('Deployment', () => {
    it('Deployment should RToken correctly', async () => {
      expect(await rToken.name()).to.equal('RTKN RToken')
      expect(await rToken.symbol()).to.equal('RTKN')
      expect(await rToken.decimals()).to.equal(18)
      expect(await rToken.totalSupply()).to.equal(bn(0))
      expect(await rToken.main()).to.equal(main.address)
    })
  })

  describe('Configuration', () => {
    it('Should allow to set Main if Owner', async () => {
      // Check initial status
      expect(await rToken.main()).to.equal(main.address)

      // Try to update with another user
      await expect(rToken.connect(addr1).setMain(other.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // Check nothing changed
      expect(await rToken.main()).to.equal(main.address)

      // Update with owner
      await rToken.connect(owner).setMain(other.address)

      expect(await rToken.main()).to.equal(other.address)
    })
  })

  describe('Redeem/Melt/Mint', () => {
    const issueAmount: BigNumber = bn('100e18')

    beforeEach(async () => {
      // Issue some RTokens
      await token0.connect(owner).mint(addr1.address, initialBal)
      await token1.connect(owner).mint(addr1.address, initialBal)
      await token2.connect(owner).mint(addr1.address, initialBal)
      await token3.connect(owner).mint(addr1.address, initialBal)

      // Approvals
      await token0.connect(addr1).approve(main.address, initialBal)
      await token1.connect(addr1).approve(main.address, initialBal)
      await token2.connect(addr1).approve(main.address, initialBal)
      await token3.connect(addr1).approve(main.address, initialBal)

      // Issue tokens
      await main.connect(addr1).issue(issueAmount)

      // Process issuance
      await main.poke()
    })

    it('Should allow to melt tokens if caller or Main', async () => {
      // Melt tokens
      const meltAmount: BigNumber = bn('10e18')

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      await rToken.connect(addr1).melt(meltAmount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(meltAmount))
      expect(await rToken.totalSupply()).to.equal(issueAmount.sub(meltAmount))

      // Update Main to mock call - from mainMock
      await rToken.connect(owner).setMain(mainMock.address)

      // Melt another set of tokens
      await rToken.connect(addr1).melt(meltAmount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.sub(meltAmount.mul(2)))
      expect(await rToken.totalSupply()).to.equal(issueAmount.sub(meltAmount.mul(2)))
    })

    it('Should allow to mint tokens when called by Main', async () => {
      // Mint tokens
      const mintAmount: BigNumber = bn('10e18')

      // Update Main to mock call - from mainMock
      await rToken.connect(owner).setMain(mainMock.address)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)
      expect(await rToken.totalSupply()).to.equal(issueAmount)

      await rToken.connect(mainMock).mint(addr1.address, mintAmount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount.add(mintAmount))
      expect(await rToken.totalSupply()).to.equal(issueAmount.add(mintAmount))

      // Trying to mint with another account will fail
      await expect(rToken.connect(other).mint(addr1.address, mintAmount)).to.be.revertedWith(
        'only main'
      )
    })
  })
})

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber, Contract } from "ethers"
import { ethers } from "hardhat"

const MINT_AMOUNT = BigNumber.from(5000)

describe("Token library", function () {
    let caller: Contract
    let token: Contract
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress
    let other: SignerWithAddress

    beforeEach(async function () {
        ;[owner, addr1, addr2, other] = await ethers.getSigners()

        const ERC20 = await ethers.getContractFactory("ERC20Mock")
        token = await ERC20.deploy("Token", "TKN")

        // Set token info
        const innerTokenInfo = {
            tokenAddress: token.address,
            genesisQuantity: 0,
            rateLimit: 1,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0,
        }

        // ERC20 Token
        const TokenCaller = await ethers.getContractFactory("TokenCallerMock")
        caller = await TokenCaller.deploy(innerTokenInfo)

        // Mint some tokens to the caller contract
        await token.mint(caller.address, MINT_AMOUNT)
    })

    describe("Balance", function () {
        it("Should return balances correctly", async function () {
            expect(await caller["getBalance(address)"](addr1.address)).to.equal(0)
            expect(await caller["getBalance(address)"](addr2.address)).to.equal(0)
            expect(await caller["getBalance(address)"](caller.address)).to.equal(MINT_AMOUNT)
            expect(await caller["myBalance()"]()).to.equal(MINT_AMOUNT)
        })
    })

    describe("Transfers", function () {
        it("Should transfer tokens correctly", async function () {
            // Transfer
            await caller.safeTransfer(addr1.address, MINT_AMOUNT)
            expect(await caller["getBalance(address)"](addr1.address)).to.equal(MINT_AMOUNT)
            expect(await caller["getBalance(address)"](caller.address)).to.equal(0)

            // Check underlying token contract
            expect(await token.balanceOf(addr1.address)).to.equal(MINT_AMOUNT)
            expect(await token.balanceOf(caller.address)).to.equal(0)
        })

        it("Should approve tokens correctly", async function () {
            // Approval
            await caller.safeApprove(other.address, MINT_AMOUNT)

            // Other address can do transfer
            await token.connect(other).transferFrom(caller.address, addr1.address, MINT_AMOUNT)

            expect(await caller["getBalance(address)"](addr1.address)).to.equal(MINT_AMOUNT)
            expect(await caller["getBalance(address)"](caller.address)).to.equal(0)

            // Check underlying token contract
            expect(await token.balanceOf(addr1.address)).to.equal(MINT_AMOUNT)
            expect(await token.balanceOf(caller.address)).to.equal(0)
        })

        it("Should transferFrom tokens correctly", async function () {
            const amount2 = BigNumber.from(2000)
            await token.mint(addr1.address, amount2)

            // Approval for caller contract
            await token.connect(addr1).approve(caller.address, amount2)

            // Transfer
            await caller.safeTransferFrom(addr1.address, addr2.address, amount2)
            expect(await caller["getBalance(address)"](addr1.address)).to.equal(0)
            expect(await caller["getBalance(address)"](addr2.address)).to.equal(amount2)
            expect(await caller["getBalance(address)"](caller.address)).to.equal(MINT_AMOUNT)

            // Check underlying token contract
            expect(await token.balanceOf(addr1.address)).to.equal(0)
            expect(await token.balanceOf(addr2.address)).to.equal(amount2)
            expect(await token.balanceOf(caller.address)).to.equal(MINT_AMOUNT)
        })
    })
})

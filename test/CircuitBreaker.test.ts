import { expect } from "chai"
import { ethers } from "hardhat"
import { CircuitBreaker } from "../typechain/CircuitBreaker.d"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

const PAUSER_ROLE = ethers.utils.solidityKeccak256(["string"], ["PAUSER_ROLE"])

describe("CircuitBreaker contract", () => {
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let cb: CircuitBreaker

    beforeEach(async () => {
        const CircuitBreaker = await ethers.getContractFactory("CircuitBreaker")
        ;[owner, addr1] = await ethers.getSigners()
        cb = <CircuitBreaker>await CircuitBreaker.deploy(owner.address)
    })

    describe("Deployment", () => {
        it("Should create contract with Status and Pauser", async () => {
            expect(await cb.paused()).to.equal(false)
            expect(await cb.hasRole(PAUSER_ROLE, owner.address)).to.equal(true)
        })
    })

    describe("Pause/Unpause", () => {
        it("Should Pause/Unpause for Pauser role", async () => {
            // Pause
            await expect(cb.connect(owner).pause()).to.emit(cb, "Paused").withArgs(owner.address)

            expect(await cb.paused()).to.equal(true)

            // Unpause
            await expect(cb.connect(owner).unpause())
                .to.emit(cb, "Unpaused")
                .withArgs(owner.address)

            expect(await cb.paused()).to.equal(false)
        })

        it("Should not allow to Pause/Unpause if not Pauser", async () => {
            await expect(cb.connect(addr1).pause()).to.be.revertedWith("CircuitPaused")

            await expect(cb.connect(addr1).unpause()).to.be.revertedWith("CircuitPaused")
        })
    })
})

import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { RelayERC20Mock } from "../typechain/RelayERC20Mock.d"

describe("RelayERC20 contract", function () {
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress
    let token: RelayERC20Mock

    beforeEach(async function () {
        const RelayERC20 = await ethers.getContractFactory("RelayERC20Mock")
        ;[owner, addr1, addr2] = await ethers.getSigners()

        // Deploy and mint initial tokens
        token = <RelayERC20Mock>await RelayERC20.deploy()
        await token.initialize("RelayToken", "RTKN")
        await token.mint(owner.address, BigNumber.from(1000))
    })

    describe("Deployment", function () {
        it("Should assign the total supply of tokens to the owner", async function () {
            const ownerBalance = await token.balanceOf(owner.address)
            expect(await token.totalSupply()).to.equal(ownerBalance)
        })
    })

    describe("Transactions", function () {
        it("Should transfer tokens between accounts", async function () {
            // Transfer 50 tokens from owner to addr1
            const amount = BigNumber.from(50)
            await token.transfer(addr1.address, amount)
            const addr1Balance = await token.balanceOf(addr1.address)
            expect(addr1Balance).to.equal(amount)

            // Transfer 50 tokens from addr1 to addr2
            await token.connect(addr1).transfer(addr2.address, amount)
            const addr2Balance = await token.balanceOf(addr2.address)
            expect(addr2Balance).to.equal(amount)
        })

        it("Should fail if sender doesn’t have enough tokens", async function () {
            const amount = BigNumber.from(10)
            const initialOwnerBalance = await token.balanceOf(owner.address)

            // Try to send 1 token from addr1 (0 tokens) to owner (1000 tokens).
            await expect(token.connect(addr1).transfer(owner.address, amount)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance"
            )

            // Owner balance shouldn't have changed.
            expect(await token.balanceOf(owner.address)).to.equal(initialOwnerBalance)
        })

        it("Should update balances after transfers", async function () {
            const amount1 = BigNumber.from(100)
            const amount2 = BigNumber.from(50)

            const initialOwnerBalance = await token.balanceOf(owner.address)

            // Transfer 100 tokens from owner to addr1.
            await token.transfer(addr1.address, amount1)

            // Transfer another 50 tokens from owner to addr2.
            await token.transfer(addr2.address, amount2)

            // Check balances.
            const finalOwnerBalance = await token.balanceOf(owner.address)
            expect(finalOwnerBalance).to.equal(initialOwnerBalance.sub(amount1.add(amount2)))

            const addr1Balance = await token.balanceOf(addr1.address)
            expect(addr1Balance).to.equal(amount1)

            const addr2Balance = await token.balanceOf(addr2.address)
            expect(addr2Balance).to.equal(amount2)
        })
    })

    describe("Relay Transfers", function () {
        it("Should perform relay transfer between accounts", async function () {
            // Transfer 50 tokens from owner to addr1, relayed by another account
            const amount = BigNumber.from(50)
            const nonce = await token.metaNonces(owner.address)

            const hash = ethers.utils.solidityKeccak256(
                ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
                ["relayedTransfer", token.address, owner.address, addr1.address, amount, 0, nonce]
            )
            const sigHashBytes = ethers.utils.arrayify(hash)
            const sig = await owner.signMessage(sigHashBytes)

            await expect(
                token.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, amount, 0)
            )
                .to.emit(token, "TransferForwarded")
                .withArgs(sig, owner.address, addr1.address, amount, 0)

            const addr1Balance = await token.balanceOf(addr1.address)
            expect(addr1Balance).to.equal(amount)
        })

        it("Should perform relay transfer of fee", async function () {
            // Transfer 50 tokens from owner to addr1 (with 20 tokens fee), relayed by another account.
            const amount = BigNumber.from(50)
            const fee = BigNumber.from(20)
            const nonce = await token.metaNonces(owner.address)

            const hash = ethers.utils.solidityKeccak256(
                ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
                ["relayedTransfer", token.address, owner.address, addr1.address, amount, fee, nonce]
            )
            const sigHashBytes = ethers.utils.arrayify(hash)
            const sig = await owner.signMessage(sigHashBytes)

            // No balance in contract yet
            let feeBalance = await token.balanceOf(token.address)
            expect(feeBalance).to.equal(0)

            await expect(
                token.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, amount, fee)
            )
                .to.emit(token, "TransferForwarded")
                .withArgs(sig, owner.address, addr1.address, amount, fee)

            // Check balance in contract
            feeBalance = await token.balanceOf(token.address)
            expect(feeBalance).to.equal(fee)
        })

        it("Should update nonce correctly and only accept valid nonce", async function () {
            // Transfer 50 tokens from owner to addr1, relayed by another account
            const amount1 = BigNumber.from(50)
            const amount2 = BigNumber.from(20)
            let nonce = await token.metaNonces(owner.address)

            const hash = ethers.utils.solidityKeccak256(
                ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
                ["relayedTransfer", token.address, owner.address, addr1.address, amount1, 0, nonce]
            )

            const sigHashBytes = ethers.utils.arrayify(hash)
            const sig = await owner.signMessage(sigHashBytes)

            await token
                .connect(addr2)
                .relayedTransfer(sig, owner.address, addr1.address, amount1, 0)
            let addr1Balance = await token.balanceOf(addr1.address)
            expect(addr1Balance).to.equal(amount1)

            nonce = await token.metaNonces(owner.address)

            const hash2 = ethers.utils.solidityKeccak256(
                ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
                ["relayedTransfer", token.address, owner.address, addr1.address, amount2, 0, nonce]
            )

            const sigHashBytes2 = ethers.utils.arrayify(hash2)
            const sig2 = await owner.signMessage(sigHashBytes2)

            await expect(
                token.connect(addr2).relayedTransfer(sig2, owner.address, addr1.address, amount2, 0)
            )
                .to.emit(token, "TransferForwarded")
                .withArgs(sig2, owner.address, addr1.address, amount2, 0)

            addr1Balance = await token.balanceOf(addr1.address)
            expect(addr1Balance).to.equal(amount1.add(amount2))
        })

        it("Should not relay if invalid signature", async function () {
            // Transfer 50 tokens from owner to addr1, relayed by another account
            const amount = BigNumber.from(50)
            const nonce = await token.metaNonces(owner.address)

            const hash = ethers.utils.solidityKeccak256(
                ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
                ["relayedTransfer", token.address, owner.address, addr1.address, amount, 0, nonce]
            )

            const sigHashBytes = ethers.utils.arrayify(hash)
            const sig = await addr2.signMessage(sigHashBytes)

            await expect(
                token.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, amount, 0)
            ).to.be.revertedWith("RelayERC20: Invalid signature")

            const addr1Balance = await token.balanceOf(addr1.address)
            expect(addr1Balance).to.equal(0)
        })
    })
})

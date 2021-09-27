import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../common/numbers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AbstractERC20, Simulation, Token } from "./interface"
import { Implementation0 } from "./implementations/0"
import { EVMImplementation } from "./implementations/evm"

describe("Simulations", function () {
    let sim1: Simulation
    let sim2: Simulation
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let tokens: Token[]

    // Compares a function run on two implementations
    async function both(func: Function, ...args: any[]): Promise<void> {
        expect(await func(sim1, ...args)).to.equal(await func(sim2, ...args))
    }

    beforeEach(async function () {
        tokens = [
            { name: "DAI", symbol: "DAI", quantityE18: bn(333334).mul(pow10(12)) },
            { name: "TUSD", symbol: "TUSD", quantityE18: bn(333333).mul(pow10(12)) },
            { name: "USDC", symbol: "USDC", quantityE18: bn(333333) }, // 6 decimals
        ]
        ;[owner, addr1] = await ethers.getSigners()
        sim1 = new Implementation0(owner.address, "RToken", "RSV", tokens)
        sim2 = new Implementation0(owner.address, "RToken", "RSV", tokens)
        // TODO: Swap in EVM implementation for sim2
        // sim2 = await new EVMImplementation().create(owner, "RToken", "RSV", tokens)
    })

    describe("RToken", function () {
        let amount: BigNumber

        beforeEach(async function () {
            amount = pow10(21)

            await both(async function (sim: Simulation) {
                await sim.rToken.basketERC20(tokens[0]).connect(owner.address).mint(owner.address, amount)
                await sim.rToken.basketERC20(tokens[1]).connect(owner.address).mint(owner.address, amount)
                await sim.rToken.basketERC20(tokens[2]).connect(owner.address).mint(owner.address, amount)
                await sim.rToken.connect(owner.address).issue(amount)
                return amount
            })
        })

        it("Should allow issuance", async function () {
            await both(async function (sim: Simulation) {
                expect(await sim.rToken.balanceOf(owner.address)).to.equal(amount)
                return amount
            })
        })

        it("Should allow redemption", async function () {
            await both(async function (sim: Simulation) {
                await sim.rToken.connect(owner.address).redeem(amount)
                expect(await sim.rToken.balanceOf(owner.address)).to.equal(ZERO)
                return ZERO
            })
        })

        it("Should allow transfer", async function () {
            await both(async function (sim: Simulation) {
                expect(await sim.rToken.balanceOf(owner.address)).to.equal(amount)
                await sim.rToken.connect(owner.address).transfer(addr1.address, amount)
                expect(await sim.rToken.balanceOf(owner.address)).to.equal(ZERO)
                expect(await sim.rToken.balanceOf(addr1.address)).to.equal(amount)
                return amount
            })
        })
    })
})

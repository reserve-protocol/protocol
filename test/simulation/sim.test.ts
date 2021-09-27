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
    function both(func: Function, ...args: any[]): void {
        expect(func(sim1, ...args)).to.equal(func(sim2, ...args))
    }

    beforeEach(async function () {
        tokens = [
            { name: "DAI", symbol: "DAI", quantityE18: bn(333334).mul(pow10(12)) },
            { name: "TUSD", symbol: "TUSD", quantityE18: bn(333333).mul(pow10(12)) },
            { name: "USDC", symbol: "USDC", quantityE18: bn(333333) }, // 6 decimals
        ]
        ;[owner, addr1] = await ethers.getSigners()
        sim1 = new Implementation0("RToken", "RSV", tokens)
        sim2 = new Implementation0("RToken", "RSV", tokens)
        // TODO: Swap in EVM implementation for sim2
        // sim2 = await new EVMImplementation().create(owner, "RToken", "RSV", tokens)
    })

    describe("RToken", function () {
        let amount: BigNumber

        beforeEach(async function () {
            amount = pow10(21)

            both(function (sim: Simulation) {
                sim.basketERC20(tokens[0]).mint(owner.address, amount)
                sim.basketERC20(tokens[1]).mint(owner.address, amount)
                sim.basketERC20(tokens[2]).mint(owner.address, amount)
                sim.issue(owner.address, amount)
                return amount
            })
        })

        it("Should allow issuance", async function () {
            both(function (sim: Simulation) {
                expect(sim.rToken.balanceOf(owner.address)).to.equal(amount)
                return amount
            })
        })

        it("Should allow redemption", async function () {
            both(function (sim: Simulation) {
                sim.redeem(owner.address, amount)
                expect(sim.rToken.balanceOf(owner.address)).to.equal(ZERO)
                return ZERO
            })
        })

        it("Should allow transfer", async function () {
            both(function (sim: Simulation) {
                expect(sim.rToken.balanceOf(owner.address)).to.equal(amount)
                sim.rToken.transfer(owner.address, addr1.address, amount)
                expect(sim.rToken.balanceOf(owner.address)).to.equal(ZERO)
                expect(sim.rToken.balanceOf(addr1.address)).to.equal(amount)
                return amount
            })
        })
    })
})

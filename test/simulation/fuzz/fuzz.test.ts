import fc from "fast-check"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../../common/numbers"
import { Account, Command, Contract, Simulation, State, Token, User } from "../interface"
import { Implementation0 } from "../implementations/0"
import { EVMImplementation } from "../implementations/evm"
import { bnUint256 } from "./rules"
import { match } from "../sim.test"

const initialState: State = {
    rToken: {
        basket: [
            { name: "DAI", symbol: "DAI", quantityE18: bn(333334).mul(pow10(12)) },
            { name: "TUSD", symbol: "TUSD", quantityE18: bn(333333).mul(pow10(12)) },
            { name: "USDC", symbol: "USDC", quantityE18: bn(333333) }, // 6 decimals
        ],
        balances: new Map<Account, BigNumber>(),
    },
}

describe("RToken Fuzzing", () => {
    let snapshotId: Number
    let model: Simulation
    let real: Simulation

    beforeEach(async function () {
        model = new Implementation0()
        real = new EVMImplementation()
        await model.seed(User.Alice, initialState)
        await real.seed(User.Alice, initialState)
    })

    it("Should run commands correctly", async function () {
        const exceptZero = bnUint256().filter((x) => x.toString() !== "0")
        await fc.assert(
            fc
                .asyncProperty(exceptZero, async (amount: BigNumber) => {
                    const user = User.Alice
                    console.log("amount", amount)
                    const cmd: Command = { rToken: { issue: [amount] } }
                    expect(await model.execute(user, cmd)).to.equal(await real.execute(user, cmd))
                    expect(match(await model.state(), await real.state())).to.equal(true)

                    // await fc.asyncModelRun(() => ({ model, real }), commands)
                })
                .beforeEach(async () => {
                    snapshotId = await ethers.provider.send("evm_snapshot", [])
                })
                .afterEach(async () => {
                    model = new Implementation0()
                    await model.seed(User.Alice, initialState)
                    // Force rollback to reset
                    await ethers.provider.send("evm_revert", [snapshotId])
                })
        )
    })
})

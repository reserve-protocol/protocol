import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../common/numbers"
import { Account, Command, Simulation, State, Token } from "./interface"
import { Implementation0 } from "./implementations/0"
import { EVMImplementation } from "./implementations/evm"

/*
 * Simulation Test Harness
 *
 * How this works:
 * - Tests are written against the simulation interface definitions in `interface.ts`.
 * - Accounts should be represented and referred to using the `Account` enum.
 * - Use `seedBoth` followed by `executeBoth` to prep a state, mutate it, and check the results.
 */

function match(obj: any, other: any): boolean {
    function replacer(key: any, value: any) {
      if(value instanceof Map) {
        return {
          dataType: 'Map',
          value: Array.from(value.entries()), // or with spread: value: [...value]
        };
      } else {
        return value;
      }
    }

    const match = JSON.stringify(obj, replacer) === JSON.stringify(other, replacer)
    if (!match) {
        console.log(JSON.stringify(obj, replacer))
        console.log(JSON.stringify(other, replacer))
    }

    return JSON.stringify(obj, replacer) === JSON.stringify(other, replacer)
}

describe("Simulation", function () {
    let sim1: Simulation
    let sim2: Simulation
    let tokens: Token[]

    // Configures both simulations to start off in the same state.
    async function seedBoth(state: State): Promise<void> {
        await sim1.seed(state)
        await sim2.seed(state)
    }

    // Runs the same commands on two implementations of our protocol and asserts the states match.
    async function executeBoth(...commands: Command[]): Promise<void> {
        for (let i = 0; i < commands.length; i++) {
            expect(await sim1.execute(commands[i])).to.equal(await sim2.execute(commands[i]))
            expect(match(await sim1.state(), await sim2.state())).to.equal(true)
        }
    }

    describe("RToken", function () {
        let amount: BigNumber

        beforeEach(async function () {
            amount = pow10(21)
            const state: State = {
                owner: Account.Alice,
                rToken: {
                    basket: [
                        { name: "DAI", symbol: "DAI", quantityE18: bn(333334).mul(pow10(12)) },
                        { name: "TUSD", symbol: "TUSD", quantityE18: bn(333333).mul(pow10(12)) },
                        { name: "USDC", symbol: "USDC", quantityE18: bn(333333) }, // 6 decimals
                    ],
                    balances: new Map<Account, BigNumber>(),
                },
            }
            sim1 = new Implementation0()
            sim2 = new Implementation0()
            // sim2 = new EVMImplementation()
            await seedBoth(state)
        })

        it("Should allow issuance", async function () {
            await executeBoth({ rToken: { issue: [Account.Alice, amount] } })
        })

        it("Should allow redemption", async function () {
            await executeBoth(
                { rToken: { issue: [Account.Alice, amount] } },
                { rToken: { redeem: [Account.Alice, amount] } }
            )
        })

        it("Should allow transfer", async function () {
            await executeBoth(
                { rToken: { issue: [Account.Alice, amount] } },
                { rToken: { transfer: [Account.Alice, Account.Bob, amount] } }
            )
        })
    })
})

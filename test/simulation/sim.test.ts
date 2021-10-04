import { ethers } from 'hardhat'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { bn, pow10 } from '../../common/numbers'
import { Account, Contract, Simulation, State, Token, User, TX } from './interface'
import { Implementation0 } from './implementations/0'
import { EVMImplementation } from './implementations/evm'
import * as fc from 'fast-check'
import * as Arbitrary from './fuzzing/arbitrary'

/*
 * Simulation Test Harness
 *
 * How this works:
 * - Tests are written against the simulation interface definitions in `interface.ts`.
 * - Accounts should be represented and referred to using the `Account` enum.
 * - Use `seed` followed by `executeParallel` to prep a state, mutate it, and check the results.
 */

describe('Simulation', function () {
  let sim1: Simulation
  let sim2: Simulation
  let tokens: Token[]

  // Configures both simulations to start off in the same state.
  async function seed(user: User, state: State): Promise<void> {
    await sim1.seed(user, state)
    await sim2.seed(user, state)
  }

  // Runs the same commands on two implementations of our protocol and asserts the states match.
  async function executeParallel(...txs: TX[]): Promise<void> {
    for (let i = 0; i < txs.length; i++) {
      expect(await sim1.execute(...txs[i])).to.equal(await sim2.execute(...txs[i]))
      expect(match(await sim1.state(), await sim2.state())).to.equal(true)
    }
  }

  describe('RToken', function () {
    let amount: BigNumber
    let initialState: State

    beforeEach(async function () {
      amount = pow10(21)
      initialState = {
        rToken: {
          basket: [
            { name: 'DAI', symbol: 'DAI', quantityE18: bn(333334).mul(pow10(12)) },
            { name: 'TUSD', symbol: 'TUSD', quantityE18: bn(333333).mul(pow10(12)) },
            { name: 'USDC', symbol: 'USDC', quantityE18: bn(333333) }, // 6 decimals
          ],
          balances: new Map<Account, BigNumber>(),
        },
      }
      sim1 = new Implementation0()
      // sim2 = new Implementation0()
      sim2 = new EVMImplementation()
      //await seed(User.Alice, state)
    })

    it('Should set state correctly', async function () {
      await seed(User.Alice, initialState)
      expect(match(await sim1.state(), await sim2.state())).to.equal(true)
    })

    it('Should allow issuance', async function () {
      await seed(User.Alice, initialState)
      await executeParallel([User.Alice, { rToken: { issue: [amount] } }])
    })

    it('Should allow redemption', async function () {
      await seed(User.Alice, initialState)
      await executeParallel(
        [User.Alice, { rToken: { issue: [amount] } }],
        [User.Alice, { rToken: { redeem: [amount] } }]
      )
    })

    it('Should allow transfer to another user', async function () {
      await seed(User.Alice, initialState)
      await executeParallel(
        [User.Alice, { rToken: { issue: [amount] } }],
        [User.Alice, { rToken: { transfer: [User.Bob, amount] } }]
      )
    })

    it('Should allow transfer to another smart contract', async function () {
      await seed(User.Alice, initialState)
      await executeParallel(
        [User.Alice, { rToken: { issue: [amount] } }],
        [User.Alice, { rToken: { transfer: [Contract.RSR, amount] } }]
      )
    })

    // it("Should revert on transfer to RToken", async function () {
    //     await executeParallel(
    //         [User.Alice, { rToken: { issue: [amount] } }],
    //         [User.Alice, { rToken: { transfer: [Contract.RSR, amount] } }]
    //     )
    // })

    it.skip('Should allow issuance with fuzzing of state and amount', async function () {
      let snapshotId: number

      await fc.assert(
        fc
          .asyncProperty(
            Arbitrary.State(),
            Arbitrary.User(),
            Arbitrary.simpleAmount,
            async (state: State, user: User, amount: BigNumber) => {
              // Seed state
              await seed(user, state)
              expect(match(await sim1.state(), await sim2.state())).to.equal(true)

              // Execute issuance
              await executeParallel([user, { rToken: { issue: [amount] } }])
            }
          )
          .beforeEach(async () => {
            snapshotId = await ethers.provider.send('evm_snapshot', [])
          })
          .afterEach(async () => {
            // Force rollback to reset
            sim1 = new Implementation0()
            await ethers.provider.send('evm_revert', [snapshotId])
          })
      )
    })

    it.skip('Fuzzing state and commands', async function () {
      let snapshotId: number

      await fc.assert(
        fc
          .asyncProperty(
            Arbitrary.State(),
            Arbitrary.User(),
            Arbitrary.Commands(),
            async (state: State, user: User, commands: TX[]) => {
              // Seed state
              await seed(user, state)
              expect(match(await sim1.state(), await sim2.state())).to.equal(true)

              // Execute commands
              await executeParallel(...commands)
            }
          )
          .beforeEach(async () => {
            snapshotId = await ethers.provider.send('evm_snapshot', [])
          })
          .afterEach(async () => {
            // Force rollback to reset
            sim1 = new Implementation0()
            await ethers.provider.send('evm_revert', [snapshotId])
          })
      )
    })
  })
})

function match(obj: any, other: any): boolean {
  function replacer(key: any, value: any) {
    if (value instanceof Map) {
      const entries = [...value]
      for (let i = 0; i < entries.length; i++) {
        // Cast BigNumbers to human readable
        entries[i][1] = entries[i][1].toString()
      }
      return {
        dataType: 'Map',
        value: entries,
      }
    } else if (['quantityE18'].includes(key)) {
      return BigNumber.from(value).toString()
    } else {
      return value
    }
  }

  const match = JSON.stringify(obj, replacer) === JSON.stringify(other, replacer)
  console.log(JSON.stringify(obj, replacer))
  if (!match) {
    console.log(JSON.stringify(other, replacer))
  }

  return match
}

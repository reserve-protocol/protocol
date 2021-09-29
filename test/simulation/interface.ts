import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

// Types for testing suite

export enum Account {
    Alice = "Alice",
    Bob = "Bob",
    Charlie = "Charlie",
    Dave = "Dave",
    Eve = "Eve",

    // Components also hold balances, maybe we can delete this later
    RToken = "RToken",
}

export type Token = {
    name: string
    symbol: string
    quantityE18: BigNumber
}

// ================================================

// Canonical state
// used to setup a system for testing.

export type State = {
    owner: Account
    rToken: {
        basket: Token[]
        balances: Map<Account, BigNumber>
    }
}

// ================================================

// Plain-old data definition of the outermost system interface

// For now all commands should be nested 1 layer deep.
export type Command = {
    rToken?: {
        issue?: [Account, BigNumber]
        redeem?: [Account, BigNumber]
        transfer?: [Account, Account, BigNumber]
    }
}

// ================================================

// Top-level simulation interface
export interface Simulation {
    seed(state: State): Promise<void>
    execute(command: Command, as?: Account): Promise<void>
    state(): Promise<State>
}

import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

// Top-level simulation interface
export interface Simulation {
    seed(state: State): Promise<void>
    execute(command: Command): Promise<void>
    state(): Promise<State>
}

// =================================================================
// Simulation types

export type Token = {
    name: string
    symbol: string
    quantityE18: BigNumber
}

// Used to setup a system for testing.
export type State = {
    owner: User
    rToken: {
        basket: Token[]
        balances: Map<Account, BigNumber>
    }
}

// INVARIANT: A command should only ever contain AT MOST 1 leaf target.
// e.g. {rToken: { issue: [..], redeem: [..] }} is invalid
export type Command = {
    // For now all commands should be nested 1 layer deep.
    rToken?: {
        issue?: [User, BigNumber]
        redeem?: [User, BigNumber]
        transfer?: [Account, Account, BigNumber]
    }
}

// =================================================================
// Account types

export enum User {
    Alice = "Alice",
    Bob = "Bob",
    Charlie = "Charlie",
    Dave = "Dave",
    Eve = "Eve",
}

export enum Contract {
    RToken = "RToken",
    RSR = "RSR",
    IPool = "IPool",
}

// Ethereum Account
export type Account = User | Contract

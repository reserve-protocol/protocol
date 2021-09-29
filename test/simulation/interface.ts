import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

// Top-level simulation interface
export interface Simulation {
    seed(deployer: User, state: State): Promise<void>
    execute(user: User, command: Command): Promise<void>
    state(): Promise<State>
}

// =================================================================
// Simulation types

export type Token = {
    name: string
    symbol: string
    quantityE18: BigNumber
}

export type RTokenState = {
    basket: Token[]
    balances: Map<Account, BigNumber>
}

// Used to setup a system for testing.
export type State = {
    rToken: RTokenState
}

// INVARIANT: A command should only ever contain AT MOST 1 of the optional leaf targets.
// e.g. { user: User.Alice, rToken: { issue: [..], redeem: [..] }} is an invalid command.
export type Command = {
    rToken?: {
        issue?: [BigNumber]
        redeem?: [BigNumber]
        transfer?: [Account, BigNumber]
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

export const Users = [User.Alice, User.Bob, User.Charlie, User.Dave, User.Eve]

export enum Contract {
    RToken = "RToken",
    RSR = "RSR",
    IPool = "IPool",
}

// Ethereum Account
export type Account = User | Contract

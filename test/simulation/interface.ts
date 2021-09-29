import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

// Top-level simulation interface
export interface Simulation {
    seed(state: State): Promise<void>
    execute(command: Command): Promise<void>
    state(): Promise<State>
}

// Types

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

// Used to setup a system for testing.
export type State = {
    owner: Account
    rToken: {
        basket: Token[]
        balances: Map<Account, BigNumber>
    }
}

// INVARIANT: A command should only ever contain AT MOST 1 leaf target.
// e.g.     {rToken: { issue: [..], redeem: [..] }} is invalid
export type Command = {
    // For now all commands should be nested 1 layer deep.
    rToken?: {
        issue?: [Account, BigNumber]
        redeem?: [Account, BigNumber]
        transfer?: [Account, Account, BigNumber]
    }
}

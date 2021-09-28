import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

export enum Account {
    Alice = 0,
    Bob,
    Charlie,
    Dave,
    Eve,
    // Components can also hold balances
    RToken,
}

export type Token = {
    name: string
    symbol: string
    quantityE18: BigNumber
}

// ================================================

// Top-level interface object
export interface Simulation {
    rToken: AbstractRToken
    // poop: Function // TODO
}

export type State = {
    rToken: {}
}

// Later
export type Commands = {}

// ================================================

// Parent interface that all system components should implement.
export interface Component {
    connect: (account: Account) => this
    // poop: Function // TODO
}

export interface AbstractERC20 extends Component {
    balanceOf(account: Account): Promise<BigNumber>
    mint(account: Account, amount: BigNumber): Promise<void>
    burn(account: Account, amount: BigNumber): Promise<void>
    transfer(to: Account, amount: BigNumber): Promise<void>
}

export interface AbstractRToken extends Component {
    balanceOf(account: Account): Promise<BigNumber>
    basketERC20(index: number): AbstractERC20
    issue(amount: BigNumber): Promise<void>
    redeem(amount: BigNumber): Promise<void>
    transfer(to: Account, amount: BigNumber): Promise<void>
}

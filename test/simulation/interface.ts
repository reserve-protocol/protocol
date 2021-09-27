import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

// Top-level interface object
export interface Simulation {
    rToken: AbstractRToken
}

// ================================================

export type Address = string

export type Token = {
    name: string
    symbol: string
    quantityE18: BigNumber
}

// Parent interface that all system components should implement.
export interface Component {
    address: () => Address
    connect: (account: Address) => this
}

export interface AbstractERC20 extends Component {
    balanceOf(account: Address): Promise<BigNumber>
    mint(account: Address, amount: BigNumber): Promise<void>
    burn(account: Address, amount: BigNumber): Promise<void>
    transfer(to: Address, amount: BigNumber): Promise<void>
}

export interface AbstractRToken extends Component {
    balanceOf(account: Address): Promise<BigNumber>
    basketERC20(index: number): AbstractERC20
    issue(amount: BigNumber): Promise<void>
    redeem(amount: BigNumber): Promise<void>
    transfer(to: Address, amount: BigNumber): Promise<void>
}

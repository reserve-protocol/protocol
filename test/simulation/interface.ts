import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

export type Address = string

export type Token = {
    name: string
    symbol: string
    quantityE18: BigNumber
}

export interface Contract {
    address: Address
}

export interface AbstractERC20 extends Contract {
    balanceOf(account: Address): BigNumber
    mint(account: Address, amount: BigNumber): void
    burn(account: Address, amount: BigNumber): void
    transfer(from: Address, to: Address, amount: BigNumber): void
}

// Top-level interface
export interface Simulation {
    rToken: AbstractERC20
    basketERC20(token: Token): AbstractERC20
    issue(account: Address, amount: BigNumber): void
    redeem(account: Address, amount: BigNumber): void
}

import { BigNumber } from "ethers"
import { bn } from "../../common/numbers"

export type Address = string

export type Token = {
    name: string
    symbol: string
    quantityE18: BigNumber
}

export interface Basket {
    scalarE18: BigNumber // a float multiplier expressed relative to 1e18
    erc20s: Map<Token, AbstractERC20>
    erc20(token: Token): AbstractERC20
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

export interface AbstractImplementation {
    rToken: AbstractERC20
    basket: Basket
    issue(account: Address, amount: BigNumber): void
    redeem(account: Address, amount: BigNumber): void
}
